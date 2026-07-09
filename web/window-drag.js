// Frameless Tauri window drag support.
//
// `data-tauri-drag-region` only applies to the exact clicked element, not its
// children. The garden header is mostly nested text/chips, so explicit
// startDragging() gives us native movement without turning buttons/inputs into
// accidental drag handles.

export const DRAG_BLOCK_SELECTOR = [
  '[data-no-window-drag]',
  'a',
  'button',
  'input',
  'select',
  'textarea',
  '[contenteditable]',
  '[role="button"]',
  '[role="tab"]',
  '[role="textbox"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '[role="slider"]',
  '[role="menuitem"]'
].join(',');

export function isInteractiveDragTarget(target) {
  if (!target || typeof target.closest !== 'function') return false;
  return Boolean(target.closest(DRAG_BLOCK_SELECTOR));
}

export function shouldStartWindowDrag(event) {
  if (!event || event.defaultPrevented) return false;
  if (event.button !== undefined && event.button !== 0) return false;
  if (event.buttons !== undefined && event.buttons !== 1) return false;
  return !isInteractiveDragTarget(event.target);
}

export function installWindowDrag({
  documentRef = typeof document !== 'undefined' ? document : null,
  tauri = typeof window !== 'undefined' ? window.__TAURI__ : null,
  selector = '[data-window-drag-region]'
} = {}) {
  const region = documentRef?.querySelector?.(selector);
  if (!region || typeof region.addEventListener !== 'function') return null;

  const onMouseDown = (event) => {
    if (!shouldStartWindowDrag(event)) return;
    const appWindow = tauri?.window?.getCurrentWindow?.();
    const startDragging = appWindow?.startDragging;
    if (typeof startDragging !== 'function') return;

    event.preventDefault?.();
    try {
      const result = startDragging.call(appWindow);
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch (_) {
      // Drag failures are non-fatal: keep the garden usable in browser preview
      // or on platforms where the command is temporarily unavailable.
    }
  };

  // Double-click the drag region to toggle maximize — the gesture native
  // `data-tauri-drag-region` gave for free before we moved to explicit
  // dragging. Skipped over interactive children (a double-click on a button is
  // theirs) and a no-op without the Tauri command (browser preview / missing
  // capability).
  const onDblClick = (event) => {
    if (isInteractiveDragTarget(event.target)) return;
    const appWindow = tauri?.window?.getCurrentWindow?.();
    const toggleMaximize = appWindow?.toggleMaximize;
    if (typeof toggleMaximize !== 'function') return;

    event.preventDefault?.();
    try {
      const result = toggleMaximize.call(appWindow);
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch (_) {
      // Non-fatal, same as the drag path.
    }
  };

  region.addEventListener('mousedown', onMouseDown);
  region.addEventListener('dblclick', onDblClick);
  return () => {
    region.removeEventListener?.('mousedown', onMouseDown);
    region.removeEventListener?.('dblclick', onDblClick);
  };
}
