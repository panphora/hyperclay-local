const test = require('node:test');
const assert = require('node:assert/strict');
const { aiEditEnabled, toggledAiEdit } = require('../../src/main/helpers/ai-edit-setting');

test('a missing setting reads as on', () => {
  assert.equal(aiEditEnabled({}), true);
  assert.equal(aiEditEnabled({ aiEdit: { default: 'codex' } }), true);
  assert.equal(aiEditEnabled(undefined), true);
});

test('explicit true is on and explicit false stays off', () => {
  assert.equal(aiEditEnabled({ aiEdit: { enabled: true } }), true);
  assert.equal(aiEditEnabled({ aiEdit: { enabled: false } }), false);
});

test('toggling flips the effective value and keeps the other fields', () => {
  assert.deepEqual(toggledAiEdit({ aiEdit: { default: 'codex' } }), { default: 'codex', enabled: false });
  assert.deepEqual(toggledAiEdit({ aiEdit: { enabled: false, engines: { x: 'y' } } }), { enabled: true, engines: { x: 'y' } });
});
