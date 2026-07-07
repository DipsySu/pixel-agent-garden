// Guards the run-once contract of the first-run reveal (see first-run.js):
// the flag gates replays, ?firstrun=1 forces one, and node (no window) must
// never crash the pure decision helper.
import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldRunReveal } from '../first-run.js';

function storageWith(entries) {
  return {
    getItem: (key) => (key in entries ? entries[key] : null),
    setItem: () => {}
  };
}

test('first visit (no flag) runs the reveal', () => {
  assert.equal(shouldRunReveal({ storage: storageWith({}), search: '' }), true);
});

test('a stored flag suppresses replays', () => {
  const storage = storageWith({ 'pg6.firstrun.done': '1751900000000' });
  assert.equal(shouldRunReveal({ storage, search: '' }), false);
});

test('?firstrun=1 forces a replay past the flag', () => {
  const storage = storageWith({ 'pg6.firstrun.done': '1751900000000' });
  assert.equal(shouldRunReveal({ storage, search: '?firstrun=1' }), true);
  assert.equal(shouldRunReveal({ storage, search: '?demo=1&firstrun=1' }), true);
});

test('a throwing storage backend fails closed (no reveal loop)', () => {
  const storage = {
    getItem: () => {
      throw new Error('blocked');
    }
  };
  assert.equal(shouldRunReveal({ storage, search: '' }), false);
});
