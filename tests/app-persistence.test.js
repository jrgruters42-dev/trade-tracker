const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function appSections() {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const start = html.indexOf('function buildFirebaseData()');
    const end = html.indexOf('return TradeFirestoreSync.ensureIdentities(data);', start);
    const loadStart = html.indexOf('function loadDataFromFirebase(data)');
    const loadEnd = html.indexOf('// Get account size', loadStart);

    assert.notEqual(start, -1, 'buildFirebaseData() was not found');
    assert.notEqual(end, -1, 'buildFirebaseData() return was not found');
    assert.notEqual(loadStart, -1, 'loadDataFromFirebase() was not found');
    assert.notEqual(loadEnd, -1, 'loadDataFromFirebase() end was not found');

    return {
        html,
        buildFirebaseData: html.slice(start, end),
        loadDataFromFirebase: html.slice(loadStart, loadEnd)
    };
}

test('unused margin balance control and persistence are removed', () => {
    const sections = appSections();
    assert.doesNotMatch(sections.html, /id=["']marginBalance["']/);
    assert.doesNotMatch(sections.buildFirebaseData, /marginBalance\s*:/);
    assert.doesNotMatch(sections.loadDataFromFirebase, /data\.marginBalance/);
});

test('SPY Jan 2 is included in both save and reload paths', () => {
    const sections = appSections();
    assert.match(
        sections.buildFirebaseData,
        /spyJan1:\s*parseFloat\(document\.getElementById\('spyJan1'\)\.value\)/
    );
    assert.match(
        sections.loadDataFromFirebase,
        /if\s*\(!spyJan1EditPending\)[\s\S]*?getElementById\('spyJan1'\)\.value\s*=\s*data\.spyJan1\s*\|\|\s*0/
    );
});

test('SPY Jan 2 marks input dirty, debounces its save, and protects pending edits', () => {
    const sections = appSections();
    assert.match(
        sections.html,
        /id="spyJan1"[^>]*oninput="handleSpyJan1Input\(\)"[^>]*onchange="flushSpyJan1Save\(\)"/
    );
    assert.match(
        sections.html,
        /function handleSpyJan1Input\(\)[\s\S]*?spyJan1EditPending\s*=\s*true;[\s\S]*?_dataDirty\s*=\s*true;[\s\S]*?setTimeout\(\(\)\s*=>\s*persistSpyJan1Edit\(versionToSave\),\s*750\)/
    );
    assert.match(
        sections.html,
        /if \(window\.pendingSave \|\| _dataDirty \|\| spyJan1EditPending\)/
    );
    assert.match(
        sections.html,
        /setInterval\(\(\)\s*=>\s*{[\s\S]*?\(_dataDirty \|\| spyJan1EditPending\)[\s\S]*?if \(spyJan1EditPending\) flushSpyJan1Save\(\)/
    );
});

test('position-sizing drafts save while incomplete and are restored field by field', () => {
    const sections = appSections();
    assert.match(
        sections.html,
        /function captureStockProfileDraft\(stockNum\)[\s\S]*?_dataDirty\s*=\s*true;[\s\S]*?setTimeout\(\(\)\s*=>\s*{[\s\S]*?saveToFirebase\(\);[\s\S]*?},\s*750\)/
    );
    assert.match(
        sections.html,
        /field\.addEventListener\('input',\s*\(\)\s*=>\s*captureStockProfileDraft\(stockNum\)\)/
    );
    assert.match(
        sections.loadDataFromFirebase,
        /SymbolInput`\)\.value\s*=\s*profile\.symbol\s*\|\|\s*'';[\s\S]*?Price`\)\.value\s*=\s*profile\.price\s*\|\|\s*'';[\s\S]*?Stop`\)\.value\s*=\s*profile\.stop\s*\|\|\s*'';/
    );
});
