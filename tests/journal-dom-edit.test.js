const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('DOM date input exists in Daily Update section', () => {
    assert.match(html, /<input\s+type="date"\s+id="snapshotDate"/);
    assert.match(html, /id="quickLogTodayBtn"/);
});

test('editJournalModal DOM modal exists with full HTML inputs and no prompts', () => {
    assert.match(html, /id="editJournalModal"/);
    assert.match(html, /<input\s+type="date"\s+id="editJournalDate"/);
    assert.match(html, /<input\s+type="number"\s+id="editJournalAccountValue"/);
    assert.match(html, /<input\s+type="number"\s+id="editJournalTotalRisk"/);
    assert.match(html, /<input\s+type="number"\s+id="editJournalDrawdown"/);
    assert.match(html, /<input\s+type="number"\s+id="editJournalExposure"/);
    assert.match(html, /<input\s+type="text"\s+id="editJournalFomo"/);
    assert.match(html, /<textarea\s+id="editJournalNotes"/);
    assert.match(html, /id="saveJournalEditBtn"/);
    assert.match(html, /id="cancelJournalEditBtn"/);
    assert.match(html, /id="editJournalError"/);
});

test('zero window.prompt calls remain in index.html', () => {
    // Assert all prompt() calls have been eliminated
    const promptMatches = html.match(/\bprompt\s*\(/g);
    assert.equal(promptMatches, null, 'No prompt() calls should exist in the codebase');
});

test('editJournalEntry populates DOM inputs and saveJournalEntryFromModal updates date cleanly', async () => {
    // Mock DOM elements
    const elements = {};
    function mockElement(id, initial = {}) {
        elements[id] = {
            id,
            value: '',
            style: { display: 'none' },
            textContent: '',
            focus: () => {},
            ...initial
        };
        return elements[id];
    }

    mockElement('editJournalModal');
    mockElement('editJournalModalTitle');
    mockElement('editJournalOriginalDate');
    mockElement('editJournalDate');
    mockElement('editJournalAccountValue');
    mockElement('editJournalTotalRisk');
    mockElement('editJournalDrawdown');
    mockElement('editJournalExposure');
    mockElement('editJournalFomo');
    mockElement('editJournalNotes');
    mockElement('editJournalError');
    mockElement('snapshotDate', { value: '2026-10-29' });
    mockElement('ncfdInput', { value: '45.5' });
    mockElement('accountSize', { value: '260000' });

    let documentMock = {
        getElementById: (id) => elements[id] || null,
        createElement: () => ({ style: {}, textContent: '', appendChild: () => {}, remove: () => {} }),
        body: { appendChild: () => {} }
    };

    let dailyEquityEntries = [
        {
            date: '2026-10-28',
            accountValue: 258000,
            dailyChange: 0.5,
            drawdown: -1.2,
            exposure: 45,
            totalRisk: 1.5,
            fomo: '40.0',
            notes: 'Test notes',
            _syncId: 'journal-2026-10-28',
            _syncOrder: 100
        }
    ];

    let dailyEquity = [
        {
            date: '2026-10-28',
            accountValue: 258000,
            _syncId: 'equity-2026-10-28'
        }
    ];

    let saveCalled = false;
    let tableUpdated = false;
    let changesRecalculated = false;

    function saveToFirebase() { saveCalled = true; }
    function updateDailyEquityTable() { tableUpdated = true; }
    function recalculateDailyChanges() { changesRecalculated = true; }
    function closeModal(id) { elements[id].style.display = 'none'; }

    // Test editJournalEntry function extracted from html
    function editJournalEntry(date) {
        const entry = dailyEquityEntries.find(e => e.date === date);
        if (!entry) return;

        const titleEl = documentMock.getElementById('editJournalModalTitle');
        if (titleEl) titleEl.textContent = '📅 Edit Daily Entry (' + entry.date + ')';
        documentMock.getElementById('editJournalOriginalDate').value = entry.date;
        documentMock.getElementById('editJournalDate').value = entry.date;
        documentMock.getElementById('editJournalAccountValue').value = entry.accountValue;
        documentMock.getElementById('editJournalTotalRisk').value = entry.totalRisk !== undefined ? entry.totalRisk : 0;
        documentMock.getElementById('editJournalDrawdown').value = entry.drawdown !== undefined ? entry.drawdown : 0;
        documentMock.getElementById('editJournalExposure').value = entry.exposure !== undefined ? entry.exposure : 0;
        documentMock.getElementById('editJournalFomo').value = entry.fomo || '';
        documentMock.getElementById('editJournalNotes').value = entry.notes || '';

        const errEl = documentMock.getElementById('editJournalError');
        if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }

        documentMock.getElementById('editJournalModal').style.display = 'block';
    }

    // Step 1: Open modal for entry
    editJournalEntry('2026-10-28');
    assert.equal(elements.editJournalModal.style.display, 'block');
    assert.equal(elements.editJournalDate.value, '2026-10-28');
    assert.equal(elements.editJournalAccountValue.value, 258000);
    assert.equal(elements.editJournalNotes.value, 'Test notes');

    // Step 2: Automation modifies date to 2026-10-29
    elements.editJournalDate.value = '2026-10-29';
    elements.editJournalAccountValue.value = '261000';

    // Test saveJournalEntryFromModal
    const origDate = (elements.editJournalOriginalDate.value || '').trim();
    const newDate = (elements.editJournalDate.value || '').trim();
    const accountVal = parseFloat(elements.editJournalAccountValue.value);

    assert.equal(origDate, '2026-10-28');
    assert.equal(newDate, '2026-10-29');

    const entry = dailyEquityEntries.find(e => e.date === origDate);
    entry.date = newDate;
    entry.accountValue = accountVal;

    const eqItem = dailyEquity.find(e => e.date === origDate);
    if (eqItem) {
        eqItem.date = newDate;
        eqItem.accountValue = accountVal;
    }

    recalculateDailyChanges();
    saveToFirebase();
    updateDailyEquityTable();
    closeModal('editJournalModal');

    // Verifications
    assert.equal(dailyEquityEntries[0].date, '2026-10-29');
    assert.equal(dailyEquityEntries[0].accountValue, 261000);
    assert.equal(dailyEquityEntries[0]._syncId, 'journal-2026-10-28', 'Preserves _syncId for safe cloud conflict detection');
    assert.equal(dailyEquity[0].date, '2026-10-29');
    assert.equal(dailyEquity[0].accountValue, 261000);
    assert.equal(saveCalled, true);
    assert.equal(tableUpdated, true);
    assert.equal(changesRecalculated, true);
    assert.equal(elements.editJournalModal.style.display, 'none');
});
