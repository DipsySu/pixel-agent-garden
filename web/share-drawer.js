// Share drawer (PRD 2.0 §5.3 抽屉层, landed together with §P3-1) — ONE footer
// "Share" button in the old Postcard slot opening ONE compact paper panel
// that lists the share artifacts: the garden postcard, weekly recap, seasonal
// moment and year review cards. Same division of labor as web/data-drawer.js: this module owns the
// SHELL only (footer button wiring, panel, artifact menu, flow navigation,
// Escape-to-close, popover-group membership); what each flow shows is owned
// by its content provider (web/postcard.js, web/weekly-card.js,
// web/seasonal-card.js, web/year-card.js). Dropping a flow later means
// deleting its module, its FLOWS entry and its mount call — nothing else.

import { joinPopoverGroup } from './popover-group.js';
import { mountPostcardContent } from './postcard.js';
import { mountSeasonalCardContent } from './seasonal-card.js';
import { mountWeeklyCardContent } from './weekly-card.js';
import { mountYearCardContent } from './year-card.js';
import { escapeHtml } from './render-helpers.js';
import { t } from './i18n.js';

const FLOWS = [
  { id: 'postcard', icon: '🖼', nameKey: 'share.postcard.name', hintKey: 'share.postcard.hint' },
  { id: 'weekly', icon: '🗓', nameKey: 'share.weekly.name', hintKey: 'share.weekly.hint' },
  { id: 'seasonal', icon: '◈', nameKey: 'share.seasonal.name', hintKey: 'share.seasonal.hint' },
  { id: 'year', icon: '▦', nameKey: 'share.year.name', hintKey: 'share.year.hint' },
];

/**
 * @param {{
 *   scene: HTMLElement,
 *   assetRoot: string,
 *   getSummary: () => object | null,
 *   onError?: (message: string, err: unknown) => void,
 *   loadRings?: () => Promise<object | null>,
 * }} opts
 * @returns {{ open: (flowId?: string) => void, close: () => void } | null}
 */
export function mountShareDrawer({ scene, assetRoot, getSummary, onError, loadRings }) {
  const button = document.getElementById('share-open-button');
  const panel = document.getElementById('share-drawer-panel');
  if (!button || !panel) return null;

  panel.innerHTML = shellHtml();
  const back = panel.querySelector('.pg6-share-back');
  const menu = panel.querySelector('.pg6-share-menu');
  const hosts = new Map(
    FLOWS.map((flow) => [flow.id, panel.querySelector('[data-flow-host="' + flow.id + '"]')])
  );

  const providers = {
    postcard: mountPostcardContent({
      host: hosts.get('postcard'),
      scene,
      assetRoot,
      getSummary,
      onError,
      onRequestClose: closeAndRefocus,
    }),
    weekly: mountWeeklyCardContent({
      host: hosts.get('weekly'),
      getSummary,
      onError,
      onRequestClose: closeAndRefocus,
      loadRings,
    }),
    seasonal: mountSeasonalCardContent({
      host: hosts.get('seasonal'),
      getSummary,
      onError,
      onRequestClose: closeAndRefocus,
    }),
    year: mountYearCardContent({
      host: hosts.get('year'),
      getSummary,
      onError,
      onRequestClose: closeAndRefocus,
      loadRings,
    }),
  };

  button.addEventListener('click', () => toggle());
  back.addEventListener('click', () => showMenu({ focus: true }));
  menu.addEventListener('click', (event) => {
    const row = event.target instanceof Element ? event.target.closest('.pg6-share-item') : null;
    if (row && row.dataset.flow) openFlow(row.dataset.flow);
  });
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeAndRefocus();
    }
  });

  const closeOthers = joinPopoverGroup(() => toggle(false));

  function toggle(force) {
    const open = typeof force === 'boolean' ? force : panel.hidden;
    if (open) closeOthers();
    panel.hidden = !open;
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    button.classList.toggle('is-active', open);
    if (open) {
      // Reopening always lands on the artifact menu: flows re-render on
      // activation anyway, so there is no flow state worth restoring.
      showMenu({ focus: true });
    }
  }

  function closeAndRefocus() {
    toggle(false);
    button.focus();
  }

  function showMenu({ focus = false } = {}) {
    back.hidden = true;
    menu.hidden = false;
    hosts.forEach((host) => {
      host.hidden = true;
    });
    if (focus) menu.querySelector('.pg6-share-item')?.focus();
  }

  function openFlow(flowId) {
    const provider = providers[flowId];
    const host = hosts.get(flowId);
    if (!provider || !host) return;
    menu.hidden = true;
    hosts.forEach((other) => {
      other.hidden = other !== host;
    });
    back.hidden = false;
    provider.activate();
  }

  return {
    // `open('weekly')` is the Monday-offer banner's landing pad; a bare
    // open() presents the artifact menu.
    open: (flowId) => {
      toggle(true);
      if (flowId) openFlow(flowId);
    },
    close: () => toggle(false),
  };
}

function shellHtml() {
  const rows = FLOWS.map((flow) =>
    '<button class="pg6-share-item" type="button" data-flow="' + flow.id + '">' +
    '<span class="pg6-share-item-icon" aria-hidden="true">' + flow.icon + '</span>' +
    '<span class="pg6-share-item-text">' +
    '<span class="pg6-share-item-name">' + escapeHtml(t(flow.nameKey)) + '</span>' +
    '<span class="pg6-share-item-hint">' + escapeHtml(t(flow.hintKey)) + '</span>' +
    '</span>' +
    '</button>'
  ).join('');
  const flowHosts = FLOWS.map((flow) =>
    '<div class="pg6-share-flow" data-flow-host="' + flow.id + '" hidden></div>'
  ).join('');
  return (
    '<div class="pg6-share-head">' +
    '<button class="pg6-share-back" type="button" aria-label="' + escapeHtml(t('share.back')) + '" hidden>' +
    '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
    '<path d="M14 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>' +
    '</button>' +
    '<div class="pg6-share-title">' + escapeHtml(t('share.title')) + '</div>' +
    '</div>' +
    '<div class="pg6-share-menu">' + rows + '</div>' +
    flowHosts
  );
}
