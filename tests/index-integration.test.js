const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

test('loads the safety helper before the journal application code', () => {
    const helperIndex = html.indexOf('<script src="sync-safety.js"></script>');
    const appIndex = html.indexOf('// Firebase and data variables');
    assert.ok(helperIndex >= 0 && helperIndex < appIndex);
});

test('loads Firestore and the granular sync layer before the journal application code', () => {
    const sdkIndex = html.indexOf('firebase-firestore-compat.js');
    const helperIndex = html.indexOf('<script src="firestore-sync.js"></script>');
    const appIndex = html.indexOf('// Firebase and data variables');
    assert.ok(sdkIndex >= 0 && sdkIndex < helperIndex && helperIndex < appIndex);
});

test('journal saves use the granular Firestore store', () => {
    assert.match(html, /syncStore\.save\(data, syncCheckpoint\)/);
    assert.doesNotMatch(html, /db\.ref\(['"`]tradeData['"`]\)\.set\(/);
    assert.doesNotMatch(html, /dbRef\.transaction\(/);
});

test('Schwab equity is mirrored from its restricted RTDB field into granular Firestore settings', () => {
    assert.match(html, /db\.ref\(['"`]tradeData\/accountSize['"`]\)/);
    assert.match(html, /accountInput\.value = schwabEquity\.toFixed\(2\)/);
    assert.match(html, /await saveToFirebase\(true\)/);
    assert.doesNotMatch(html, /db\.ref\(['"`]tradeData['"`]\)\.set\(/);
});

test('position-sizing inputs start saving before ADR retrieval', () => {
    const start = html.indexOf('async function updateStockProfile');
    const end = html.indexOf('// Generate Stock Profile Table', start);
    const functionBody = html.slice(start, end);
    assert.ok(functionBody.indexOf('saveToFirebase(true)') < functionBody.indexOf('fetchADR(symbol)'));
});

test('year-end reset requires a Firebase safety restore point', () => {
    const start = html.indexOf('function archiveYearEndData');
    const end = html.indexOf('// Save daily snapshot', start);
    const functionBody = html.slice(start, end);
    assert.match(functionBody, /await createSafetyRestorePoint/);
    assert.ok(functionBody.indexOf('await createSafetyRestorePoint') < functionBody.indexOf('closedTrades = []'));
    assert.match(functionBody, /await saveToFirebase\(true\)/);
});

test('conflict dialog offers local download and cloud recovery', () => {
    assert.match(html, /Download My Copy/);
    assert.match(html, /Load Cloud Version/);
});
