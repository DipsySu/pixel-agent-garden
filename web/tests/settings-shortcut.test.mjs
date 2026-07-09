// Unit tests for the global-hotkey recorder's pure helpers. accelFromEvent /
// formatAccel take an explicit `mac` flag so the mapping is deterministic on any
// host. No DOM — plain `node --test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { accelFromEvent, formatAccel, RECOMMENDED_TOGGLE } from '../settings-panel.js';

function key(props) {
  return { metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, code: '', key: '', ...props };
}

test('the platform primary modifier maps to CmdOrCtrl (Cmd on mac, Ctrl elsewhere)', () => {
  assert.equal(accelFromEvent(key({ metaKey: true, shiftKey: true, code: 'KeyG' }), true), 'CmdOrCtrl+Shift+G');
  assert.equal(accelFromEvent(key({ ctrlKey: true, shiftKey: true, code: 'KeyG' }), false), 'CmdOrCtrl+Shift+G');
});

test('accelerator keys come from event.code, so they are layout-independent', () => {
  assert.equal(accelFromEvent(key({ ctrlKey: true, altKey: true, code: 'Digit1' }), false), 'CmdOrCtrl+Alt+1');
  assert.equal(accelFromEvent(key({ metaKey: true, code: 'F5' }), true), 'CmdOrCtrl+F5');
  assert.equal(accelFromEvent(key({ ctrlKey: true, code: 'ArrowUp' }), false), 'CmdOrCtrl+Up');
});

test('modifier-only, Shift-only, and bare keys are rejected (keep recording)', () => {
  assert.equal(accelFromEvent(key({ metaKey: true, code: '' }), true), null);
  assert.equal(accelFromEvent(key({ shiftKey: true, code: 'KeyG' }), true), null);
  assert.equal(accelFromEvent(key({ code: 'KeyG' }), true), null);
});

test('the non-primary Ctrl/Meta maps distinctly per platform', () => {
  assert.equal(accelFromEvent(key({ ctrlKey: true, code: 'KeyK' }), true), 'Control+K');
  assert.equal(accelFromEvent(key({ metaKey: true, code: 'KeyK' }), false), 'Super+K');
});

test('formatAccel renders platform glyphs and round-trips the recommended combo', () => {
  assert.equal(formatAccel('CmdOrCtrl+Shift+G', true), '⌘⇧G');
  assert.equal(formatAccel('CmdOrCtrl+Shift+G', false), 'Ctrl+Shift+G');
  assert.equal(formatAccel('', true), '');
  assert.equal(formatAccel(RECOMMENDED_TOGGLE, true), '⌘⇧G');
});
