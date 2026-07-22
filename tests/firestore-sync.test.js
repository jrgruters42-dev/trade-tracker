const test = require('node:test');
const assert = require('node:assert/strict');
const sync = require('../public/firestore-sync.js');

function records(count, factory) {
    return Array.from({ length: count }, (_, index) => factory(index));
}

// Keep migration tests self-contained and safe to publish. The original test
// accidentally depended on a private journal export outside the repository.
const legacy = {
    openPositions: records(7, index => ({
        id: `position-${index}`,
        symbol: `POS${index}`,
        currentPrice: 100 + index
    })),
    closedTrades: records(173, index => ({
        symbol: `TRADE${index}`,
        entryPrice: 50 + index,
        exitPrice: 51 + index
    })),
    cashFlows: records(2, index => ({
        id: `cash-${index}`,
        amount: 1000 * (index + 1)
    })),
    dailyEquity: records(104, index => ({
        date: `2026-01-${String(index + 1).padStart(3, '0')}`,
        equity: 250000 + index
    })),
    dailyEquityEntries: records(103, index => ({
        date: `2026-02-${String(index + 1).padStart(3, '0')}`,
        fomo: index % 101
    })),
    stockProfiles: Object.fromEntries(records(6, index => [
        String(index + 1),
        { symbol: `PROFILE${index + 1}`, rating: index + 1 }
    ])),
    lookbackPeriod: 10,
    spyJan1: 600
};

function deterministicId(collection, item, index) {
    return `${collection}-${index}`;
}

test('normalizes every legacy collection without changing record counts', () => {
    const normalized = sync.normalizeData(legacy, deterministicId);
    const validation = sync.validateMigration(legacy, normalized);
    assert.equal(validation.valid, true);
    assert.equal(validation.contentMatches, true);
    assert.deepEqual(validation.sourceCounts, {
        openPositions: 7,
        closedTrades: 173,
        cashFlows: 2,
        dailyEquity: 104,
        dailyEquityEntries: 103,
        stockProfiles: 6
    });
});

test('assigns a unique durable document id to all 395 granular records', () => {
    const normalized = sync.normalizeData(legacy, deterministicId);
    const ids = sync.COLLECTIONS.flatMap(definition => {
        const value = normalized[definition.key];
        const items = definition.shape === 'indexedObject' ? Object.values(value) : value;
        return items.map(item => `${definition.name}/${item._syncId}`);
    });
    assert.equal(ids.length, 395);
    assert.equal(new Set(ids).size, 395);
});

test('simultaneous first migrations assign identical document ids', () => {
    const first = sync.normalizeData(legacy, sync.deterministicMigrationId);
    const second = sync.normalizeData(legacy, sync.deterministicMigrationId);
    assert.deepEqual(
        first.closedTrades.map(trade => trade._syncId),
        second.closedTrades.map(trade => trade._syncId)
    );
});

test('initial migration creates one granular write per record plus settings', () => {
    const normalized = sync.normalizeData(legacy, deterministicId);
    const operations = sync.diffSnapshots({}, normalized);
    assert.equal(operations.length, 396);
    assert.equal(operations.filter(operation => operation.collection === 'closedTrades').length, 173);
    assert.equal(operations.filter(operation => operation.collection === 'settings').length, 1);
});

test('changing one position writes only that position', () => {
    const base = sync.normalizeData(legacy, deterministicId);
    const next = sync.normalizeData(base);
    next.openPositions[0].currentPrice += 1;
    const operations = sync.diffSnapshots(base, next);
    assert.deepEqual(operations.map(operation => `${operation.type}:${operation.collection}/${operation.id}`), [
        `set:openPositions/${next.openPositions[0]._syncId}`
    ]);
});

test('deleting one trade deletes only its Firestore document', () => {
    const base = sync.normalizeData(legacy, deterministicId);
    const next = sync.normalizeData(base);
    const removed = next.closedTrades.splice(10, 1)[0];
    const operations = sync.diffSnapshots(base, next);
    assert.deepEqual(operations.map(operation => `${operation.type}:${operation.collection}/${operation.id}`), [
        `delete:closedTrades/${removed._syncId}`
    ]);
});

test('different records edited on two devices merge without a conflict', () => {
    const base = sync.normalizeData(legacy, deterministicId);
    const laptop = sync.normalizeData(base);
    const desktop = sync.normalizeData(base);
    laptop.openPositions[0].currentPrice += 1;
    desktop.openPositions[1].currentPrice += 2;
    const result = sync.threeWayMerge(base, laptop, desktop);
    assert.deepEqual(result.conflicts, []);
    assert.equal(result.merged.openPositions[0].currentPrice, laptop.openPositions[0].currentPrice);
    assert.equal(result.merged.openPositions[1].currentPrice, desktop.openPositions[1].currentPrice);
});

test('the same record edited on two devices produces a narrow conflict', () => {
    const base = sync.normalizeData(legacy, deterministicId);
    const laptop = sync.normalizeData(base);
    const desktop = sync.normalizeData(base);
    laptop.openPositions[0].currentPrice += 1;
    desktop.openPositions[0].currentPrice += 2;
    const result = sync.threeWayMerge(base, laptop, desktop);
    assert.deepEqual(result.conflicts, [`openPositions.${base.openPositions[0]._syncId}`]);
});

test('different settings merge field by field', () => {
    const base = sync.normalizeData(legacy, deterministicId);
    const laptop = sync.normalizeData(base);
    const desktop = sync.normalizeData(base);
    laptop.lookbackPeriod = 20;
    desktop.spyJan1 += 1;
    const result = sync.threeWayMerge(base, laptop, desktop);
    assert.deepEqual(result.conflicts, []);
    assert.equal(result.merged.lookbackPeriod, 20);
    assert.equal(result.merged.spyJan1, desktop.spyJan1);
});
