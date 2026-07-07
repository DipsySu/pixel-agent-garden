// First-scan curtain (PRD 2.0 §P5-1, issue I9). A multi-GB agent history can
// take tens of seconds on the very first scan; without feedback the stranger
// install test dies on a black screen. This overlay is armed at boot and only
// becomes visible if the first summary hasn't arrived after a grace delay —
// the warm-cache path (and browser fallback fetch) never sees it flash.
//
// Layer contract: z-index 200, the first-run curtain slot in the §5.2 ladder.
// The module knows nothing about renderers or data shape; garden.js arms it
// before the summary promise and hides it after the first paint.
import { t } from './i18n.js';
import { isTauriRuntime, subscribeGardenScanning } from './data-source.js';

// Long enough that a cache hit (< ~100ms) never flickers the curtain, short
// enough that a real cold scan shows feedback well before impatience.
const GRACE_MS = 450;

export function mountScanCurtain({ host }) {
  let element = null;
  let adapterLine = null;
  let hidden = false;

  const graceTimer = window.setTimeout(() => {
    // Browser fallback resolves from a local fetch almost instantly; the
    // curtain is a desktop-first-scan affordance only.
    if (!hidden && isTauriRuntime()) show();
  }, GRACE_MS);

  // The watcher names each adapter as it rescans; surfacing it turns a mute
  // wait into visible progress. Best-effort — the initial blocking scan may
  // not emit at all, and the generic line alone is fine.
  subscribeGardenScanning((payload) => {
    if (hidden || !element || !payload?.adapter) return;
    adapterLine.textContent = String(payload.adapter);
    adapterLine.hidden = false;
  });

  function show() {
    element = document.createElement('div');
    element.className = 'pg6-scan-curtain';
    element.setAttribute('role', 'status');
    element.setAttribute('aria-live', 'polite');
    const card = document.createElement('div');
    card.className = 'pg6-scan-curtain-card';
    const text = document.createElement('span');
    text.className = 'pg6-scan-curtain-text';
    text.textContent = t('firstrun.waking');
    adapterLine = document.createElement('span');
    adapterLine.className = 'pg6-scan-curtain-adapter';
    adapterLine.hidden = true;
    card.appendChild(text);
    card.appendChild(adapterLine);
    element.appendChild(card);
    host.appendChild(element);
  }

  function hide() {
    hidden = true;
    window.clearTimeout(graceTimer);
    if (!element) return;
    const el = element;
    element = null;
    el.classList.add('is-out');
    window.setTimeout(() => el.remove(), 300);
  }

  return { hide };
}
