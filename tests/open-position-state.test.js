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

test('open-position sorting survives redraws and does not rewrite canonical journal order', () => {
    assert.match(html, /localStorage\.getItem\('openPositionSort'\)/);
    assert.match(html, /localStorage\.setItem\('openPositionSort'/);
    assert.match(html, /function getDisplayedOpenPositions\(\)[\s\S]*?return \[\.\.\.openPositions\]\.sort\(compareOpenPositions\);/);
    assert.match(html, /getDisplayedOpenPositions\(\)\.forEach\(\(pos, index\) =>/);
    assert.doesNotMatch(html, /function sortOpenPositions\(column\)[\s\S]*?openPositions\.sort\(/);
});
