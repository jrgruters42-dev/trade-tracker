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

const positionSource = functionSource(
    'calculate50DayGivebackForPosition',
    'calculatePortfolio50DayGiveback'
);
const portfolioSource = functionSource(
    'calculatePortfolio50DayGiveback',
    'get50DayGivebackStyle'
);
const calculatePosition = new Function(
    `${positionSource}; return calculate50DayGivebackForPosition;`
)();
const calculatePortfolio = new Function(
    `${positionSource}\n${portfolioSource}; return calculatePortfolio50DayGiveback;`
)();

test('position giveback is weight times percentage distance above the 50-day', () => {
    const result = calculatePosition({
        currentPrice: 120,
        sma50: 100,
        shares: 125
    }, 100000);

    assert.equal(result.positionWeightPct, 15);
    assert.equal(result.distanceAbove50Pct, 20);
    assert.equal(result.givebackExposurePct, 3);
});

test('positions at or below the 50-day contribute zero', () => {
    const result = calculatePosition({
        currentPrice: 95,
        sma50: 100,
        shares: 100
    }, 10000);

    assert.equal(result.positionWeightPct, 95);
    assert.equal(result.distanceAbove50Pct, 0);
    assert.equal(result.givebackExposurePct, 0);
});

test('missing technical data is excluded instead of treated as zero', () => {
    assert.equal(calculatePosition({
        currentPrice: 120,
        shares: 100
    }, 100000), null);
});

test('portfolio giveback totals contributions and reports incomplete coverage', () => {
    const summary = calculatePortfolio([
        { currentPrice: 120, sma50: 100, shares: 125 },
        { currentPrice: 110, sma50: 100, shares: 100 },
        { currentPrice: 50, shares: 100 }
    ], 100000);

    assert.equal(summary.totalGivebackExposurePct, 4.1);
    assert.equal(summary.coveredPositions, 2);
    assert.equal(summary.missingPositions, 1);
    assert.equal(summary.totalPositions, 3);
    assert.ok(Math.abs(summary.coveragePct - (26000 / 31000 * 100)) < 0.0001);
});

test('dashboard and position table expose the new metric and thresholds', () => {
    assert.match(html, /id="fiftyDayGivebackBar"/);
    assert.match(html, /id="fiftyDayGivebackValue"/);
    assert.match(html, /sortOpenPositions\('fiftyDayGiveback'\)/);
    assert.match(html, /50D Giveback/);
    assert.match(html, /value >= 10/);
    assert.match(html, /value >= 8/);
    assert.match(html, /fiftyDayGivebackValue >= 10/);
    assert.match(html, /fiftyDayGivebackValue >= 8/);
    assert.match(html, /below 8%/);
    assert.match(html, /total may be understated/);
});

test('50-day giveback column follows ATR from 50 SMA at the end of position metrics', () => {
    assert.match(
        html,
        /sortOpenPositions\('atrFrom50'\)[\s\S]*?ATR from 50 SMA ▼<\/th>\s*<th onclick="sortOpenPositions\('fiftyDayGiveback'\)"[\s\S]*?50D Giveback ▼<\/th>\s*<th title="Edit, partial sell, update stop, close, or delete position">Actions<\/th>/
    );
    assert.match(
        html,
        /<td title="\$\{getAtrFrom50Tooltip\(pos\)\}"[\s\S]*?\$\{formatAtrFrom50\(pos\)\}<\/td>\s*<td title="\$\{get50DayGivebackTooltip\(pos\)\}"[\s\S]*?<\/td>\s*<td>\s*<div class="action-buttons"/
    );
});
