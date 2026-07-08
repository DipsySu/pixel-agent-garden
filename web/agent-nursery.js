// Agent nursery (PRD 2.0 §P2). This turns adapter/source token share into a
// small set of wall-root plots: one local agent "tends" one bed. It consumes
// source token rollups when schema v9 is present and falls back to older
// summaries gracefully. The persisted setting still uses the historical
// `appearance.flowerbed` field to avoid a settings migration.

import { escapeHtml, fmtLocal, sourceLabel } from './render-helpers.js';
import { hideInfoCard, infoMetaRow, setInfoCard, showInfoCard } from './info-card.js';
import { t } from './i18n.js';

const POSITIONS = [
  { x: 18, y: 13 },
  { x: 34, y: 8 },
  { x: 68, y: 10 },
  { x: 84, y: 15 },
];

export function isAgentNurseryEnabled(settings, search = currentSearch(), summary = null) {
  const override = nurseryQueryOverride(search);
  if (override !== null) return override;
  const mode = settings?.appearance?.flowerbed || 'auto';
  if (mode === 'enabled') return true;
  if (mode === 'disabled') return false;
  return shouldAutoShowNursery(summary);
}

export function nurseryQueryOverride(search = currentSearch()) {
  try {
    const value = (new URLSearchParams(search).get('nursery') || '').toLowerCase();
    if (!value) return null;
    if (['1', 'true', 'enabled', 'on'].includes(value)) return true;
    if (['0', 'false', 'disabled', 'off'].includes(value)) return false;
  } catch (_) {
    return null;
  }
  return null;
}

export function mountAgentNursery({ host }) {
  let root = null;

  function ensureRoot() {
    if (root && root.isConnected) return root;
    root = document.createElement('div');
    root.className = 'pg6-agent-nursery';
    root.setAttribute('aria-label', t('nursery.aria'));
    host.appendChild(root);
    return root;
  }

  return {
    update(summary, options = {}) {
      const enabled = options.enabled === true;
      const rows = nurseryRows(summary).slice(0, 4);
      const el = ensureRoot();
      el.hidden = !enabled || rows.length === 0;
      if (!enabled || rows.length === 0) {
        el.innerHTML = '';
        return;
      }
      el.innerHTML = rows.map((row, index) => plotHtml(row, POSITIONS[index] || POSITIONS[0])).join('');
      wirePlotCards(el, rows);
    }
  };
}

export function nurseryRows(summary) {
  const recent = tokenMap(summary?.source_recent_tokens || {});
  const lifetime = tokenUsageMap(summary?.source_tokens || {});
  const eventCounts = summary?.sources || {};
  const ids = new Set([
    ...Object.keys(recent),
    ...Object.keys(lifetime),
    ...Object.keys(eventCounts)
  ]);
  const recentTotal = sumValues(recent);
  const lifetimeTotal = sumValues(lifetime);
  const eventTotal = sumValues(eventCounts);

  const rows = [];
  for (const id of ids) {
    const lifetimeTokens = lifetime[id] || 0;
    const recentTokens = recent[id] || 0;
    const fallbackEvents = Number(eventCounts[id] || 0);
    const basis =
      recentTotal > 0 ? recentTokens :
      lifetimeTotal > 0 ? lifetimeTokens :
      fallbackEvents;
    const denom =
      recentTotal > 0 ? recentTotal :
      lifetimeTotal > 0 ? lifetimeTotal :
      eventTotal;
    const share = denom > 0 ? basis / denom : 0;
    rows.push({
      id,
      label: sourceLabel(id, t),
      recentTokens,
      lifetimeTokens,
      eventCount: fallbackEvents,
      share,
      fallow: lifetimeTokens > 0 && recentTotal > 0 && recentTokens === 0,
      status: agentPlotStatus({ share, lifetimeTokens, recentTokens, recentTotal })
    });
  }
  rows.sort((a, b) =>
    b.recentTokens - a.recentTokens ||
    b.lifetimeTokens - a.lifetimeTokens ||
    b.eventCount - a.eventCount ||
    a.id.localeCompare(b.id)
  );
  return rows;
}

export function shouldAutoShowNursery(summary) {
  return nurseryRows(summary).filter((row) => row.lifetimeTokens > 0 || row.recentTokens > 0 || row.eventCount > 0).length >= 2;
}

