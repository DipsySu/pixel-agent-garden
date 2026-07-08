import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAdapters } from '../data-source.js';

function withWindow(value, fn) {
  const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, 'window');
  const previous = globalThis.window;
  globalThis.window = value;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (hadWindow) {
        globalThis.window = previous;
      } else {
        delete globalThis.window;
      }
    });
}

test('loadAdapters stays canned in demo mode and does not invoke Tauri', async () => {
  let invoked = false;
  await withWindow({
    location: { search: '?demo=1' },
    __TAURI__: {
      core: {
        invoke: async () => {
          invoked = true;
          throw new Error('demo must not call list_adapters');
        }
      }
    }
  }, async () => {
    const rows = await loadAdapters();
    assert.equal(invoked, false);
    assert.deepEqual(rows.map((row) => row.name), [
      'claude-code',
      'claude-cowork',
      'codex',
      'manual-jsonl'
    ]);
    assert.equal(rows.some((row) => row.active), false);
  });
});
