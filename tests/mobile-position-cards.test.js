const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

function functionSource(name, nextName) {
    const start = html.indexOf(`function ${name}`);
    const end = html.indexOf(`function ${nextName}`, start);
    assert.notEqual(start, -1, `${name}() was not found`);
    assert.notEqual(end, -1, `${nextName}() was not found after ${name}()`);
    return html.slice(start, end);
}

test('mobile positions are grouped by ticker without merging their lot records', () => {
    const source = functionSource('groupOpenPositionsForMobile', 'calculateMobileGroupMetrics');
    const openPositions = [
        { id: 1, symbol: 'crwd' },
        { id: 2, symbol: 'CRWD' },
        { id: 3, symbol: 'GLW' }
    ];
    const group = new Function('openPositions', `${source}; return groupOpenPositionsForMobile;`)(openPositions);
    const result = group();

    assert.deepEqual(result.map(item => item.symbol), ['CRWD', 'GLW']);
    assert.deepEqual(result[0].lots.map(lot => lot.id), [1, 2]);
    assert.deepEqual(result[1].lots.map(lot => lot.id), [3]);
});

test('combined mobile metrics aggregate dollars and risk while preserving lot calculations', () => {
    const source = functionSource('calculateMobileGroupMetrics', 'renderMobileLot');
    const calculate = new Function(
        'getAccountSize',
        'calculatePositionMetrics',
        'formatMobileMoney',
        `${source}; return calculateMobileGroupMetrics;`
    )(
        () => 10000,
        pos => pos.testMetrics,
        (value, decimals = 0) => `$${Number(value).toFixed(decimals)}`
    );

    const lots = [
        {
            entryPrice: 10, currentPrice: 11, initialStop: 9, currentStop: 10.5,
            shares: 100, initialShares: 100, entryDate: '2026-07-01', peakR: 3,
            testMetrics: { adjustedPrice: 9.8, totalPnL: 100, unrealizedPnL: 80, initialR: 0.8 }
        },
        {
            entryPrice: 20, currentPrice: 19, initialStop: 18, currentStop: 18,
            shares: 50, initialShares: 50, entryDate: '2026-07-03', peakR: 1.5,
            testMetrics: { adjustedPrice: 19.5, totalPnL: -20, unrealizedPnL: -20, initialR: -0.2 }
        }
    ];
    const result = calculate(lots);

    assert.equal(result.totalShares, 150);
    assert.equal(result.totalPositionValue, 2050);
    assert.equal(result.totalPnL, 80);
    assert.equal(result.pnlPercent, 4);
    assert.equal(result.accountWeight, 20.5);
    assert.equal(result.currentR, 0.3);
    assert.equal(result.peakR, 2.25);
    assert.equal(result.toStopsDollars, 100);
    assert.equal(result.toStopsPercent, 1);
    assert.equal(result.givebackDollars, 370);
    assert.ok(Math.abs(result.givebackPercent - 82.2222222) < 0.0001);
    assert.equal(result.lotMetrics.length, 2);
});

test('banked partial-sale profit is not counted as profit giveback', () => {
    const source = functionSource('calculateMobileGroupMetrics', 'renderMobileLot');
    const calculate = new Function(
        'getAccountSize',
        'calculatePositionMetrics',
        'formatMobileMoney',
        `${source}; return calculateMobileGroupMetrics;`
    )(
        () => 10000,
        pos => pos.testMetrics,
        value => `$${Number(value).toFixed(0)}`
    );

    const result = calculate([{
        entryPrice: 10, currentPrice: 11, initialStop: 9, currentStop: 10,
        shares: 50, initialShares: 100, peakR: 2,
        testMetrics: {
            adjustedPrice: 8,
            realizedPnL: 100,
            unrealizedPnL: 150,
            totalPnL: 250,
            initialR: 1.5
        }
    }]);

    assert.equal(result.givebackDollars, 0);
    assert.equal(result.givebackPercent, 0);
});

test('mobile cards expose the decision metrics and separate lot actions', () => {
    assert.match(html, /Avg entry/);
    assert.match(html, /Avg adj basis/);
    assert.match(html, /Current R/);
    assert.match(html, /ATR from 50 SMA/);
    assert.match(html, /Drop to stops/);
    assert.match(html, /Peak R/);
    assert.match(html, /Giveback/);
    assert.match(html, /class="mobile-lots"/);
    assert.match(html, /Entry \$\{lotNumber\}/);
    assert.match(html, /openEditPositionModal\(\$\{pos\.id\}\)/);
    assert.match(html, /openPartialSellModal\(\$\{pos\.id\}\)/);
    assert.match(html, /openUpdateStopModal\(\$\{pos\.id\}\)/);
    assert.match(html, /openClosePositionModal\(\$\{pos\.id\}\)/);
});

test('mobile layout puts positions first and keeps position entry collapsed', () => {
    assert.match(html, /#currentPositionsCard\s*\{\s*order:\s*-20;/);
    assert.match(html, /#addPositionCard #addPositionForm\s*\{\s*display:\s*none !important;/);
    assert.match(html, /#addPositionCard\.mobile-expanded #addPositionForm\s*\{\s*display:\s*grid !important;/);
    assert.match(html, /\.account-setup-section \.account-summary-row\s*\{\s*display:\s*none !important;/);
    assert.match(html, /#exposureScalingCard \.exposure-scaling-body\s*\{\s*display:\s*none !important;/);
    assert.match(html, /#exposureScalingCard\.mobile-expanded \.exposure-scaling-body\s*\{\s*display:\s*flex !important;/);
    assert.match(html, /\.tabs,/);
});
