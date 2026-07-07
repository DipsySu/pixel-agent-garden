// Cost content — the data drawer's "Cost" tab.
// Consumes the local price table via data-source.js and estimates from
// GardenSummary.models. All figures are local estimates, never billing truth.

import { estimateCost, formatUsd, normalizeUsage } from './cost-estimate.js';
import { escapeHtml, fmtLocal } from './render-helpers.js';
import { t } from './i18n.js';

export function mountCostContent({ host, initialSummary, loadPrices, onRequestClose }) {
  let currentSummary = initialSummary || null;
  let priceTable = null;
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
  refreshPrices();
  render();

  async function refreshPrices() {
    const id = ++requestId;
    loading = true;
    error = null;
    render();
    try {
      priceTable = typeof loadPrices === 'function' ? await loadPrices() : null;
      if (id !== requestId) return;
      if (!priceTable) error = t('cost.unavailable');
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
    renderSummary(host, currentSummary, priceTable, { loading, error });
  }

  return {
    update: (summary) => {
      currentSummary = summary || null;
      render();
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

function renderSummary(host, summary, priceTable, state) {
  const kpis = host.querySelector('[data-slot="cost-kpis"]');
  const models = host.querySelector('[data-slot="cost-models"]');
  if (state.loading) {
    if (kpis) kpis.innerHTML = kpiCard(t('cost.loading'), '…', '');
    if (models) models.innerHTML = '';
    return;
  }
  if (state.error || !priceTable) {
    if (kpis) kpis.innerHTML = kpiCard(t('cost.estimate'), '—', state.error || t('cost.unavailable'));
    if (models) models.innerHTML = '<div class="pg6-data-empty">' + escapeHtml(t('cost.unavailableHint')) + '</div>';
    return;
  }

  const estimate = estimateCost(summary?.models || {}, priceTable);
  const pricedCount = Object.keys(estimate.by_model).length;
  const cacheTokens = sumCacheTokens(summary?.models || {});
  if (kpis) {
    kpis.innerHTML = `
      ${kpiCard(t('cost.estimate'), formatUsd(estimate.total_usd), t('cost.estimateSub'))}
      ${kpiCard(t('cost.pricedModels'), String(pricedCount), t('cost.pricedModelsSub'))}
      ${kpiCard(t('cost.unpricedTokens'), fmtLocal(estimate.unpriced_tokens), t('cost.unpricedSub'))}
      ${kpiCard(t('cost.cacheTokens'), fmtLocal(cacheTokens), t('cost.cacheSub'))}
    `;
  }
  if (models) {
    models.innerHTML = modelRows(summary?.models || {}, estimate, priceTable);
  }
}

function modelRows(tokensByModel, estimate, priceTable) {
  const rows = Object.entries(tokensByModel || {})
    .map(([model, usage]) => {
      const normalized = normalizeUsage(usage);
      const priced = estimate.by_model[model] || null;
      const price = priceTable.prices?.[model] || null;
      return {
        model,
        total: normalized.total_tokens,
        cache: normalized.cache_read_tokens + normalized.cache_write_tokens,
        priced,
        price,
      };
    })
    .filter((row) => row.total > 0)
    .sort((a, b) => (b.priced?.usd || 0) - (a.priced?.usd || 0) || b.total - a.total);

  if (!rows.length) {
    return '<div class="pg6-data-empty">' + escapeHtml(t('cost.noModels')) + '</div>';
  }

  return `
    <div class="pg6-cost-list">
      ${rows.slice(0, 14).map(costRow).join('')}
    </div>`;
}

function costRow(row) {
  const isPriced = !!row.priced;
  const usd = isPriced ? formatUsd(row.priced.usd) : t('cost.unpriced');
  const split = isPriced
    ? t('cost.rowSplit', {
        input: fmtLocal(row.priced.input_tokens),
        output: fmtLocal(row.priced.output_tokens),
        blended: fmtLocal(row.priced.blended_tokens),
      })
    : t('cost.rowUnknown');
  const rate = row.price
    ? t('cost.rowRate', {
        input: row.price.input_per_mtok,
        output: row.price.output_per_mtok,
      })
    : '';
  return `
    <div class="pg6-cost-row">
      <div class="pg6-cost-main">
        <strong title="${escapeHtml(row.model)}">${escapeHtml(row.model)}</strong>
        <small>${escapeHtml(split)}${rate ? ' · ' + escapeHtml(rate) : ''}</small>
      </div>
      <div class="pg6-cost-amount">
        <b>${escapeHtml(usd)}</b>
        <small>${escapeHtml(t('cost.rowTokens', { total: fmtLocal(row.total) }))}</small>
      </div>
    </div>`;
}

function sumCacheTokens(tokensByModel) {
  return Object.values(tokensByModel || {}).reduce((sum, usage) => {
    const u = normalizeUsage(usage);
    return sum + u.cache_read_tokens + u.cache_write_tokens;
  }, 0);
}

function kpiCard(label, value, sub) {
  return `
    <div class="pg6-dashboard-kpi">
      <div class="pg6-dashboard-kpi-label">${escapeHtml(label)}</div>
      <div class="pg6-dashboard-kpi-value">${escapeHtml(value)}</div>
      ${sub ? `<div class="pg6-dashboard-kpi-sub">${escapeHtml(sub)}</div>` : ''}
    </div>`;
}

function closeButton(label) {
  return `
    <button class="pg6-insight-close" type="button" aria-label="${escapeHtml(label)}">
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <path d="M6 6 18 18 M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
    </button>`;
}
