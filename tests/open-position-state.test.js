const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

test('a queued save captures a newly added position before earlier cloud work can redraw it', () => {
    const start = html.indexOf('function saveToFirebase(propagateError = false)');
    const end = html.indexOf('// Expectancy Calculator functions', start);
    const body = html.slice(start, end);

    assert.match(body, /const requestedData = buildFirebaseData\(\);/);
    assert.ok(
        body.indexOf('const requestedData = buildFirebaseData();') < body.indexOf('const queuedSave = async () =>'),
        'journal state must be captured before the save waits in the serialized queue'
    );
    assert.match(body, /const data = requestedData;/);
    assert.match(body, /queuedSaveCount \+= 1;[\s\S]*?finally\s*{[\s\S]*?queuedSaveCount = Math\.max\(0, queuedSaveCount - 1\)/);
});


test('cloud snapshots cannot redraw positions while an add is saving', () => {
    const start = html.indexOf('function handleRemoteCheckpoint(remoteCheckpoint)');
    const end = html.indexOf('// The restricted desktop updater', start);
    const handler = html.slice(start, end);

    assert.match(
        handler,
        /if \(window\.pendingSave\)\s*{[\s\S]*?deferredRemoteCheckpoint = remoteCheckpoint;[\s\S]*?return;/
    );
    assert.ok(
        handler.indexOf('if (window.pendingSave)') < handler.indexOf('loadDataFromFirebase(result.merged)'),
        'pending saves must return before any cloud data can redraw the journal'
    );

    const saveStart = html.indexOf('function saveToFirebase(propagateError = false)');
    const saveEnd = html.indexOf('// Expectancy Calculator functions', saveStart);
    const save = html.slice(saveStart, saveEnd);
    assert.match(
        save,
        /window\.pendingSave = queuedSaveCount > 0;[\s\S]*?if \(!window\.pendingSave\)\s*{[\s\S]*?deferredRemoteCheckpoint = null;/
    );
});

test('open-position sorting survives redraws and does not rewrite canonical journal order', () => {
    assert.match(html, /localStorage\.getItem\('openPositionSort'\)/);
    assert.match(html, /localStorage\.setItem\('openPositionSort'/);
    assert.match(html, /function getDisplayedOpenPositions\(\)[\s\S]*?return \[\.\.\.openPositions\]\.sort\(compareOpenPositions\);/);
    assert.match(html, /getDisplayedOpenPositions\(\)\.forEach\(\(pos, index\) =>/);
    assert.doesNotMatch(html, /function sortOpenPositions\(column\)[\s\S]*?openPositions\.sort\(/);
});
