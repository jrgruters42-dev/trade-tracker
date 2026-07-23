const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

test('new positions receive an unused id when the saved counter is stale', () => {
    const functionStart = html.indexOf('function allocatePositionId()');
    const functionEnd = html.indexOf('// Initialize Firebase', functionStart);
    assert.notEqual(functionStart, -1, 'position id allocator must exist');

    const source = html.slice(functionStart, functionEnd);
    const context = {
        openPositions: [{ id: 1 }, { id: 2 }, { id: 1700000000000 }],
        positionIdCounter: 1,
        Date: { now: () => 1700000000000 }
    };
    vm.createContext(context);
    vm.runInContext(`${source}; result = allocatePositionId(); nextCounter = positionIdCounter;`, context);

    assert.equal(context.result, 1700000000001);
    assert.equal(context.nextCounter, 1700000000002);
    assert.ok(!context.openPositions.some(position => position.id === context.result));
});

test('add-position submit uses the collision-resistant allocator', () => {
    const submitStart = html.indexOf("document.getElementById('addPositionForm').addEventListener");
    const submitEnd = html.indexOf('// Edit position modal functions', submitStart);
    const submit = html.slice(submitStart, submitEnd);

    assert.match(submit, /id:\s*allocatePositionId\(\)/);
    assert.doesNotMatch(submit, /id:\s*positionIdCounter\+\+/);
});
