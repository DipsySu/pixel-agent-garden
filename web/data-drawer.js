// Data drawer — ONE footer "Data" button opening ONE panel that hosts the
// former Insight and Dashboard panels as tabs (PRD 2.0 §5.3 information
// architecture, §5.4-D TabBar wireframe; decision §8.1 "merge"). This module
// owns the SHELL only: the footer button, the dialog panel, the pill TabBar,
// tab switching + memory, Escape-to-close and popover-group membership. What
// each tab shows is owned by its content provider (web/dashboard-panel.js →
// Overview, web/insight-panel.js → Projects, plus the v1.5 data tabs);
// dropping a view later means
// deleting its module, its TABS entry and its mount call below — nothing else.

import { joinPopoverGroup } from './popover-group.js';
import { mountCompositionContent } from './composition-panel.js';
import { mountCostContent } from './cost-panel.js';
import { mountDashboardContent } from './dashboard-panel.js';
import { mountExportContent } from './export-panel.js';
import { mountInsightContent } from './insight-panel.js';
import { mountRingsContent } from './rings-panel.js';
import { t } from './i18n.js';

// Last-open tab survives restarts (§5.4-D: "打开默认回上次 tab").
const TAB_STORAGE_KEY = 'pg6.drawer.tab';
const DEFAULT_TAB = 'overview';
// `scroll` marks tabs whose whole panel scrolls (they get pg6-popover-scroll);
// Projects keeps the sticky-head variant where only its inner list scrolls.
// One spec array — a new tab that forgets `scroll: true` overflows visibly in
// review instead of silently missing from a second hand-maintained list.
const TABS = [
  { id: 'overview', labelKey: 'drawer.tab.overview', scroll: true },
  { id: 'projects', labelKey: 'drawer.tab.projects', scroll: false },
  { id: 'composition', labelKey: 'drawer.tab.composition', scroll: true },
  { id: 'cost', labelKey: 'drawer.tab.cost', scroll: true },
  { id: 'rings', labelKey: 'drawer.tab.rings', scroll: true },
  { id: 'export', labelKey: 'drawer.tab.export', scroll: true },
];

/**
 * @param {{
 *   hostFooter: HTMLElement,
 *   initialSummary: object | null,
 *   onProjectSelect?: (projectKey: string) => void,
 *   onOpenTerminal?: (path: string) => void,
 *   loadCostEstimate?: () => Promise<object | null>,
 *   loadRings?: () => Promise<object | null>,
 *   saveExportText?: (text: string, suggestedName: string, mimeType: string) => Promise<boolean>,
 *   onError?: (message: string, err: unknown) => void,
 * }} opts
 * @returns {{ update: (summary: object | null) => void, open: (tab?: string) => void }}
 */
