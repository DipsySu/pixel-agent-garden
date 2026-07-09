import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DRAG_BLOCK_SELECTOR,
  installWindowDrag,
  isInteractiveDragTarget,
  shouldStartWindowDrag
} from '../window-drag.js';

function target(blocked = false) {
  return {
    closest(selector) {
      assert.equal(selector, DRAG_BLOCK_SELECTOR);
      return blocked ? {} : null;
    }
  };
}

test('shouldStartWindowDrag accepts only plain primary-button drags', () => {
  assert.equal(shouldStartWindowDrag({ button: 0, buttons: 1, target: target(false) }), true);
  assert.equal(shouldStartWindowDrag({ button: 2, buttons: 2, target: target(false) }), false);
  assert.equal(shouldStartWindowDrag({ button: 0, buttons: 1, defaultPrevented: true, target: target(false) }), false);
});

test('interactive descendants never start a window drag', () => {
  assert.equal(isInteractiveDragTarget(target(true)), true);
  assert.equal(shouldStartWindowDrag({ button: 0, buttons: 1, target: target(true) }), false);
});

test('installWindowDrag calls Tauri startDragging from the drag region', () => {
  let handler = null;
  let removed = false;
  let started = 0;
  let prevented = 0;
  const region = {
    addEventListener(type, fn) {
      assert.equal(type, 'mousedown');
      handler = fn;
    },
    removeEventListener(type, fn) {
      assert.equal(type, 'mousedown');
      assert.equal(fn, handler);
      removed = true;
    }
  };
  const teardown = installWindowDrag({
    documentRef: { querySelector: () => region },
    tauri: { window: { getCurrentWindow: () => ({ startDragging: () => { started += 1; } }) } }
  });

  assert.equal(typeof teardown, 'function');
  handler({ button: 0, buttons: 1, target: target(false), preventDefault: () => { prevented += 1; } });
  handler({ button: 0, buttons: 1, target: target(true), preventDefault: () => { throw new Error('should not prevent'); } });
  teardown();

  assert.equal(started, 1);
  assert.equal(prevented, 1);
  assert.equal(removed, true);
});
