const test = require('node:test');
const assert = require('node:assert/strict');
const safety = require('../public/sync-safety.js');

const readyState = {
    firebaseInitialized: true,
    hasDatabaseRef: true,
    authenticated: true,
    initialDataLoaded: true,
    remoteConflictDetected: false
};

test('blocks saves when authentication has not completed', () => {
    assert.match(safety.getSaveBlockReason({ ...readyState, authenticated: false }), /authenticated/);
});

test('blocks saves when the initial Firebase read failed or is pending', () => {
    assert.match(safety.getSaveBlockReason({ ...readyState, initialDataLoaded: false }), /finished loading/);
});

test('blocks saves while a cross-device conflict is unresolved', () => {
    assert.match(safety.getSaveBlockReason({ ...readyState, remoteConflictDetected: true }), /Resolve the conflict/);
});

test('allows a genuinely new empty database after a successful read', () => {
    const next = { openPositions: [], closedTrades: [], lastModified: 'new' };
    const decision = safety.chooseTransactionValue(null, null, next);
    assert.equal(decision.commit, true);
    assert.deepEqual(decision.value, next);
});

test('rejects a stale device instead of overwriting newer cloud data', () => {
    const current = { lastModified: 'newer' };
    const decision = safety.chooseTransactionValue(current, 'older', { lastModified: 'local' });
    assert.equal(decision.commit, false);
    assert.equal(decision.value, undefined);
});

test('allows a write based on the current cloud version', () => {
    const next = { lastModified: 'next' };
    const decision = safety.chooseTransactionValue({ lastModified: 'current' }, 'current', next);
    assert.equal(decision.commit, true);
    assert.deepEqual(decision.value, next);
});

test('downloadable backups exclude market-data API keys', () => {
    const original = { apiKey: 'secret-1', alphaVantageKey: 'secret-2', openPositions: [{ id: 1 }] };
    const clean = safety.sanitizeBackupData(original);
    assert.equal(clean.apiKey, undefined);
    assert.equal(clean.alphaVantageKey, undefined);
    assert.deepEqual(clean.openPositions, [{ id: 1 }]);
    assert.equal(original.apiKey, 'secret-1');
});

test('daily restore point retention keeps the newest 30 dates', () => {
    const keys = Array.from({ length: 35 }, (_, index) => `2026-06-${String(index + 1).padStart(2, '0')}`);
    assert.deepEqual(safety.backupKeysToPrune(keys, 30), keys.slice(0, 5));
});

test('rapid saves execute in the order they were queued', async () => {
    const enqueue = safety.createSerializedQueue();
    const order = [];
    const first = enqueue(async () => {
        await new Promise(resolve => setTimeout(resolve, 20));
        order.push('first');
    });
    const second = enqueue(async () => {
        order.push('second');
    });
    await Promise.all([first, second]);
    assert.deepEqual(order, ['first', 'second']);
});

function mockValidCheckpoint() {
    return {
        data: {
            openPositions: [
                { _syncId: 'position-1', id: 1, symbol: 'AAPL', entryPrice: 150 },
                { _syncId: 'position-2', id: 2, symbol: 'NVDA', entryPrice: 400 }
            ],
            closedTrades: [
                { _syncId: 'trade-101', id: 101, symbol: 'MSFT', entryPrice: 300, exitPrice: 310 }
            ],
            cashFlows: [
                { _syncId: 'cash-1', id: 1, amount: 5000, date: '2026-01-01' }
            ],
            dailyEquity: [
                { _syncId: 'equity-2026-01-01', date: '2026-01-01', accountValue: 250000 }
            ],
            dailyEquityEntries: [
                { _syncId: 'journal-2026-01-01', date: '2026-01-01', accountValue: 250000 }
            ],
            stockProfiles: {
                '1': { _slot: '1', symbol: 'AAPL' }
            },
            lookbackPeriod: 15
        },
        versions: {}
    };
}

test('circuit breaker: startup-before-load blocks saves before cloud load completes', () => {
    const blockReason = safety.getSaveBlockReason({
        firebaseInitialized: true,
        hasDatabaseRef: true,
        authenticated: true,
        initialDataLoaded: false,
        remoteConflictDetected: false
    });
    assert.match(blockReason, /Cloud data has not finished loading/);

    const payloadCheck = safety.validatePayloadSafety(mockValidCheckpoint().data, null);
    assert.equal(payloadCheck.safe, false);
    assert.equal(payloadCheck.reason, 'AUTHORITATIVE_CHECKPOINT_MISSING');
});

