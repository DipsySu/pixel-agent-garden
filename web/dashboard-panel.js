// Dashboard content — the "Overview" tab of the data drawer (PRD 2.0 §5.3
// information architecture, decision §8.1: Insight + Dashboard merge behind
// one footer button). This module is a content provider: it renders the KPI
// summary cards, the year heatmap and the hour-of-week punchcard INTO the
// host element the drawer hands it. The footer button and panel shell this
// module used to own live in web/data-drawer.js now; removing this view
// later = deleting this module plus its tab entry in the drawer.

import { renderHeatmap, renderHourOfWeek } from './render-heatmap.js';
import { t } from './i18n.js';

/**
 * @param {{
 *   host: HTMLElement,
 *   initialSummary: object | null,
 *   onRequestClose?: () => void,
 * }} opts
 * @returns {{ update: (summary: object | null) => void }}
 */
export function mountDashboardContent({ host, initialSummary, onRequestClose }) {
  let currentSummary = initialSummary || null;

  host.innerHTML = contentHtml();
  host.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest('.pg6-insight-close') && typeof onRequestClose === 'function') {
      onRequestClose();
    }
  });
  render();

  // Unlike the old standalone panel (which rendered lazily on open), the
  // content re-renders on every update even while its tab is hidden: the
  // heatmap/punchcard SVGs are fixed-size (no layout measuring), and an
  // always-warm tab means the drawer never has to signal visibility to its
  // providers — the same policy the insight list already follows.
  function render() {
    renderKpis(host, currentSummary);
    const heatmapHost = host.querySelector('[data-slot="heatmap"]');
    if (heatmapHost) {
      renderHeatmap(heatmapHost, currentSummary?.heatmap_year || [], { mode: 'full' });
    }
    const punchcardHost = host.querySelector('[data-slot="punchcard"]');
    if (punchcardHost) {
      renderHourOfWeek(punchcardHost, currentSummary?.hour_of_week || []);
    }
  }

  return {
    update: (summary) => {
      currentSummary = summary;
      render();
    },
  };
}

function contentHtml() {
  const close = `
    <button class="pg6-insight-close" type="button" aria-label="${escape(t('dashboard.closeAria'))}">
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <path d="M6 6 18 18 M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
    </button>`;
  return `
    <div class="pg6-insight-head">
      <div>
        <div class="pg6-insight-label">${escape(t('dashboard.label'))}</div>
        <div class="pg6-insight-title">${escape(t('dashboard.title'))}</div>
      </div>
      ${close}
    </div>
    <div class="pg6-dashboard-kpis" data-slot="kpis"></div>
    <div class="pg6-dashboard-section">
      <div class="pg6-dashboard-section-head">
        <h3 class="pg6-dashboard-h3">${escape(t('dashboard.heatmapTitle'))}</h3>
        <span class="pg6-dashboard-h3-hint">${escape(t('dashboard.heatmapHint'))}</span>
      </div>
      <div class="pg6-dashboard-heatmap-host" data-slot="heatmap"></div>
      <div class="pg6-dashboard-legend">
        <span>${escape(t('dashboard.legendLess'))}</span>
        <span class="pg6-heatmap-swatch" data-level="0"></span>
        <span class="pg6-heatmap-swatch" data-level="1"></span>
        <span class="pg6-heatmap-swatch" data-level="2"></span>
        <span class="pg6-heatmap-swatch" data-level="3"></span>
        <span class="pg6-heatmap-swatch" data-level="4"></span>
        <span>${escape(t('dashboard.legendMore'))}</span>
      </div>
    </div>
    <div class="pg6-dashboard-section">
      <div class="pg6-dashboard-section-head">
        <h3 class="pg6-dashboard-h3">${escape(t('dashboard.punchcardTitle'))}</h3>
        <span class="pg6-dashboard-h3-hint">${escape(t('dashboard.punchcardHint'))}</span>
      </div>
      <div class="pg6-dashboard-punchcard-host" data-slot="punchcard"></div>
    </div>`;
}

function renderKpis(host, summary) {
  const slot = host.querySelector('[data-slot="kpis"]');
  if (!slot) return;
  const k = computeKpis(summary);
  slot.innerHTML = `
    ${kpiCard(t('dashboard.kpi.totalTokens'), formatTokens(k.totalTokens), '')}
    ${kpiCard(t('dashboard.kpi.activeProjects'), String(k.activeProjects), '')}
    ${kpiCard(t('dashboard.kpi.activeDays'), `${k.activeDays} / 365`, '')}
    ${kpiCard(t('dashboard.kpi.thisWeek'), formatTokens(k.thisWeek), `vs ${formatTokens(k.lastWeek)} ${escape(t('dashboard.kpi.thisWeekVs'))}`)}
    ${kpiCard(t('dashboard.kpi.bestDay'), formatTokens(k.bestDayValue), k.bestDayDate)}
    ${kpiCard(t('dashboard.kpi.longestStreak'), `${k.streak} ${escape(t('dashboard.kpi.streakUnit'))}`, '')}
  `;
}

function computeKpis(summary) {
  const heatmap = Array.isArray(summary?.heatmap_year) ? summary.heatmap_year : [];
  const totalTokens = summary?.total_tokens || 0;
  const activeProjects = summary?.active_projects || (summary?.projects?.length || 0);
  const activeDays = heatmap.filter((e) => e && e.value > 0).length;

  // Last 7 days vs previous 7 days. Heatmap is oldest-first so the tail
  // is the most recent week.
  const len = heatmap.length;
  const thisWeek = sumRange(heatmap, len - 7, len);
  const lastWeek = sumRange(heatmap, len - 14, len - 7);

  // Best day = max value in the rolling year.
  let best = { value: 0, date: '—' };
  for (const e of heatmap) {
    if (e && e.value > best.value) best = { value: e.value, date: e.date };
  }

  // Longest non-zero streak.
  let streak = 0;
  let run = 0;
  for (const e of heatmap) {
    if (e && e.value > 0) {
      run += 1;
      if (run > streak) streak = run;
    } else {
      run = 0;
    }
  }

  return {
    totalTokens,
    activeProjects,
    activeDays,
    thisWeek,
    lastWeek,
    bestDayValue: best.value,
    bestDayDate: best.date,
    streak,
  };
}

function sumRange(heatmap, start, end) {
  let s = 0;
  for (let i = Math.max(0, start); i < Math.min(heatmap.length, end); i++) {
    s += heatmap[i]?.value || 0;
  }
  return s;
}

function kpiCard(label, value, sub) {
  return `
    <div class="pg6-dashboard-kpi">
      <div class="pg6-dashboard-kpi-label">${escape(label)}</div>
      <div class="pg6-dashboard-kpi-value">${escape(value)}</div>
      ${sub ? `<div class="pg6-dashboard-kpi-sub">${escape(sub)}</div>` : ''}
    </div>`;
}

function formatTokens(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n || 0);
}

function escape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  })[c]);
}
