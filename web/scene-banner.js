// In-scene banner (PRD 2.0 §5.4-B / P1-2, issue I5). A queue-based paper card
// that rises from the scene's bottom edge, dwells, then sinks — the "光环层"
// (halo layer) surface for unlock moments. Pure overlay module by design:
// it knows nothing about renderers, data sources, or WHAT is being celebrated.
// Callers push fully-localized entries; the only string this module owns is
// the queue-overflow aggregate (`banner.more`), because collapsing is queue
// mechanics, not celebration copy.
//
// Motion contract (§5.4-B): rise 240ms steps(6) → dwell 4000ms → sink 240ms.
// One banner visible at a time. Reduced motion (app setting via the host's
// `data-motion`, or prefers-reduced-motion) swaps the slide for a fade with
// identical durations — same decision rule as both renderers.
import { t } from './i18n.js';

const RISE_MS = 240;
const DWELL_MS = 4000;
const SINK_MS = 240;
// At most this many entries shown individually per wave (visible + queued);
// anything beyond collapses into one trailing "+N more changes" entry so a
// big return-diff never turns the garden into a marquee (PRD: "最多 3 条").
const MAX_INDIVIDUAL = 3;

export function mountSceneBanner({ host }) {
  let current = null; // entry being shown
  let queue = []; // pending entries, aggregate (if any) always last
  let element = null;
  let timers = new Set();
  let destroyed = false;

  // Full repaints (renderer switch, settings re-paint) wipe the scene's
  // children, taking a showing banner with them. Watch for that and hand the
  // slot to the next queued entry immediately instead of letting the wiped
  // banner's dwell timer hold the queue hostage (review finding).
  const detachWatch = typeof MutationObserver === 'function'
    ? new MutationObserver(() => {
        if (!element || element.isConnected) return;
        element = null;
        current = null;
        const next = queue.shift();
        if (next) {
          current = next;
          show(next);
        }
      })
    : null;
  detachWatch?.observe(host, { childList: true });

  function later(fn, ms) {
    const id = window.setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
    return id;
  }

  // The renderers own `data-motion` on the scene element (settings-driven);
  // mirror their exact stillness rule so the banner never animates more than
  // the garden around it.
  function isMotionStill() {
    const mode = host?.dataset?.motion || 'system';
    const prefersReduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return mode === 'off' || mode === 'reduced' || prefersReduced;
  }

  function push(entry) {
    if (destroyed || !host || !entry || !entry.text) return;
    if (!current) {
      current = entry;
      show(entry);
      return;
    }
    const shownOrQueued =
      (current.__more ? 0 : 1) + queue.filter((item) => !item.__more).length;
    if (shownOrQueued < MAX_INDIVIDUAL) {
      queue.push(entry);
      return;
    }
    // Overflow: fold into the trailing aggregate entry instead of growing the
    // queue. The aggregate has no single object to focus, so no onActivate.
    const tail = queue[queue.length - 1];
    if (tail && tail.__more) {
      tail.count += 1;
      tail.text = t('banner.more', { count: tail.count });
    } else {
      queue.push({ __more: true, count: 1, icon: '', text: t('banner.more', { count: 1 }) });
    }
  }

  function show(entry) {
    const el = document.createElement('div');
    el.className = 'pg6-banner';
    if (isMotionStill()) el.classList.add('is-fade');
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    if (entry.icon) {
      const icon = document.createElement('span');
      icon.className = 'pg6-banner-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = entry.icon;
      el.appendChild(icon);
    }
    const text = document.createElement('span');
    text.className = 'pg6-banner-text';
    text.textContent = entry.text;
    el.appendChild(text);
    el.addEventListener('click', () => {
      if (element !== el) return; // already sinking — ignore late clicks
      try {
        entry.onActivate?.();
      } catch (_) {
        // Focus is best-effort decoration; a throwing callback must not
        // strand the queue.
      }
      sink(el);
    });
    element = el;
    host.appendChild(el);
    // Force a style flush so the entrance transition actually plays instead
    // of the element being painted directly in its final state.
    void el.offsetHeight;
    el.classList.add('is-in');
    later(() => sink(el), RISE_MS + DWELL_MS);
  }

  // `el`-bound so a stale auto-sink timer (its banner already dismissed by a
  // click) can never sink the banner that replaced it.
  function sink(el) {
    if (!element || element !== el) return;
    element = null;
    el.classList.remove('is-in');
    later(() => {
      el.remove();
      current = null;
      const next = queue.shift();
      if (next) {
        current = next;
        show(next);
      }
    }, SINK_MS);
  }

  function destroy() {
    destroyed = true;
    detachWatch?.disconnect();
    timers.forEach((id) => window.clearTimeout(id));
    timers.clear();
    element?.remove();
    element = null;
    current = null;
    queue = [];
  }

  return { push, destroy };
}