export function mountDataDrawer({
  hostFooter,
  initialSummary,
  onProjectSelect,
  onOpenTerminal,
  loadCostEstimate,
  loadRings,
  saveExportText,
  onError,
}) {
  let activeTab = restoreTab();
  // Latest visible-frame summary; hidden tabs replay it on activation instead
  // of receiving every watcher tick.
  let pendingSummary = initialSummary || null;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pg6-footer-insight pg6-footer-drawer';
  button.setAttribute('aria-label', t('drawer.openAria'));
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', 'data-drawer-panel');
  button.innerHTML = drawerSvg();
  const label = document.createElement('span');
  label.textContent = t('drawer.button');
  button.appendChild(label);

  // Reuses the shared paper shell (.pg6-insight-panel) and keeps the dashboard
  // variant class so its styling still reaches the Overview content;
  // .pg6-drawer-panel only adds the TabBar row + per-tab scroll split.
  const panel = document.createElement('div');
  panel.className = 'pg6-insight-panel pg6-dashboard-panel pg6-drawer-panel';
  panel.id = 'data-drawer-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', t('drawer.dialogAria'));
  panel.hidden = true;

  const tablist = document.createElement('div');
  tablist.className = 'pg6-drawer-tabs';
  tablist.setAttribute('role', 'tablist');

  const tabButtons = new Map();
  const tabPanels = new Map();
  TABS.forEach((tab) => {
    const tabButton = document.createElement('button');
    tabButton.type = 'button';
    tabButton.className = 'pg6-drawer-tab';
    tabButton.id = 'data-drawer-tab-' + tab.id;
    tabButton.setAttribute('role', 'tab');
    tabButton.setAttribute('aria-controls', 'data-drawer-tabpanel-' + tab.id);
    tabButton.textContent = t(tab.labelKey);
    tabButton.addEventListener('click', () => selectTab(tab.id));
    tablist.appendChild(tabButton);
    tabButtons.set(tab.id, tabButton);

    const tabPanel = document.createElement('div');
    tabPanel.className = 'pg6-drawer-tabpanel';
    tabPanel.id = 'data-drawer-tabpanel-' + tab.id;
    tabPanel.setAttribute('role', 'tabpanel');
    tabPanel.setAttribute('aria-labelledby', tabButton.id);
    tabPanels.set(tab.id, tabPanel);
  });

  // Scroll split (§5.4-D: "各 tab 独立滚动", TabBar stays pinned) — driven by
  // the TABS spec so there is exactly one list to maintain.
  TABS.filter((tab) => tab.scroll).forEach((tab) => {
    tabPanels.get(tab.id)?.classList.add('pg6-popover-scroll');
  });

  panel.appendChild(tablist);
  TABS.forEach((tab) => panel.appendChild(tabPanels.get(tab.id)));

  const providers = {
    overview: mountDashboardContent({
      host: tabPanels.get('overview'),
      initialSummary,
      onRequestClose: closeAndRefocus,
    }),
    projects: mountInsightContent({
      host: tabPanels.get('projects'),
      initialSummary,
      onProjectSelect,
      onOpenTerminal,
      loadCostEstimate,
      onRequestClose: closeAndRefocus,
    }),
    composition: mountCompositionContent({
      host: tabPanels.get('composition'),
      initialSummary,
      onRequestClose: closeAndRefocus,
    }),
    cost: mountCostContent({
      host: tabPanels.get('cost'),
      loadCostEstimate,
      onRequestClose: closeAndRefocus,
    }),
    rings: mountRingsContent({
      host: tabPanels.get('rings'),
      loadRings,
      onRequestClose: closeAndRefocus,
    }),
    export: mountExportContent({
      host: tabPanels.get('export'),
      initialSummary,
      saveExportText,
      onError,
      onRequestClose: closeAndRefocus,
    }),
  };

  button.addEventListener('click', () => toggle());
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeAndRefocus();
    }
  });
  // ARIA tabs pattern: Left/Right arrows move + select within the tablist
  // (selection follows focus, wrapping across all tabs).
  tablist.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const ids = TABS.map((tab) => tab.id);
    const delta = event.key === 'ArrowRight' ? 1 : -1;
    const next = ids[(ids.indexOf(activeTab) + delta + ids.length) % ids.length];
    selectTab(next);
    tabButtons.get(next)?.focus();
  });

  hostFooter.appendChild(button);
  hostFooter.parentElement.appendChild(panel);
  syncTabs();

  const closeOthers = joinPopoverGroup(() => toggle(false));

  function toggle(force) {
    const open = typeof force === 'boolean' ? force : panel.hidden;
    if (open) closeOthers();
    panel.hidden = !open;
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    button.classList.toggle('is-active', open);
    if (open) {
      flushToActive();
      // Focus lands on the active tab: one predictable target for keyboard
      // users, and the search box (Projects) stays a single Tab press away.
      tabButtons.get(activeTab)?.focus();
    }
  }

  function closeAndRefocus() {
    toggle(false);
    button.focus();
  }

  function selectTab(tabId) {
    if (!tabButtons.has(tabId)) return;
    activeTab = tabId;
    persistTab(tabId);
    syncTabs();
    if (!panel.hidden) flushToActive();
  }

  // Bring the tab the user is actually looking at up to date: replay the last
  // summary (ticks are not forwarded while hidden) and let the provider run
  // its activation work (rings re-reads its book, cost retries a failed price
  // load). Providers without activate() just get the summary.
  function flushToActive() {
    const provider = providers[activeTab];
    if (!provider) return;
    provider.update(pendingSummary);
    provider.activate?.();
  }

  function syncTabs() {
    TABS.forEach((tab) => {
      const selected = tab.id === activeTab;
      const tabButton = tabButtons.get(tab.id);
      tabButton.setAttribute('aria-selected', selected ? 'true' : 'false');
      // Roving tabindex: only the selected tab sits in the Tab order.
      tabButton.tabIndex = selected ? 0 : -1;
      tabPanels.get(tab.id).hidden = !selected;
    });
  }

  return {
    // Visible-frame updates only reach the tab the user can see; hidden tabs
    // (and a closed drawer) stash the frame and catch up in flushToActive()
    // when they become visible. This keeps hidden providers from re-rendering
    // — and rings from touching the disk — on every watcher tick (review
    // finding). The drawer stays ignorant of the summary shape.
    update: (summary) => {
      pendingSummary = summary;
      if (!panel.hidden) providers[activeTab]?.update(summary);
    },
    open: (tab) => {
      if (tab) selectTab(tab);
      toggle(true);
    },
  };
}

function restoreTab() {
  try {
    const stored = window.localStorage && window.localStorage.getItem(TAB_STORAGE_KEY);
    if (TABS.some((tab) => tab.id === stored)) return stored;
  } catch (_) {
    // localStorage may be blocked in some embedded/fallback contexts.
  }
  return DEFAULT_TAB;
}

function persistTab(tabId) {
  try {
    window.localStorage && window.localStorage.setItem(TAB_STORAGE_KEY, tabId);
  } catch (_) {
    // ignore — non-persistent session
  }
}

function drawerSvg() {
  // Rising-chart icon (the §5.3 wireframe's 📈 数据 entry) — inherited from
  // the old Insight button so the footer keeps a familiar shape.
  return (
    '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
    '<path d="M4 17h16M6 14l3-5 4 3 5-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M6 19h12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
    '</svg>'
  );
}
