const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'index.html'),
  'utf8'
);

test('Trading Account remains manual and cannot be overwritten by legacy Schwab sync', () => {
  assert.doesNotMatch(html, /tradeData\/accountSize/);
  assert.doesNotMatch(html, /connectSchwabEquitySync/);
  assert.doesNotMatch(html, /handleSchwabEquitySnapshot/);
  assert.doesNotMatch(html, /schwabEquityRef/);
});

test('Trading Account still persists through the journal Firestore settings', () => {
  assert.match(
    html,
    /accountSize:\s*parseFloat\(document\.getElementById\('accountSize'\)\.value\)/
  );
  assert.match(
    html,
    /document\.getElementById\('accountSize'\)\.value\s*=\s*data\.accountSize/
  );
});
