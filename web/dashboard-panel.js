// Dashboard panel — footer button + full-screen overlay showing the
// year heatmap, the hour-of-week punchcard, and a row of KPI summary
// cards. Uses the same footer-button / dialog pattern as Insight and
// Postcard so users get one consistent "click this gear-shape to expand"
// muscle memory.

import { renderHeatmap, renderHourOfWeek } from './render-heatmap.js';
import { t } from './i18n.js';

const PALETTE_FALLBACK = ['—', 'Low', 'Mid', 'High', 'Peak'];

/**
 * @param {{
 *   hostFooter: HTMLElement,
 *   initialSummary: object | null,
 * }} opts
 * @returns {{ update: (summary: object | null) => void, open: () => void }}
 */
export function mountDashboardPanel({ hostFooter, initialSummary }) {
  let currentSummary = initialSummary || null;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pg6-footer-insight pg6-footer-dashboard';
  button.setAttribute('aria-label', t('dashboard.openAria'));
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', 'dashboard-panel');
  button.innerHTML = dashboardSvg() + '<span data-i18n="dashboard.button">Dashboard</span>';

  const panel = document.createElement('div');
  panel.className = 'pg6-insight-panel pg6-dashboard-panel';
  panel.id = 'dashboard-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', t('dashboard.dialogAria'));
  panel.hidden = true;
  panel.innerHTML = shellHtml();

  button.addEventListener('click', () => toggle());
  panel.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest('.pg6-insight-close')) {
      toggle(false);
      button.focus();
    }
  });
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      toggle(false);
      button.focus();
    }
  });

  hostFooter.appendChild(button);
  hostFooter.parentElement.appendChild(panel);

  render();

  function toggle(force) {
    const open = typeof force === 'boolean' ? force : panel.hidden;
    panel.hidden = !open;
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    button.classList.toggle('is-active', open);
    if (open) render();
  }

  function render() {
    if (panel.hidden) return;
    renderKpis(panel, currentSummary);
    const heatmapHost = panel.querySelector('[data-slot="heatmap"]');
    if (heatmapHost) {
      renderHeatmap(heatmapHost, currentSummary?.heatmap_year || [], { mode: 'full' });
    }
    const punchcardHost = panel.querySelector('[data-slot="punchcard"]');
    if (punchcardHost) {
      renderHourOfWeek(punchcardHost, currentSummary?.hour_of_week || []);
    }
  }

  return {
    update: (summary) => {
      currentSummary = summary;
      render();
    },
    open: () => toggle(true),
  };
}

function shellHtml() {
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

function renderKpis(panel, summary) {
  const host = panel.querySelector('[data-slot="kpis"]');
  if (!host) return;
  const k = computeKpis(summary);
  host.innerHTML = `
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

function dashboardSvg() {
  // Four-square dashboard icon — distinguishable from gear (settings) and
  // postcard (square + sun). Keeps with the existing 14×14 button icon
  // convention.
  return `
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <rect x="4"  y="4"  width="7" height="7" fill="none" stroke="currentColor" stroke-width="2"/>
      <rect x="13" y="4"  width="7" height="7" fill="none" stroke="currentColor" stroke-width="2"/>
      <rect x="4"  y="13" width="7" height="7" fill="none" stroke="currentColor" stroke-width="2"/>
      <rect x="13" y="13" width="7" height="7" fill="none" stroke="currentColor" stroke-width="2"/>
    </svg>`;
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
