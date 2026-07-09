// Inline settings panel — lives inside the footer. Click the gear button
// to expand a 4-control form. Changes are applied optimistically (onChange
// fires immediately) and persisted via setSettings() debounced 300ms.
//
// Browser fallback mode: all inputs render but disabled, with a note telling
// the user the desktop app is needed for persistence. The current values
// still render so the user can see what's configured.

import { setSettings, isTauriRuntime } from './data-source.js';
import { joinPopoverGroup } from './popover-group.js';
import { t } from './i18n.js';

const SAVE_DEBOUNCE_MS = 300;

// The combo the settings UI offers behind "enable recommended". Stored/registered
// in Tauri's cross-platform form; nothing is registered unless the user opts in.
export const RECOMMENDED_TOGGLE = 'CmdOrCtrl+Shift+G';

const CHOICES = {
  time_mode: [
    { value: 'system', labelKey: 'choice.system' },
    { value: 'day', labelKey: 'choice.day' },
    { value: 'dusk', labelKey: 'choice.dusk' },
    { value: 'night', labelKey: 'choice.night' }
  ],
  season_mode: [
    { value: 'system', labelKey: 'choice.date' },
    { value: 'spring', labelKey: 'choice.spring' },
    { value: 'summer', labelKey: 'choice.summer' },
    { value: 'autumn', labelKey: 'choice.autumn' },
    { value: 'winter', labelKey: 'choice.winter' }
  ],
  motion: [
    { value: 'system', labelKey: 'choice.system' },
    { value: 'reduced', labelKey: 'choice.reduced' },
    { value: 'off', labelKey: 'choice.off' }
  ],
  flowerbed: [
    { value: 'auto', labelKey: 'choice.auto' },
    { value: 'disabled', labelKey: 'choice.disabled' },
    { value: 'enabled', labelKey: 'choice.enabled' }
  ]
};

/**
 * @param {{
 *   hostFooter: HTMLElement,
 *   initial: object,
 *   onChange: (settings) => void
 * }} opts
 * @returns {{ get: () => object, update: (settings) => void }}
 */
