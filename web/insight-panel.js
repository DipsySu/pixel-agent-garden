import { fmtLocal } from './render-helpers.js';
import { insightPanelHTML } from './render-insight.js';
import { joinPopoverGroup } from './popover-group.js';
import { t } from './i18n.js';

const DAYS = 14;
const LIMIT = 10;

export function mountInsightPanel({ hostFooter, initialSummary, onProjectSelect, onOpenTerminal }) {
  let currentSummary = initialSummary || null;
  // Client-side view state, preserved across re-renders (watcher ticks):
  // `query` filters rows by the row's data-search haystack; `showAll` lifts the
  // top-N cap. Both are pure DOM show/hide — no re-render on keystroke, so the
  // search input keeps focus.
  let query = '';
  let showAll = false;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pg6-footer-insight';
  button.setAttribute('aria-label', t('insight.openAria'));
  button.setAttribute('aria-expanded', 'false');
  button.innerHTML = insightSvg() + '<span>Insight</span>';

  const panel = document.createElement('div');
  // Sticky-head variant: the panel shell stops scrolling and only the
  // project list does, so title/summary/search stay put (dashboard keeps
  // the plain whole-panel scroll).
  panel.className = 'pg6-insight-panel pg6-insight-sticky-head';
  panel.id = 'token-insight-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', t('insight.dialogAria'));
  panel.hidden = true;
  render();

  button.addEventListener('click', () => togglePanel());
  panel.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const close = target.closest('.pg6-insight-close');
    if (close) {
      togglePanel(false);
      button.focus();
      return;
    }
    const showall = target.closest('.pg6-insight-showall');
    if (showall) {
      showAll = !showAll;
      applyFilter();
      return;
    }
    const term = target.closest('.pg6-insight-term');
    if (term) {
      const path = term.dataset.projectPath;
      if (path && typeof onOpenTerminal === 'function') onOpenTerminal(path);
      return;
    }
    const row = target.closest('.pg6-insight-row');
    if (!row) return;
    const key = row.dataset.projectKey;
    if (key && typeof onProjectSelect === 'function') {
      onProjectSelect(key);
      panel.querySelectorAll('.pg6-insight-row').forEach((item) => {
        item.classList.toggle('is-active', item === row);
      });
    }
  });
  // Live search — delegated so it survives re-renders. Pure show/hide.
  panel.addEventListener('input', (event) => {
    if (!(event.target instanceof Element)) return;
    if (!event.target.classList.contains('pg6-insight-search-input')) return;
    query = event.target.value.trim().toLowerCase();
    applyFilter();
  });
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      togglePanel(false);
      button.focus();
    }
  });

  hostFooter.appendChild(button);
  hostFooter.parentElement.appendChild(panel);

  // Re-render the panel HTML, then re-apply the live view state and restore the
  // search box (value + focus + caret) so a watcher tick mid-search isn't
  // disruptive.
  function render() {
    const input = panel.querySelector('.pg6-insight-search-input');
    const hadFocus = input && document.activeElement === input;
    const caret = input ? input.selectionStart : null;
    panel.innerHTML = insightPanelHTML(currentSummary, { days: DAYS, limit: LIMIT, format: fmtLocal });
    const fresh = panel.querySelector('.pg6-insight-search-input');
    if (fresh && query) fresh.value = query;
    if (fresh && hadFocus) {
      fresh.focus();
      if (caret != null) {
        try { fresh.setSelectionRange(caret, caret); } catch (_) { /* non-text input */ }
      }
    }
    applyFilter();
  }

  // The single source of truth for what's visible: a search query overrides the
  // top-N cap (search reaches every project); otherwise the cap applies unless
  // "show all" is on. Driven by two panel classes the CSS keys off.
  function applyFilter() {
    const searching = query.length > 0;
    panel.classList.toggle('is-searching', searching);
    panel.classList.toggle('is-showing-all', showAll);

    let visible = 0;
    panel.querySelectorAll('.pg6-insight-row-line').forEach((line) => {
      const haystack = line.dataset.search || '';
      const match = !searching || haystack.includes(query);
      line.hidden = !match;
      if (match && (showAll || searching || !line.classList.contains('is-extra'))) visible += 1;
    });

    const empty = panel.querySelector('.pg6-insight-noresults');
    if (empty) empty.hidden = !(searching && visible === 0);

    // While searching, the cap is irrelevant — hide the toggle. Otherwise label
    // it for the current direction.
    const toggle = panel.querySelector('.pg6-insight-showall');
    if (toggle) {
      toggle.hidden = searching;
      const extra = Number(toggle.dataset.extra || 0);
      const topn = Number(toggle.dataset.topn || 0);
      toggle.textContent = showAll ? t('insight.showTop', { count: topn }) : t('insight.showAll', { count: extra });
    }
  }

  const closeOthers = joinPopoverGroup(() => togglePanel(false));

  function togglePanel(force) {
    const open = typeof force === 'boolean' ? force : panel.hidden;
    if (open) closeOthers();
    panel.hidden = !open;
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    button.classList.toggle('is-active', open);
    if (open) {
      (panel.querySelector('.pg6-insight-search-input') || panel.querySelector('.pg6-insight-close'))?.focus();
    }
  }

  return {
    update: (summary) => {
      currentSummary = summary || null;
      render();
    }
  };
}

function insightSvg() {
  return (
    '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
    '<path d="M4 17h16M6 14l3-5 4 3 5-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M6 19h12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
    '</svg>'
  );
}
