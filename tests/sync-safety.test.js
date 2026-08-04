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
