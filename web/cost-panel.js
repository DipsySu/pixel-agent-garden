// Cost content — the data drawer's "Cost" tab.
// Displays the whole-garden cost estimate computed by core (the `cost_estimate`
// command → SummaryCost). This module does NO cost math and never sees the
// price table: it renders SummaryCost.total (total_usd, per-model breakdown
// with the rate each row was priced at, and the unpriced-token count). All
// figures are local estimates, never billing truth.

import { formatUsd } from './cost-estimate.js';
import { closeButton, escapeHtml, fmtLocal, kpiCard } from './render-helpers.js';
import { t } from './i18n.js';

export function mountCostContent({ host, loadCostEstimate, onRequestClose }) {
  // The backend computes cost from the latest cache, so it does not depend on
  // the visible summary — fetch it once and cache it (a watcher tick does not
  // re-fetch). `cost` is a SummaryCost; only `.total` is rendered here.
  let cost = null;
  let loading = true;
  let error = null;
  let requestId = 0;

  host.innerHTML = contentHtml();
  host.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('.pg6-insight-close') && typeof onRequestClose === 'function') {
      onRequestClose();
    }
  });
  refreshCost();

  async function refreshCost() {
    const id = ++requestId;
    loading = true;
    error = null;
    render();
    try {
      cost = typeof loadCostEstimate === 'function' ? await loadCostEstimate() : null;
      if (id !== requestId) return;
      if (!cost) error = t('cost.unavailable');
    } catch (err) {
      if (id !== requestId) return;
      error = err?.message || String(err || t('cost.unavailable'));
    } finally {
      if (id === requestId) {
        loading = false;
        render();
      }
    }
  }

  function render() {
    renderSummary(host, cost, { loading, error });
  }

  return {
    // Cost is computed backend-side over all data, so a summary tick doesn't
    // change it — kept as a no-op for the drawer's provider contract.
    update: () => {},
    // A transient cost_estimate failure at mount must not brick the tab for the
    // session (review finding): retry when the user actually opens the tab.
    activate: () => {
      if (!cost && !loading) refreshCost();
    },
  };
}

function contentHtml() {
  return `
    <div class="pg6-insight-head">
      <div>
        <div class="pg6-insight-label">${escapeHtml(t('cost.label'))}</div>
        <div class="pg6-insight-title">${escapeHtml(t('cost.title'))}</div>
      </div>
      ${closeButton(t('cost.closeAria'))}
    </div>
    <div class="pg6-dashboard-kpis" data-slot="cost-kpis"></div>
    <div class="pg6-dashboard-section">
      <div class="pg6-dashboard-section-head">
        <h3 class="pg6-dashboard-h3">${escapeHtml(t('cost.modelsTitle'))}</h3>
        <span class="pg6-dashboard-h3-hint">${escapeHtml(t('cost.modelsHint'))}</span>
      </div>
      <div data-slot="cost-models"></div>
    </div>
    <div class="pg6-data-note">${escapeHtml(t('cost.note'))}</div>`;
}

function renderSummary(host, cost, state) {
  const kpis = host.querySelector('[data-slot="cost-kpis"]');
  const models = host.querySelector('[data-slot="cost-models"]');
  if (state.loading) {
    if (kpis) kpis.innerHTML = kpiCard(t('cost.loading'), '…', '');
    if (models) models.innerHTML = '';
    return;
  }
  if (state.error || !cost) {
    if (kpis) kpis.innerHTML = kpiCard(t('cost.estimate'), '—', state.error || t('cost.unavailable'));
    if (models) models.innerHTML = '<div class="pg6-data-empty">' + escapeHtml(t('cost.unavailableHint')) + '</div>';
    return;
  }

  const total = cost.total || { total_usd: 0, by_model: {}, unpriced_tokens: 0 };
  const byModel = total.by_model || {};
  const pricedCount = Object.keys(byModel).length;
  // Cache tokens are counted-not-priced; sum them across the priced models the
  // estimate actually kept (unpriced models are surfaced as the KPI count).
  const cacheTokens = Object.values(byModel).reduce((sum, m) => sum + (Number(m.cache_tokens) || 0), 0);
  if (kpis) {
    kpis.innerHTML = `
      ${kpiCard(t('cost.estimate'), formatUsd(total.total_usd), t('cost.estimateSub'))}
      ${kpiCard(t('cost.pricedModels'), String(pricedCount), t('cost.pricedModelsSub'))}
      ${kpiCard(t('cost.unpricedTokens'), fmtLocal(total.unpriced_tokens || 0), t('cost.unpricedSub'))}
      ${kpiCard(t('cost.cacheTokens'), fmtLocal(cacheTokens), t('cost.cacheSub'))}
    `;
  }
  if (models) {
    models.innerHTML = modelRows(byModel);
  }
}

function modelRows(byModel) {
  const rows = Object.entries(byModel || {})
    .map(([model, mc]) => ({
      model,
      // total = input + output + blended + cache reconstructs the row's tokens
      // (blended = total − input − output − cache, so the four sum back).
      total: uintish(mc.input_tokens) + uintish(mc.output_tokens) + uintish(mc.blended_tokens) + uintish(mc.cache_tokens),
      cost: mc,
    }))
    .filter((row) => row.total > 0)
    .sort((a, b) => (b.cost.usd || 0) - (a.cost.usd || 0) || b.total - a.total);

  if (!rows.length) {
    return '<div class="pg6-data-empty">' + escapeHtml(t('cost.noModels')) + '</div>';
  }

  return `
    <div class="pg6-cost-list">
      ${rows.slice(0, 14).map(costRow).join('')}
    </div>`;
}

function costRow(row) {
  const c = row.cost;
  const usd = formatUsd(c.usd);
  const split = t('cost.rowSplit', {
    input: fmtLocal(c.input_tokens),
    output: fmtLocal(c.output_tokens),
    blended: fmtLocal(c.blended_tokens),
  });
  // Rate echoed by core alongside the usd it produced — no second price lookup,
  // so the shown rate can never disagree with the computed cost.
  const rate = t('cost.rowRate', {
    input: c.input_per_mtok,
    output: c.output_per_mtok,
  });
  return `
    <div class="pg6-cost-row">
      <div class="pg6-cost-main">
        <strong title="${escapeHtml(row.model)}">${escapeHtml(row.model)}</strong>
        <small>${escapeHtml(split)} · ${escapeHtml(rate)}</small>
      </div>
      <div class="pg6-cost-amount">
        <b>${escapeHtml(usd)}</b>
        <small>${escapeHtml(t('cost.rowTokens', { total: fmtLocal(row.total) }))}</small>
      </div>
    </div>`;
}

function uintish(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
