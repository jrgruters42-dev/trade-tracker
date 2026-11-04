const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('mobile stylesheet does not hide equity-curves, closed-trades, or other tabs', () => {
    // Ensure tabs are never set to display: none !important in mobile CSS
    assert.doesNotMatch(html, /#equity-curves\s*,\s*[\s\S]*?display:\s*none !important;/);
    assert.doesNotMatch(html, /#closed-trades\s*,\s*[\s\S]*?display:\s*none !important;/);
    assert.doesNotMatch(html, /#options-hedge\s*,\s*[\s\S]*?display:\s*none !important;/);

    // Ensure active tab contents are visible on mobile
    assert.match(html, /\.tab-content\.active\s*\{\s*display:\s*block !important;\s*\}/);
    assert.match(html, /#equity-curves\.tab-content\.active\s*\{\s*display:\s*block !important;\s*\}/);
});

test('switchTab for equity-curves calls updateEquityCurves and updateDailyEquityTable', () => {
    assert.match(html, /if\s*\(tabName === 'equity-curves'\)\s*\{\s*updateEquityCurves\(\);\s*updateDailyEquityTable\(\);/);
});

test('equity curves mobile styling includes responsive stats grid and scrollable table', () => {
    assert.match(html, /#equity-curves \.stats-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)\s*!important;/);
    assert.match(html, /#dailyEquityTable\s*\{[\s\S]*?width:\s*max-content;[\s\S]*?min-width:\s*100%;/);
});
