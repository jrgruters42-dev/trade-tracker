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

test('desktop positions keep status badges visible and place ATR after the 2R target', () => {
    assert.match(html, /#openPositionsTable \.symbol-column\s*\{[\s\S]*?min-width:\s*112px;[\s\S]*?white-space:\s*nowrap;/);
    assert.match(html, /<th class="symbol-column"[^>]*>Symbol ▼<\/th>/);
    assert.match(html, /<td class="symbol-column" style="\$\{symbolStyle\}">/);

    const headerStart = html.indexOf('<th class="symbol-column"');
    const headerEnd = html.indexOf('</tr>', headerStart);
    const header = html.slice(headerStart, headerEnd);
    assert.ok(header.indexOf('2R Target ▼') < header.indexOf('ATR from 50 SMA ▼'));
    assert.ok(header.indexOf('ATR from 50 SMA ▼') < header.indexOf('>Actions</th>'));

    const rowStart = html.indexOf('<td class="symbol-column"');
    const rowEnd = html.indexOf('</tr>', rowStart);
    const row = html.slice(rowStart, rowEnd);
    assert.ok(row.indexOf('metrics.twoRTarget') < row.indexOf('formatAtrFrom50(pos)'));
});

test('ATR distance is yellow at 5 and red at 8 on desktop and mobile', () => {
    assert.match(html, /function getAtrFrom50Style\(posOrMultiple\)/);
    assert.match(html, /multiple < 5/);
    assert.match(html, /multiple >= 8/);
    assert.match(html, /background: #fef3c7/);
    assert.match(html, /background: #ef4444/);
    assert.match(html, /style="\$\{getAtrFrom50Style\(pos\)\}"/);
    assert.match(html, /style="\$\{getAtrFrom50Style\(metrics\.atrFrom50\)\}"/);
});

test('technical refresh reports symbols that could not update', () => {
    assert.match(html, /const failedSymbols = \[\]/);
    assert.match(html, /failedSymbols\.push\(symbol\)/);
    assert.match(html, /ATR\/50 SMA data could not be retrieved for:/);
    assert.match(html, /Alpha Vantage may be rate-limited/);
});
