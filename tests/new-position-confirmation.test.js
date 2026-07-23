const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const serviceWorker = fs.readFileSync(path.join(__dirname, '..', 'public', 'service-worker.js'), 'utf8');

test('new positions remain overlaid while Firestore snapshots are incomplete', () => {
    assert.match(html, /const pendingPositionOverlays = new Map\(\)/);
    assert.match(html, /pendingPositionOverlays\.set\(position\._syncId/);
    assert.match(
        html,
        /const protectedPositions = \[\.\.\.pendingPositionOverlays\.values\(\)\][\s\S]*?openPositions = \[\.\.\.cloudPositions, \.\.\.protectedPositions\]/
    );
});

test('position success waits for an authoritative Firestore read-back', () => {
    const start = html.indexOf("document.getElementById('addPositionForm').addEventListener");
    const end = html.indexOf('// Auto-save form data', start);
    const handler = html.slice(start, end);

    assert.match(handler, /await saveToFirebase\(true\)/);
    assert.match(handler, /const confirmedCheckpoint = await syncStore\.load\(\)/);
    assert.match(handler, /\.find\(item => item\._syncId === position\._syncId\)/);
    assert.match(handler, /pendingPositionOverlays\.delete\(position\._syncId\)/);
    assert.ok(
        handler.indexOf('const confirmedCheckpoint = await syncStore.load()')
            < handler.indexOf('confirmation.textContent'),
        'the green saved confirmation must appear only after Firestore read-back'
    );
});

test('service worker cache version is bumped for the position fix', () => {
    assert.match(serviceWorker, /trade-tracker-firestore-v5/);
});
