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
