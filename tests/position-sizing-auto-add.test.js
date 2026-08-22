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
    assert.match(html, /openVerifyEntryModal\(symbol, entryPrice, initialStop, shares, initialWeight, accountType\)/);
});

test('verifyEntryPriceModal provides editable entry price with live risk metrics and validation', () => {
    assert.match(html, /<div id="verifyEntryPriceModal" class="modal"/);
    assert.match(html, /<form id="verifyEntryPriceForm">/);
    assert.match(html, /<input type="number" id="verifyEntryPriceInput"/);
    assert.match(html, /<input type="number" id="verifyStopPriceInput"/);
    assert.match(html, /<input type="number" id="verifySharesInput"/);
    assert.match(html, /id="verifyRiskPerShare"/);
    assert.match(html, /id="verifyTotalDollarRisk"/);
    assert.match(html, /id="verifyAccountRiskPct"/);
    assert.match(html, /function updateVerifyModalCalculations\(\)/);
    assert.match(html, /function openVerifyEntryModal\(/);
});

test('commitPositionFromSizing updates form fields, session storage, and persists via saveToFirebase', () => {
    const fnStart = html.indexOf('async function commitPositionFromSizing(');
    assert.ok(fnStart > 0, 'commitPositionFromSizing function must be defined');
    const fnEnd = html.indexOf('window.commitPositionFromSizing = commitPositionFromSizing;', fnStart);
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

test('header badge and service worker cache match v1.0.6', () => {
    assert.match(html, /id="appVersionBadge"[^>]*>v1\.0\.6<\/span>/);
    const serviceWorker = fs.readFileSync(path.join(__dirname, '..', 'public', 'service-worker.js'), 'utf8');
    assert.match(serviceWorker, /const CACHE_NAME = 'trade-tracker-v1\.0\.6';/);
});