function plotHtml(row, pos) {
  const density = Math.max(0.18, Math.min(1, row.share || 0));
  const sprouts = Math.max(2, Math.min(7, Math.round(density * 7)));
  const soilWidth = Math.round(34 + density * 28);
  const sproutHeight = Math.round(9 + density * 13);
  const title = row.fallow
    ? t('nursery.tooltipFallow', { source: row.label, total: fmtLocal(row.lifetimeTokens) })
    : t('nursery.tooltip', { source: row.label, share: percent(row.share), recent: fmtLocal(row.recentTokens || row.lifetimeTokens) });
  const sproutHtml = Array.from({ length: sprouts }, (_, i) =>
    '<span style="--sprout-x:' + (5 + i * 8) + 'px;--sprout-tilt:' + ((i - 3) * 2) + 'deg"></span>'
  ).join('');
  return `
    <div class="pg6-agent-plot is-${escapeHtml(row.status)}"
      style="--plot-x:${pos.x}%;--plot-y:${pos.y}%;--soil-w:${soilWidth}px;--sprout-h:${sproutHeight}px"
      data-agent-id="${escapeHtml(row.id)}"
      data-status="${escapeHtml(row.status)}"
      tabindex="0"
      title="${escapeHtml(title)}"
      aria-label="${escapeHtml(title)}">
      <div class="pg6-agent-soil" aria-hidden="true">${sproutHtml}</div>
      <div class="pg6-agent-label">${escapeHtml(row.label)} · ${escapeHtml(percent(row.share))}</div>
    </div>`;
}

function wirePlotCards(root, rows) {
  root.querySelectorAll('.pg6-agent-plot').forEach((plot, index) => {
    const row = rows[index];
    if (!row) return;
    plot.addEventListener('mouseenter', (event) => showAgentPlotCard(row, { event, anchor: plot }));
    plot.addEventListener('mousemove', (event) => showAgentPlotCard(row, { event, anchor: plot }));
    plot.addEventListener('focus', () => showAgentPlotCard(row, { anchor: plot }));
    plot.addEventListener('mouseleave', hideInfoCard);
    plot.addEventListener('blur', hideInfoCard);
  });
}

export function showAgentPlotCard(row, options = {}) {
  const card = agentPlotCard(row);
  setInfoCard(card);
  showInfoCard({ scene: options.anchor?.closest?.('.pg6-scene'), event: options.event, anchor: options.anchor });
}

export function agentPlotCard(row) {
  const status = row?.status || (row?.fallow ? 'fallow' : 'growing');
  const recentTokens = Number(row?.recentTokens || 0);
  const lifetimeTokens = Number(row?.lifetimeTokens || 0);
  const eventCount = Number(row?.eventCount || 0);
  const share = Number(row?.share || 0);
  const primaryTokens = row?.fallow ? lifetimeTokens : (recentTokens || lifetimeTokens);
  const detailRows = [
    infoMetaRow(t('card.agent.recentShare'), percent(share)),
    lifetimeTokens > 0
      ? infoMetaRow(t('card.agent.lifetime'), fmtLocal(lifetimeTokens))
      : infoMetaRow(t('card.agent.events'), fmtLocal(eventCount)),
    infoMetaRow(t('card.agent.status'), agentPlotStatusLabel(status))
  ];
  return {
    label: t('card.agent.label'),
    name: row?.label || row?.id || '',
    total: row?.fallow
      ? t('card.agent.fallowTotal', { total: fmtLocal(lifetimeTokens) })
      : t('card.agent.recentTokens', { tokens: fmtLocal(primaryTokens) }),
    stage: agentPlotStatusLabel(status),
    fillPercent: Math.max(8, Math.min(100, share * 100)),
    detailHtml: detailRows.join(''),
    sparkHtml: ''
  };
}

export function agentPlotStatus({ share, lifetimeTokens, recentTokens, recentTotal }) {
  if (Number(lifetimeTokens || 0) > 0 && Number(recentTotal || 0) > 0 && Number(recentTokens || 0) === 0) {
    return 'fallow';
  }
  return Number(share || 0) >= 0.45 ? 'lush' : 'growing';
}

function agentPlotStatusLabel(status) {
  if (status === 'fallow') return t('card.agent.statusFallow');
  if (status === 'lush') return t('card.agent.statusLush');
  return t('card.agent.statusGrowing');
}

function tokenUsageMap(value) {
  const out = {};
  for (const [key, usage] of Object.entries(value || {})) {
    out[key] = Number(usage?.total_tokens || usage || 0);
  }
  return out;
}

function tokenMap(value) {
  const out = {};
  for (const [key, tokens] of Object.entries(value || {})) {
    out[key] = Number(tokens || 0);
  }
  return out;
}

function sumValues(value) {
  return Object.values(value || {}).reduce((sum, item) => sum + Number(item || 0), 0);
}

function percent(value) {
  return (Math.round((Number(value || 0) * 1000)) / 10).toFixed(1) + '%';
}

function currentSearch() {
  return typeof window !== 'undefined' && window.location ? window.location.search : '';
}
