// Token Insight content — the "Projects" tab of the data drawer (PRD 2.0
// §5.3 information architecture, decision §8.1: Insight + Dashboard merge
// behind one footer button). This module is a content provider: it renders
// the project ranking + live search INTO the host element the drawer hands
// it, and owns only what happens inside that host. The footer button, panel
// shell, TabBar, open/close and Escape handling live in web/data-drawer.js —
// so do their styles; nothing here knows the drawer exists beyond the
// onRequestClose callback.

import { fmtLocal } from './render-helpers.js';
import { insightPanelHTML } from './render-insight.js';
import { formatUsd } from './cost-estimate.js';
import { t } from './i18n.js';

const DAYS = 14;
const LIMIT = 10;

export function mountInsightContent({ host, initialSummary, onProjectSelect, onOpenTerminal, onRequestClose, loadCostEstimate }) {
  let currentSummary = initialSummary || null;
  // Whole-garden SummaryCost from core, fetched once on activation and reused
  // across watcher ticks (the project rows re-render, but the cost figures do
  // not need re-fetching per tick).
  let cost = null;
  let costLoading = false;
  let costRequested = false;
  let requestId = 0;
  // Client-side view state, preserved across re-renders (watcher ticks):
  // `query` filters rows by the row's data-search haystack; `showAll` lifts the
  // top-N cap. Both are pure DOM show/hide — no re-render on keystroke, so the
  // search input keeps focus.
  let query = '';
  let showAll = false;

  // Sticky-head layout (head/summary/search pinned, only the list scrolls) is
  // this content's own contract, so the class travels with the content rather
  // than with the drawer shell. The list brings its own pg6-popover-scroll
  // class from render-insight.js.
  host.classList.add('pg6-insight-sticky-head');
  render();

  host.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const close = target.closest('.pg6-insight-close');
    if (close) {
      if (typeof onRequestClose === 'function') onRequestClose();
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
      host.querySelectorAll('.pg6-insight-row').forEach((item) => {
        item.classList.toggle('is-active', item === row);
      });
    }
  });
  // Live search — delegated so it survives re-renders. Pure show/hide.
  host.addEventListener('input', (event) => {
    if (!(event.target instanceof Element)) return;
    if (!event.target.classList.contains('pg6-insight-search-input')) return;
    query = event.target.value.trim().toLowerCase();
    applyFilter();
  });

  // Re-render the content HTML, then re-apply the live view state and restore
  // the search box (value + focus + caret) so a watcher tick mid-search isn't
  // disruptive.
  function render() {
    const input = host.querySelector('.pg6-insight-search-input');
    const hadFocus = input && document.activeElement === input;
    const caret = input ? input.selectionStart : null;
    host.innerHTML = insightPanelHTML(currentSummary, {
      days: DAYS,
      limit: LIMIT,
      format: fmtLocal,
      projectCostByKey: projectCostMap(cost)
    });
    const fresh = host.querySelector('.pg6-insight-search-input');
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
  // "show all" is on. Driven by two host classes the CSS keys off.
  function applyFilter() {
    const searching = query.length > 0;
    host.classList.toggle('is-searching', searching);
    host.classList.toggle('is-showing-all', showAll);

    let visible = 0;
    host.querySelectorAll('.pg6-insight-row-line').forEach((line) => {
      const haystack = line.dataset.search || '';
      const match = !searching || haystack.includes(query);
      line.hidden = !match;
      if (match && (showAll || searching || !line.classList.contains('is-extra'))) visible += 1;
    });

    const empty = host.querySelector('.pg6-insight-noresults');
    if (empty) empty.hidden = !(searching && visible === 0);

    // While searching, the cap is irrelevant — hide the toggle. Otherwise label
    // it for the current direction.
    const toggle = host.querySelector('.pg6-insight-showall');
    if (toggle) {
      toggle.hidden = searching;
      const extra = Number(toggle.dataset.extra || 0);
      const topn = Number(toggle.dataset.topn || 0);
      toggle.textContent = showAll ? t('insight.showTop', { count: topn }) : t('insight.showAll', { count: extra });
    }
  }

  return {
    update: (summary) => {
      currentSummary = summary || null;
      render();
    },
    activate: () => {
      if (!costRequested && !costLoading) refreshCost();
    },
  };

  async function refreshCost() {
    costRequested = true;
    const id = ++requestId;
    costLoading = true;
    try {
      cost = typeof loadCostEstimate === 'function' ? await loadCostEstimate() : null;
    } catch (_) {
      cost = null;
    } finally {
      if (id === requestId) {
        costLoading = false;
        render();
      }
    }
  }
}

// Build the render-insight per-key cost lookup from core's SummaryCost. The
// backend already skipped tokenless projects and keyed by project_key, so we
// just format: no math, no filtering. Returns null before the estimate loads.
function projectCostMap(cost) {
  if (!cost || !cost.by_project) return null;
  const out = new Map();
  for (const [key, estimate] of Object.entries(cost.by_project)) {
    out.set(key, {
      label: formatUsd(estimate.total_usd),
      unpricedTokens: estimate.unpriced_tokens || 0
    });
  }
  return out;
}