export function mountSettingsPanel({ hostFooter, initial, onChange }) {
  let current = cloneSettings(initial);
  const canPersist = isTauriRuntime();
  let saveTimer = null;
  // True while the capture button is armed and waiting for the next keydown.
  let recording = false;

  // Gear button — sits inside the footer to the right of the freshness pill.
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pg6-footer-gear';
  button.setAttribute('aria-label', t('settings.aria'));
  button.setAttribute('aria-expanded', 'false');
  button.innerHTML = gearSvg();

  // Panel — appended after the footer. Hidden by default. Inline expansion
  // keeps the scene unobstructed; mobile gets a stacked variant via CSS.
  const panel = document.createElement('div');
  panel.className = 'pg6-settings-panel pg6-popover-scroll';
  panel.id = 'settings-panel';
  panel.hidden = true;
  panel.innerHTML = buildPanelHtml(current, canPersist);

  button.addEventListener('click', () => togglePanel());
  panel.addEventListener('change', (event) => handleControlChange(event));
  panel.addEventListener('click', (event) => handleShortcutClick(event));
  panel.addEventListener('keydown', (event) => handleShortcutKeydown(event));

  hostFooter.appendChild(button);
  hostFooter.parentElement.appendChild(panel);

  const closeOthers = joinPopoverGroup(() => togglePanel(false));

  function togglePanel(force) {
    const open = typeof force === 'boolean' ? force : panel.hidden;
    if (open) closeOthers();
    panel.hidden = !open;
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    button.classList.toggle('is-active', open);
  }

  function handleControlChange(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const next = cloneSettings(current);
    if (target.name === 'auto_rescan') {
      next.data.auto_rescan = target.checked;
    } else if (target.name === 'weekly_recap') {
      next.data.weekly_recap = target.checked;
    } else if (target.name === 'launch_at_login') {
      next.desktop.launch_at_login = target.checked;
    } else if (target.name === 'close_to_tray') {
      next.desktop.close_to_tray = target.checked;
    } else if (target.name in next.appearance) {
      next.appearance[target.name] = target.value;
    } else {
      return;
    }
    current = next;
    onChange(cloneSettings(current));
    schedulePersist();
  }

  // Apply a new toggle accelerator ('' = disabled), re-render the row, and
  // persist. The Tauri backend (un)registers on the resulting set_settings; a
  // taken/invalid combo comes back as a toast, so nothing here can wedge.
  function setToggleShortcut(accel) {
    recording = false;
    const next = cloneSettings(current);
    next.shortcuts.toggle_window = accel;
    current = next;
    panel.innerHTML = buildPanelHtml(current, canPersist);
    onChange(cloneSettings(current));
    schedulePersist();
  }

  function handleShortcutClick(event) {
    if (!canPersist) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest('[data-shortcut-recommend]')) {
      setToggleShortcut(RECOMMENDED_TOGGLE);
    } else if (target.closest('[data-shortcut-clear]')) {
      setToggleShortcut('');
    } else if (target.closest('[data-shortcut-capture]')) {
      // Arm: swap the label to a prompt and wait for the next keydown.
      recording = true;
      const btn = target.closest('[data-shortcut-capture]');
      btn.textContent = t('settings.shortcutPress');
      btn.classList.add('is-recording');
      btn.focus();
    }
  }

  function handleShortcutKeydown(event) {
    if (!recording) return;
    const btn = event.target instanceof Element
      ? event.target.closest('[data-shortcut-capture]')
      : null;
    if (!btn) return;
    // Escape cancels; a modifier-only press keeps waiting; a full combo commits.
    if (event.key === 'Escape') {
      event.preventDefault();
      recording = false;
      panel.innerHTML = buildPanelHtml(current, canPersist);
      return;
    }
    event.preventDefault();
    const accel = accelFromEvent(event);
    if (accel) setToggleShortcut(accel);
  }

  function schedulePersist() {
    if (!canPersist) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      // Fire-and-forget — failures surface via the toast pipeline.
      setSettings(current);
    }, SAVE_DEBOUNCE_MS);
  }

  return {
    get: () => cloneSettings(current),
    update: (next) => {
      current = cloneSettings(next);
      panel.innerHTML = buildPanelHtml(current, canPersist);
    }
  };
}

function buildPanelHtml(settings, canPersist) {
  const disabledAttr = canPersist ? '' : ' disabled';
  const note = canPersist
    ? ''
    : '<p class="pg6-settings-note">' + escape(t('settings.readOnly')) + '</p>';
  return (
    note +
    section(t('settings.appearance'), [
      radioGroup('time_mode', t('settings.time'), CHOICES.time_mode, settings.appearance.time_mode, disabledAttr),
      radioGroup('season_mode', t('settings.season'), CHOICES.season_mode, settings.appearance.season_mode, disabledAttr),
      radioGroup('motion', t('settings.motion'), CHOICES.motion, settings.appearance.motion, disabledAttr),
      radioGroup('flowerbed', t('settings.flowerbed'), CHOICES.flowerbed, settings.appearance.flowerbed, disabledAttr),
    ]) +
    section(t('settings.data'), [
      checkbox(
        'auto_rescan',
        t('settings.autoRescan'),
        t('settings.autoRescanHint'),
        settings.data.auto_rescan,
        disabledAttr
      ),
      checkbox(
        'weekly_recap',
        t('settings.weeklyRecap'),
        t('settings.weeklyRecapHint'),
        settings.data.weekly_recap,
        disabledAttr
      )
    ]) +
    section(t('settings.desktop'), [
      checkbox(
        'launch_at_login',
        t('settings.launchAtLogin'),
        t('settings.launchAtLoginHint'),
        settings.desktop.launch_at_login,
        disabledAttr
      ),
      checkbox(
        'close_to_tray',
        t('settings.closeToTray'),
        t('settings.closeToTrayHint'),
        settings.desktop.close_to_tray,
        disabledAttr
      )
    ]) +
    section(t('settings.shortcuts'), [
      shortcutRow(settings.shortcuts.toggle_window, canPersist)
    ])
  );
}

