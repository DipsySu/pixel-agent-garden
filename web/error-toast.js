// Bottom-right error toast. One container, queued messages, each toast
// auto-dismisses after TOAST_LIFE_MS or on click. Same-source bursts collapse
// into one toast with an incrementing badge so a chatty watcher doesn't bury
// the screen.
//
// Public surface:
//   mountErrorToast()        → installs the container once, returns { show }
//   show({ source, message }) → display a toast
//
// Frontend errors (catch in data-source.js etc.) and backend events
// (garden:error) both call into show().

const TOAST_LIFE_MS = 4500;
const MAX_STACK = 3;

let host = null;
const recent = new Map(); // source → { el, count, timer }

function ensureHost() {
  if (host) return host;
  host = document.createElement('div');
  host.className = 'pg6-toast-host';
  // Bottom-right, fixed, stacks upward. z-index above pg6-info (200) so
  // a toast can land over an open info card if the user happens to hover.
  Object.assign(host.style, {
    position: 'fixed',
    right: '16px',
    bottom: '16px',
    display: 'flex',
    flexDirection: 'column-reverse',
    gap: '8px',
    zIndex: '500',
    pointerEvents: 'none',
    maxWidth: 'min(360px, calc(100vw - 32px))'
  });
  document.body.appendChild(host);
  return host;
}

function buildToast(source, message) {
  const el = document.createElement('div');
  el.className = 'pg6-toast';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  Object.assign(el.style, {
    background: 'rgba(36, 22, 14, 0.95)',
    border: '1px solid rgba(244, 234, 216, 0.18)',
    borderLeft: '3px solid #d6a258',
    borderRadius: '8px',
    padding: '10px 14px',
    color: '#f4ead8',
    fontSize: '12px',
    lineHeight: '1.45',
    boxShadow: '0 6px 20px rgba(0,0,0,0.45)',
    pointerEvents: 'auto',
    cursor: 'pointer',
    transform: 'translateY(8px)',
    opacity: '0',
    transition: 'opacity 180ms ease, transform 180ms ease'
  });
  const label = document.createElement('div');
  label.style.cssText = 'font-size:10px;letter-spacing:0.3px;opacity:0.62;text-transform:uppercase;margin-bottom:2px;';
  label.textContent = source || 'error';
  const body = document.createElement('div');
  body.className = 'pg6-toast-body';
  body.textContent = message || 'Unknown error';
  const badge = document.createElement('span');
  badge.className = 'pg6-toast-badge';
  badge.style.cssText = 'margin-left:6px;opacity:0.7;font-size:10px;';
  badge.textContent = '';
  label.appendChild(badge);
  el.appendChild(label);
  el.appendChild(body);
  el.addEventListener('click', () => dismiss(source, el));
  return { el, body, badge };
}

function dismiss(source, el) {
  const entry = source ? recent.get(source) : null;
  if (entry && entry.el === el) {
    clearTimeout(entry.timer);
    recent.delete(source);
  }
  el.style.opacity = '0';
  el.style.transform = 'translateY(8px)';
  setTimeout(() => el.remove(), 200);
}

function pruneStack() {
  const host = ensureHost();
  while (host.children.length > MAX_STACK) {
    const oldest = host.firstChild;
    if (!oldest) break;
    oldest.remove();
  }
}

export function showErrorToast({ source, message }) {
  const host = ensureHost();
  const key = source || 'error';
  const existing = recent.get(key);
  if (existing) {
    // Collapse into existing toast — update message + bump counter, restart timer.
    existing.count += 1;
    existing.body.textContent = message || existing.body.textContent;
    existing.badge.textContent = '×' + existing.count;
    clearTimeout(existing.timer);
    existing.timer = setTimeout(() => dismiss(key, existing.el), TOAST_LIFE_MS);
    return;
  }
  const { el, body, badge } = buildToast(source, message);
  host.appendChild(el);
  pruneStack();
  // Trigger the fade-in on the next frame so the transition runs.
  requestAnimationFrame(() => {
    el.style.opacity = '1';
    el.style.transform = 'translateY(0)';
  });
  const entry = {
    el,
    body,
    badge,
    count: 1,
    timer: setTimeout(() => dismiss(key, el), TOAST_LIFE_MS)
  };
  recent.set(key, entry);
}

/**
 * Install the container (idempotent) and return the imperative API. Callers
 * can also import { showErrorToast } directly if they only need to emit.
 */
export function mountErrorToast() {
  ensureHost();
  return { show: showErrorToast };
}