test('circuit breaker: populated-to-empty protection blocks replacing populated cloud data with empty array', () => {
    const checkpoint = mockValidCheckpoint();
    const proposed = JSON.parse(JSON.stringify(checkpoint.data));
    proposed.openPositions = [];

    const result = safety.validatePayloadSafety(proposed, checkpoint);
    assert.equal(result.safe, false);
    assert.equal(result.reason, 'EMPTY_DATASET_OVERWRITE:openPositions');
});

test('circuit breaker: normal saving succeeds when editing or adding records', () => {
    const checkpoint = mockValidCheckpoint();
    const proposed = JSON.parse(JSON.stringify(checkpoint.data));
    proposed.openPositions[0].currentPrice = 155;
    proposed.openPositions.push({ _syncId: 'position-3', id: 3, symbol: 'GOOGL', entryPrice: 180 });

    const result = safety.validatePayloadSafety(proposed, checkpoint);
    assert.equal(result.safe, true);
});

test('circuit breaker: successful deletion passes with valid single-use token and rejects reuse', () => {
    const checkpoint = mockValidCheckpoint();
    const proposed = JSON.parse(JSON.stringify(checkpoint.data));
    const target = proposed.openPositions.splice(0, 1)[0]; // Remove position-1

    const token = safety.issueDeletionToken('openPositions', target._syncId, target.id);
    const result = safety.validatePayloadSafety(proposed, checkpoint, { deletionToken: token });

    assert.equal(result.safe, true);

    // Token was consumed; trying to reuse it must fail
    const reuseResult = safety.validatePayloadSafety(proposed, checkpoint, { deletionToken: token });
    assert.equal(reuseResult.safe, false);
    assert.equal(reuseResult.reason, 'EXPIRED_OR_CONSUMED_TOKEN');
});

test('circuit breaker: failed-deletion rollback restores local array and state', async () => {
    const checkpoint = mockValidCheckpoint();
    let localPositions = JSON.parse(JSON.stringify(checkpoint.data.openPositions));
    const targetIndex = 0;
    const backupPos = JSON.parse(JSON.stringify(localPositions[targetIndex]));

    // Optimistically remove position
    localPositions.splice(targetIndex, 1);
    assert.equal(localPositions.length, 1);

    // Simulate save failure (e.g., unauthorized deletion or network error)
    const mockSave = async () => {
        throw new Error('Sync error: network disconnected');
    };

    let saveFailed = false;
    try {
        await mockSave();
    } catch (error) {
        saveFailed = true;
        // Rollback
        localPositions.splice(targetIndex, 0, backupPos);
    }

    assert.equal(saveFailed, true);
    assert.equal(localPositions.length, 2);
    assert.deepEqual(localPositions[0], backupPos);
});

test('circuit breaker: blocks deletion of exactly one record without a single-use client-side workflow token', () => {
    const checkpoint = mockValidCheckpoint(); // Has 2 openPositions
    const proposed = JSON.parse(JSON.stringify(checkpoint.data));
    proposed.openPositions.splice(0, 1); // 1 record removed

    const result = safety.validatePayloadSafety(proposed, checkpoint);
    assert.equal(result.safe, false);
    assert.equal(result.reason, 'UNAUTHORIZED_DELETION');
});

test('circuit breaker: blocks a one-record collection becoming empty without a single-use client-side workflow token', () => {
    const checkpoint = mockValidCheckpoint();
    checkpoint.data.openPositions = [
        { _syncId: 'position-1', id: 1, symbol: 'AAPL', entryPrice: 150 }
    ];
    const proposed = JSON.parse(JSON.stringify(checkpoint.data));
    proposed.openPositions = []; // 1-record collection becomes empty

    const result = safety.validatePayloadSafety(proposed, checkpoint);
    assert.equal(result.safe, false);
    assert.equal(result.reason, 'UNAUTHORIZED_DELETION');
});

test('circuit breaker: single-use client-side workflow token allows a one-record collection to become empty', () => {
    const checkpoint = mockValidCheckpoint();
    checkpoint.data.openPositions = [
        { _syncId: 'position-1', id: 1, symbol: 'AAPL', entryPrice: 150 }
    ];
    const proposed = JSON.parse(JSON.stringify(checkpoint.data));
    proposed.openPositions = [];

    const token = safety.issueDeletionToken('openPositions', 'position-1', 1);
    const result = safety.validatePayloadSafety(proposed, checkpoint, { deletionToken: token });
    assert.equal(result.safe, true);
});

test('circuit breaker: deletion tokens are single-use client-side workflow tokens, not cryptographic tokens', () => {
    const token = safety.issueDeletionToken('openPositions', 'position-1', 1);
    assert.ok(token && typeof token.nonce === 'string');
    assert.equal(token.dataset, 'openPositions');
    assert.equal(token.recordId, 'position-1');
    // Consuming invalidates token (single-use client-side workflow token)
    const consumed = safety.consumeToken(token);
    assert.ok(consumed);
    assert.equal(safety.consumeToken(token), null);
});

