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
    const helperIndex = html.search(/<script src="firestore-sync\.js(?:\?v=\d+)?"><\/script>/);
    const appIndex = html.indexOf('// Firebase and data variables');
    assert.ok(sdkIndex >= 0 && sdkIndex < helperIndex && helperIndex < appIndex);
});

test('journal saves use the granular Firestore store', () => {
    assert.match(html, /syncStore\.save\(data, syncCheckpoint/);
    assert.doesNotMatch(html, /db\.ref\(['"`]tradeData['"`]\)\.set\(/);
    assert.doesNotMatch(html, /dbRef\.transaction\(/);
});

test('Trading Account stays manual in Firestore and ignores the legacy Schwab RTDB field', () => {
    assert.doesNotMatch(html, /tradeData\/accountSize/);
    assert.doesNotMatch(html, /connectSchwabEquitySync/);
    assert.doesNotMatch(html, /handleSchwabEquitySnapshot/);
    assert.match(
        html,
        /accountSize:\s*parseFloat\(document\.getElementById\('accountSize'\)\.value\)/
    );
    assert.match(
        html,
        /document\.getElementById\('accountSize'\)\.value\s*=\s*data\.accountSize/
    );
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

test('parses every inline script in public/index.html to ensure valid JavaScript syntax', () => {
    const vm = require('node:vm');
    const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    let count = 0;
    while ((match = scriptRegex.exec(html)) !== null) {
        const opening = match[0].match(/<script\b([^>]*)>/i)[1];
        if (opening.includes('src=')) continue;
        count++;
        const code = match[1];
        assert.doesNotThrow(() => {
            new vm.Script(code);
        }, `Inline script ${count} in public/index.html contains syntax errors`);
    }
    assert.ok(count > 0, 'At least one inline script was parsed');
});

