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

// Captures listeners by event type so a test can fire mousedown / dblclick
// independently and assert both are torn down.
function fakeRegion() {
  const handlers = {};
  const removed = {};
  return {
    handlers,
    removed,
    addEventListener(type, fn) { handlers[type] = fn; },
    removeEventListener(type, fn) { if (handlers[type] === fn) removed[type] = true; }
  };
}

function fakeTauri(win) {
  return { window: { getCurrentWindow: () => win } };
}

test('installWindowDrag calls Tauri startDragging on mousedown, and tears down both listeners', () => {
  let started = 0;
  let prevented = 0;
  const region = fakeRegion();
  const teardown = installWindowDrag({
    documentRef: { querySelector: () => region },
    tauri: fakeTauri({ startDragging: () => { started += 1; }, toggleMaximize: () => {} })
  });

  assert.equal(typeof teardown, 'function');
  region.handlers.mousedown({ button: 0, buttons: 1, target: target(false), preventDefault: () => { prevented += 1; } });
  region.handlers.mousedown({ button: 0, buttons: 1, target: target(true), preventDefault: () => { throw new Error('should not prevent'); } });
  teardown();

  assert.equal(started, 1);
  assert.equal(prevented, 1);
  assert.equal(region.removed.mousedown, true);
  assert.equal(region.removed.dblclick, true);
});

test('installWindowDrag toggles maximize on double-click, but not over interactive children', () => {
  let maximized = 0;
  let prevented = 0;
  const region = fakeRegion();
  installWindowDrag({
    documentRef: { querySelector: () => region },
    tauri: fakeTauri({ startDragging: () => {}, toggleMaximize: () => { maximized += 1; } })
  });

  region.handlers.dblclick({ target: target(false), preventDefault: () => { prevented += 1; } });
  assert.equal(maximized, 1);
  assert.equal(prevented, 1);
  // A double-click on a button belongs to the button, not the window.
  region.handlers.dblclick({ target: target(true), preventDefault: () => { throw new Error('should not prevent'); } });
  assert.equal(maximized, 1);
});
