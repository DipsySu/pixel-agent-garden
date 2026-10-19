// Open tests/ui-shell.html through the local preview server. This exercises
// real DOM focus and events without a framework, OS shortcuts, or user files.
import { mountSettingsPanel } from '../settings-panel.js';
import { mountDataDrawer } from '../data-drawer.js';
import { loadSettings } from '../data-source.js';

const results = document.getElementById('results');
const footer = document.getElementById('footer');
const lines = [];
const writes = [];
const defaults = await loadSettings();
window.__TAURI__ = { core: { invoke: async (command, args) => {
  writes.push(command);
  if (command !== 'set_settings') throw new Error(`Unexpected IPC: ${command}`);
  return args.settings;
} } };

function check(name, condition) {
  if (!condition) throw new Error(name);
  lines.push(`PASS ${name}`);
}

function press(target, key) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

try {
  // Use the real stylesheet, including the visually hidden radio treatment.
  const page = new DOMParser().parseFromString(await (await fetch('../index.html')).text(), 'text/html');
  document.head.appendChild(page.querySelector('style').cloneNode(true));
  const changes = [];
  const settings = mountSettingsPanel({
    hostFooter: footer, initial: defaults, onChange: (value) => changes.push(value),
  });
  const gear = footer.querySelector('.pg6-footer-gear');
  const panel = document.getElementById('settings-panel');
  const close = panel.querySelector('.pg6-insight-close');
  gear.click();
  check('settings has a named dialog', panel.getAttribute('aria-labelledby') === 'settings-panel-title');
  check('opening settings moves focus inside', document.activeElement === close);
  press(close, 'Escape');
  check('Escape closes and restores focus', panel.hidden && document.activeElement === gear);

  gear.click();
  const day = document.getElementById('pg6-set-time_mode-day');
  check('radio remains keyboard reachable', getComputedStyle(day).display !== 'none' && !day.disabled);
  day.focus();
  check('radio takes real DOM focus', document.activeElement === day);
  day.click();
  check('appearance change reaches the caller', changes.at(-1).appearance.time_mode === 'day');
  settings.update(settings.get());
  check('settings refresh preserves radio focus', document.activeElement.id === day.id);

  panel.querySelector('[data-shortcut-capture]').click();
  press(document.activeElement, 'Escape');
  check('first Escape cancels recording without closing', !panel.hidden && !panel.querySelector('.is-recording'));
  check('cancel restores recorder focus', document.activeElement === panel.querySelector('[data-shortcut-capture]'));
  press(document.activeElement, 'Escape');
  check('second Escape closes settings', panel.hidden && document.activeElement === gear);

  gear.click();
  panel.querySelector('[data-shortcut-recommend]').click();
  check('shortcut commit restores recorder focus', document.activeElement === panel.querySelector('[data-shortcut-capture]'));
  check('shortcut commit preserves other settings', settings.get().appearance.time_mode === 'day');

  const drawer = mountDataDrawer({ hostFooter: footer, initialSummary: { projects: [] } });
  drawer.open('overview');
  const data = document.getElementById('data-drawer-panel');
  check('opening data closes settings', panel.hidden && !data.hidden);
  press(document.activeElement, 'End');
  check('End selects the last tab', document.activeElement.id === 'data-drawer-tab-export');
  press(document.activeElement, 'Home');
  check('Home selects the first tab', document.activeElement.id === 'data-drawer-tab-overview');
  press(document.activeElement, 'ArrowRight');
  check('arrow navigation selects projects', document.activeElement.id === 'data-drawer-tab-projects');
  press(document.activeElement, 'Escape');
  check('drawer Escape returns focus to its entry', data.hidden && document.activeElement === footer.querySelector('.pg6-footer-drawer'));

  // Let the debounced settings writer reach only the stub above.
  await new Promise((resolve) => setTimeout(resolve, 350));
  check('settings writes are debounced', writes.length === 1 && writes[0] === 'set_settings');
  results.textContent = `${lines.join('\n')}\n\n${lines.length} checks passed`;
  results.dataset.result = 'pass';
} catch (error) {
  results.textContent = `${lines.join('\n')}\nFAIL ${error.message}`;
  results.dataset.result = 'fail';
} finally {
  delete window.__TAURI__;
  document.getElementById('fixture').hidden = true;
  document.body.style.cssText = 'overflow:auto;background:#fafafa;color:#222;padding:24px';
}