// Global-hotkey recorder row: a capture button showing the current combo (or
// "not set"), plus one-tap "enable recommended" and "clear". The capture button
// is armed on click and reads the next keydown (see the panel's keydown handler);
// nothing here touches the OS — it only edits the settings value the Tauri
// `shortcuts` module reconciles.
function shortcutRow(accel, canPersist) {
  const disabledAttr = canPersist ? '' : ' disabled';
  const display = accel ? formatAccel(accel) : t('settings.shortcutNone');
  const hint = t('settings.toggleWindowHint', { combo: formatAccel(RECOMMENDED_TOGGLE) });
  return (
    '<div class="pg6-settings-row pg6-shortcut-row">' +
    '<span class="pg6-settings-label">' + escape(t('settings.toggleWindow')) + '</span>' +
    '<div class="pg6-shortcut-controls">' +
    '<button type="button" class="pg6-shortcut-capture" data-shortcut-capture aria-label="' +
    escape(t('settings.shortcutRecordAria')) + '"' + disabledAttr + '>' + escape(display) + '</button>' +
    '<button type="button" class="pg6-shortcut-btn" data-shortcut-recommend' + disabledAttr + '>' +
    escape(t('settings.shortcutRecommend')) + '</button>' +
    '<button type="button" class="pg6-shortcut-btn" data-shortcut-clear' + disabledAttr + '>' +
    escape(t('settings.shortcutClear')) + '</button>' +
    '</div>' +
    '<span class="pg6-settings-hint">' + escape(hint) + '</span>' +
    '</div>'
  );
}

function section(title, rows) {
  return (
    '<section class="pg6-settings-section">' +
    '<h4 class="pg6-settings-title">' + escape(title) + '</h4>' +
    rows.join('') +
    '</section>'
  );
}

function radioGroup(name, label, options, value, disabledAttr) {
  const opts = options
    .map((opt) => {
      const checked = opt.value === value ? ' checked' : '';
      const id = 'pg6-set-' + name + '-' + opt.value;
      return (
        '<label class="pg6-settings-pill" for="' + id + '">' +
        '<input type="radio" id="' + id + '" name="' + name + '" value="' + opt.value + '"' + checked + disabledAttr + '>' +
        '<span>' + escape(t(opt.labelKey)) + '</span>' +
        '</label>'
      );
    })
    .join('');
  return (
    '<div class="pg6-settings-row">' +
    '<span class="pg6-settings-label">' + escape(label) + '</span>' +
    '<div class="pg6-settings-pills">' + opts + '</div>' +
    '</div>'
  );
}

function checkbox(name, label, hint, value, disabledAttr) {
  const id = 'pg6-set-' + name;
  const checked = value ? ' checked' : '';
  return (
    '<div class="pg6-settings-row">' +
    '<label class="pg6-settings-toggle" for="' + id + '">' +
    '<input type="checkbox" id="' + id + '" name="' + name + '"' + checked + disabledAttr + '>' +
    '<span class="pg6-settings-label">' + escape(label) + '</span>' +
    '</label>' +
    '<span class="pg6-settings-hint">' + escape(hint) + '</span>' +
    '</div>'
  );
}

function gearSvg() {
  return (
    '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
    '<path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z" fill="currentColor"/>' +
    '<path d="M19.4 12a7.5 7.5 0 0 0-.1-1.3l2-1.6-2-3.4-2.4.9a7.5 7.5 0 0 0-2.2-1.3L14.3 3h-4.6l-.4 2.4a7.5 7.5 0 0 0-2.2 1.3l-2.4-.9-2 3.4 2 1.6a7.5 7.5 0 0 0 0 2.6l-2 1.6 2 3.4 2.4-.9a7.5 7.5 0 0 0 2.2 1.3l.4 2.4h4.6l.4-2.4a7.5 7.5 0 0 0 2.2-1.3l2.4.9 2-3.4-2-1.6c.1-.4.1-.9.1-1.3Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>' +
    '</svg>'
  );
}