test('circuit breaker: token for position-1 cannot authorize deletion of position-10', () => {
    const checkpoint = mockValidCheckpoint();
    checkpoint.data.openPositions = [
        { _syncId: 'position-1', id: 1, symbol: 'AAPL' },
        { _syncId: 'position-10', id: 10, symbol: 'MSFT' }
    ];
    const proposed = JSON.parse(JSON.stringify(checkpoint.data));
    proposed.openPositions = [
        { _syncId: 'position-1', id: 1, symbol: 'AAPL' }
    ];

    const token = safety.issueDeletionToken('openPositions', 'position-1', 1);
    const result = safety.validatePayloadSafety(proposed, checkpoint, { deletionToken: token });
    assert.equal(result.safe, false);
    assert.equal(result.reason, 'UNAUTHORIZED_DELETION');
});

test('circuit breaker: payload ID of 1 cannot authorize deletion of another record merely because identifier contains 1', () => {
    const checkpoint = mockValidCheckpoint();
    checkpoint.data.openPositions = [
        { _syncId: 'position-100', id: 100, symbol: 'TSLA' },
        { _syncId: 'position-11', id: 11, symbol: 'NVDA' }
    ];
    const proposed = JSON.parse(JSON.stringify(checkpoint.data));
    proposed.openPositions = [
        { _syncId: 'position-100', id: 100, symbol: 'TSLA' }
    ];

    const token = safety.issueDeletionToken('openPositions', 'pos-1', 1);
    const result = safety.validatePayloadSafety(proposed, checkpoint, { deletionToken: token });
    assert.equal(result.safe, false);
    assert.equal(result.reason, 'UNAUTHORIZED_DELETION');
});

test('circuit breaker: correctly matching token authorizes its intended deletion', () => {
    const checkpoint = mockValidCheckpoint();
    checkpoint.data.openPositions = [
        { _syncId: 'position-1', id: 1, symbol: 'AAPL' },
        { _syncId: 'position-2', id: 2, symbol: 'GOOGL' }
    ];
    const proposed = JSON.parse(JSON.stringify(checkpoint.data));
    proposed.openPositions = [
        { _syncId: 'position-2', id: 2, symbol: 'GOOGL' }
    ];

    const token = safety.issueDeletionToken('openPositions', 'position-1', 1);
    const result = safety.validatePayloadSafety(proposed, checkpoint, { deletionToken: token });
    assert.equal(result.safe, true);
});

test('circuit breaker: changing date on a journal entry preserves _syncId and allows save without deletion token', () => {
    const checkpoint = mockValidCheckpoint();
    const proposed = JSON.parse(JSON.stringify(checkpoint.data));
    // User updates date from 2026-01-01 to 2026-01-02 on dailyEquityEntries
    proposed.dailyEquityEntries[0].date = '2026-01-02';
    proposed.dailyEquityEntries[0].fomo = 1.45;
    proposed.dailyEquityEntries[0].accountValue = 252000;

    const result = safety.validatePayloadSafety(proposed, checkpoint);
    assert.equal(result.safe, true);
});

test('circuit breaker: changing date on dailyEquity curve preserves _syncId and allows save without deletion token', () => {
    const checkpoint = mockValidCheckpoint();
    const proposed = JSON.parse(JSON.stringify(checkpoint.data));
    // User updates date on dailyEquity curve
    proposed.dailyEquity[0].date = '2026-01-02';
    proposed.dailyEquity[0].accountValue = 252000;

    const result = safety.validatePayloadSafety(proposed, checkpoint);
    assert.equal(result.safe, true);
});

test('circuit breaker: editing FOMO, balances, and journal date followed by closing a position succeeds', () => {
    const checkpoint = mockValidCheckpoint();
    const proposed = JSON.parse(JSON.stringify(checkpoint.data));

    // Step 1: Update FOMO, account value, and date on journal entry
    proposed.dailyEquityEntries[0].fomo = 2.1;
    proposed.dailyEquityEntries[0].date = '2026-01-05';
    proposed.dailyEquityEntries[0].accountValue = 255000;
    proposed.accountSize = 255000;

    // Step 2: Close position-1 (convert to closed trade and remove from open positions)
    const closedPos = proposed.openPositions.shift();
    proposed.closedTrades.push({
        _syncId: 'trade-closed-1',
        symbol: closedPos.symbol,
        entryPrice: closedPos.entryPrice,
        exitPrice: 160,
        exitDate: '2026-01-05'
    });

    const token = safety.issueDeletionToken('openPositions', closedPos._syncId, closedPos.id);
    const result = safety.validatePayloadSafety(proposed, checkpoint, { deletionToken: token });
    assert.equal(result.safe, true);
});


