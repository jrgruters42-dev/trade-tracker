const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

test('open positions show sortable 20-day ATR distance from the 50 SMA', () => {
    assert.match(html, /case 'atrFrom50':/);
    assert.match(html, /ATR from 50 SMA/);
    assert.match(html, /\(currentPrice - sma50\) \/ atr20/);
    assert.match(html, /time_period.*50|slice\(0, 50\)/);
    assert.match(html, /dates\.slice\(0, 20\)/);
    assert.match(html, /Math\.max\(high - low, Math\.abs\(high - previousClose\), Math\.abs\(low - previousClose\)\)/);
});

test('one daily-history request derives both SMA and ATR and is cached on positions', () => {
    assert.match(html, /function fetchPositionTechnicalData\(symbol\)/);
    assert.match(html, /function=TIME_SERIES_DAILY/);
    assert.match(html, /return \{ sma50, atr20, technicalUpdatedAt: Date\.now\(\) \}/);
    assert.match(html, /const maxAgeMs = 20 \* 60 \* 60 \* 1000/);
    assert.match(html, /positions\.forEach\(pos => Object\.assign\(pos, technical\)\)/);
});
