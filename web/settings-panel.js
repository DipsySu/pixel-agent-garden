// Inline settings panel — lives inside the footer. Click the gear button
// to expand a 4-control form. Changes are applied optimistically (onChange
// fires immediately) and persisted via setSettings() debounced 300ms.
//
// Browser fallback mode: all inputs render but disabled, with a note telling
// the user the desktop app is needed for persistence. The current values
// still render so the user can see what's configured.

import { setSettings, isTauriRuntime } from './data-source.js';

const SAVE_DEBOUNCE_MS = 300;

const CHOICES = {
  time_mode: [
    { value: 'system', label: '跟随系统' },
    { value: 'day', label: '白日' },
    { value: 'dusk', label: '傍晚' },
    { value: 'night', label: '夜晚' }
  ],
  season_mode: [
    { value: 'system', label: '跟随日期' },
    { value: 'spring', label: '春' },
    { value: 'summer', label: '夏' },
    { value: 'autumn', label: '秋' },
    { value: 'winter', label: '冬' }
  ],
  motion: [
    { value: 'system', label: '跟随系统' },
    { value: 'reduced', label: '减弱' },
    { value: 'off', label: '关闭' }
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

  // Gear button — sits inside the footer to the right of the freshness pill.
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pg6-footer-gear';
  button.setAttribute('aria-label', '设置');
  button.setAttribute('aria-expanded', 'false');
  button.innerHTML = gearSvg();

  // Panel — appended after the footer. Hidden by default. Inline expansion
  // keeps the scene unobstructed; mobile gets a stacked variant via CSS.
  const panel = document.createElement('div');
  panel.className = 'pg6-settings-panel';
  panel.id = 'settings-panel';
  panel.hidden = true;
  panel.innerHTML = buildPanelHtml(current, canPersist);

  button.addEventListener('click', () => togglePanel());
  panel.addEventListener('change', (event) => handleControlChange(event));

  hostFooter.appendChild(button);
  hostFooter.parentElement.appendChild(panel);

  function togglePanel(force) {
    const open = typeof force === 'boolean' ? force : panel.hidden;
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
    } else if (target.name in next.appearance) {
      next.appearance[target.name] = target.value;
    } else {
      return;
    }
    current = next;
    onChange(cloneSettings(current));
    schedulePersist();
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
    : '<p class="pg6-settings-note">只读模式 · 在桌面 App 中打开以保存设置</p>';
  return (
    note +
    section('外观', [
      radioGroup('time_mode', '时间', CHOICES.time_mode, settings.appearance.time_mode, disabledAttr),
      radioGroup('season_mode', '季节', CHOICES.season_mode, settings.appearance.season_mode, disabledAttr),
      radioGroup('motion', '动画', CHOICES.motion, settings.appearance.motion, disabledAttr)
    ]) +
    section('数据', [
      checkbox(
        'auto_rescan',
        'watcher 实时更新',
        '关闭后,需要点 footer 刷新才会看到新的活动',
        settings.data.auto_rescan,
        disabledAttr
      )
    ])
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
        '<span>' + escape(opt.label) + '</span>' +
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
      motion: value?.appearance?.motion || 'system'
    },
    data: {
      auto_rescan: value?.data?.auto_rescan !== false
    }
  };
}
