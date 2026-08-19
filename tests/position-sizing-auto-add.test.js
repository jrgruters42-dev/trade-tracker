const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

test('sizing table generates clickable share buttons with stock symbol, entry, stop, shares and risk', () => {
    assert.match(html, /function generateStockProfileTable\(stockNum, symbol, price, stop, adrPct\)/);
    assert.match(html, /class="btn-shares-click"/);
    assert.match(html, /onclick="autoAddPositionFromSizing\('/);
    assert.match(html, /function autoAddPositionFromSizing\(symbol, entryPrice, initialStop, shares, initialWeight, accountType\)/);
});

test('autoAddPositionFromSizing updates form fields, session storage, and persists via saveToFirebase', () => {
    const fnStart = html.indexOf('async function autoAddPositionFromSizing(');
    assert.ok(fnStart > 0, 'autoAddPositionFromSizing function must be defined');
    const fnEnd = html.indexOf('window.autoAddPositionFromSizing = autoAddPositionFromSizing;', fnStart);
    const fnCode = html.slice(fnStart, fnEnd);

    // Verifies form fields are updated
    assert.match(fnCode, /document\.getElementById\('symbol'\)/);
    assert.match(fnCode, /document\.getElementById\('entryPrice'\)/);
    assert.match(fnCode, /document\.getElementById\('initialStop'\)/);
    assert.match(fnCode, /document\.getElementById\('shares'\)/);
    assert.match(fnCode, /document\.getElementById\('initialWeight'\)/);

    // Verifies session cache is updated
    assert.match(fnCode, /sessionStorage\.setItem\('addPositionFormData'/);

    // Verifies durable sync and save
    assert.match(fnCode, /TradeFirestoreSync\.ensureIdentities\(\{ openPositions \}\)/);
    assert.match(fnCode, /pendingPositionOverlays\.set\(position\._syncId/);
    assert.match(fnCode, /const confirmedCheckpoint = await saveToFirebase\(true\)/);
    assert.match(fnCode, /updateAllDisplays\(\)/);
});

test('header badge and service worker cache match v1.0.4', () => {
    assert.match(html, /id="appVersionBadge"[^>]*>v1\.0\.4<\/span>/);
    const serviceWorker = fs.readFileSync(path.join(__dirname, '..', 'public', 'service-worker.js'), 'utf8');
    assert.match(serviceWorker, /const CACHE_NAME = 'trade-tracker-v1\.0\.4';/);
});