function escape(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  })[c]);
}

function cloneSettings(value) {
  return {
    appearance: {
      time_mode: value?.appearance?.time_mode || 'system',
      season_mode: value?.appearance?.season_mode || 'system',
      motion: value?.appearance?.motion || 'system',
      flowerbed: value?.appearance?.flowerbed || 'auto',
    },
    data: {
      auto_rescan: value?.data?.auto_rescan !== false,
      weekly_recap: value?.data?.weekly_recap !== false
    },
    integrations: {
      terminal: value?.integrations?.terminal || 'iterm',
      terminal_command: value?.integrations?.terminal_command || '',
      tray_top_n: Number.isInteger(value?.integrations?.tray_top_n) && value.integrations.tray_top_n > 0
        ? value.integrations.tray_top_n
        : 5
    },
    desktop: {
      launch_at_login: value?.desktop?.launch_at_login === true,
      close_to_tray: value?.desktop?.close_to_tray === true
    },
    // Round-trip the global hotkey through the panel's own state — without this
    // the recorder's value would be dropped on the next save (same drop-trap as
    // the data-source layer). Empty string = disabled.
    shortcuts: {
      toggle_window: typeof value?.shortcuts?.toggle_window === 'string' ? value.shortcuts.toggle_window : ''
    }
  };
}

function isMac() {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
}

// Map a keydown to a Tauri key token. event.code is layout-independent, so a
// French AZERTY 'A' and a US 'A' both record as "A"; a few named keys fall back
// through a table. Returns null for keys we don't accelerate.
function accelKeyName(event) {
  const code = event.code || '';
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);      // KeyG  -> G
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);    // Digit1 -> 1
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code; // F1..F24
  const named = {
    Space: 'Space', Enter: 'Enter', Backspace: 'Backspace',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Minus: '-', Equal: '='
  };
  return named[code] || null;
}

// Build a Tauri accelerator ("CmdOrCtrl+Shift+G") from a keydown, or null while
// only modifiers (or a weak Shift-only combo) are held so the recorder keeps
// waiting. The platform's primary modifier (⌘ on macOS, Ctrl elsewhere) maps to
// CmdOrCtrl so a combo recorded on one OS still works on the others. Exported
// for unit testing the mapping without a real keyboard.
export function accelFromEvent(event, mac = isMac()) {
  const key = accelKeyName(event);
  if (!key) return null;
  const primary = mac ? event.metaKey : event.ctrlKey;
  const secondary = mac ? event.ctrlKey : event.metaKey;
  // A global hotkey needs a "strong" modifier; Shift-only or bare keys would
  // fight normal typing, so reject them and keep recording.
  if (!primary && !secondary && !event.altKey) return null;
  const parts = [];
  if (primary) parts.push('CmdOrCtrl');
  if (secondary) parts.push(mac ? 'Control' : 'Super');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

// Present an accelerator for humans: ⌘⇧G on macOS, Ctrl+Shift+G elsewhere.
// Exported for tests. Unknown tokens pass through unchanged.
export function formatAccel(accel, mac = isMac()) {
  if (!accel) return '';
  const glyph = mac
    ? { CmdOrCtrl: '⌘', Cmd: '⌘', Command: '⌘', Super: '⌘', Control: '⌃', Ctrl: '⌃', Alt: '⌥', Option: '⌥', Shift: '⇧' }
    : { CmdOrCtrl: 'Ctrl', Cmd: 'Win', Command: 'Win', Super: 'Win', Control: 'Ctrl', Ctrl: 'Ctrl', Alt: 'Alt', Option: 'Alt', Shift: 'Shift' };
  const parts = accel.split('+').map((token) => glyph[token] || token);
  return mac ? parts.join('') : parts.join('+');
}
