// Export content — the data drawer's "Export" tab (PRD 2.0 §P4-3).
// The formatters live in data-export.js; this provider owns only the UI state
// and the user-initiated save action.

import {
  buildCostEstimateCsv,
  buildCostEstimateJson,
  buildDailyTokensCsv,
  buildDailyTokensJson,
  suggestedExportName
} from './data-export.js';
import { closeButton, escapeHtml, fmtLocal } from './render-helpers.js';
import { t } from './i18n.js';

export function mountExportContent({
  host,
  initialSummary,
  onRequestClose,
  saveExportText,
  loadCostEstimate,
  onError
}) {
  let currentSummary = initialSummary || null;
  let cost = null;
  let costRequested = false;
  host.innerHTML = contentHtml();
  const status = host.querySelector('[data-slot="export-status"]');

  host.addEventListener('click', async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('.pg6-insight-close') && typeof onRequestClose === 'function') {
      onRequestClose();
      return;
    }
    const button = target?.closest('[data-export-kind]');
    if (!button) return;
    const kind = button.dataset.exportKind === 'json' ? 'json' : 'csv';
    const dataset = button.dataset.exportDataset === 'cost' ? 'cost' : 'daily';
    await exportKind(dataset, kind, button);
  });

  renderMeta();

  return {
    update: (summary) => {
      currentSummary = summary || null;
      cost = null;
      costRequested = false;
      renderMeta();
    }
  };

  async function exportKind(dataset, kind, button) {
    button.disabled = true;
    setStatus(t('export.saving'));
    try {
      const payload = dataset === 'cost'
        ? await costPayload(kind)
        : dailyPayload(kind);
      if (!payload) {
        setStatus(t('export.costUnavailable'));
        return;
      }
      const saved = typeof saveExportText === 'function'
        ? await saveExportText(payload.text, payload.filename, payload.mimeType)
        : false;
      setStatus(saved ? t('export.saved') : t('export.cancelled'));
    } catch (err) {
      setStatus(t('export.error'));
      if (typeof onError === 'function') onError('data export failed', err);
    } finally {
      button.disabled = false;
    }
  }

  function dailyPayload(kind) {
    return {
      text: kind === 'json' ? buildDailyTokensJson(currentSummary) : buildDailyTokensCsv(currentSummary),
      filename: suggestedExportName(kind),
      mimeType: kind === 'json' ? 'application/json' : 'text/csv'
    };
  }

  async function costPayload(kind) {
    const estimate = await loadCost();
    if (!estimate) return null;
    return {
      text: kind === 'json'
        ? buildCostEstimateJson(estimate, currentSummary)
        : buildCostEstimateCsv(estimate, currentSummary),
      filename: suggestedExportName(kind, new Date(), 'cost-estimate'),
      mimeType: kind === 'json' ? 'application/json' : 'text/csv'
    };
  }

  async function loadCost() {
    if (costRequested) return cost;
    cost = typeof loadCostEstimate === 'function' ? await loadCostEstimate() : null;
    costRequested = true;
    return cost;
  }

  function renderMeta() {
    const rows = projectDayRowCount(currentSummary);
    const meta = host.querySelector('[data-slot="export-meta"]');
    if (meta) {
      meta.textContent = t('export.meta', {
        projects: String(currentSummary?.projects?.length || 0),
        rows: fmtLocal(rows)
      });
    }
    const costMeta = host.querySelector('[data-slot="export-cost-meta"]');
    if (costMeta) costMeta.textContent = t('export.costMeta');
  }

  function setStatus(value) {
    if (status) status.textContent = value || '';
  }
}

function contentHtml() {
  return `
    <div class="pg6-insight-head">
      <div>
        <div class="pg6-insight-label">${escapeHtml(t('export.label'))}</div>
        <div class="pg6-insight-title">${escapeHtml(t('export.title'))}</div>
      </div>
      ${closeButton(t('export.closeAria'))}
    </div>
    <div class="pg6-data-note">${escapeHtml(t('export.note'))}</div>
    <div class="pg6-export-card">
      <strong>${escapeHtml(t('export.dailyTitle'))}</strong>
      <small data-slot="export-meta"></small>
      <div class="pg6-export-actions">
        <button class="pg6-postcard-export" type="button" data-export-dataset="daily" data-export-kind="csv">${escapeHtml(t('export.csv'))}</button>
        <button class="pg6-postcard-export" type="button" data-export-dataset="daily" data-export-kind="json">${escapeHtml(t('export.json'))}</button>
      </div>
    </div>
    <div class="pg6-export-card">
      <strong>${escapeHtml(t('export.costTitle'))}</strong>
      <small data-slot="export-cost-meta"></small>
      <div class="pg6-export-actions">
        <button class="pg6-postcard-export" type="button" data-export-dataset="cost" data-export-kind="csv">${escapeHtml(t('export.csv'))}</button>
        <button class="pg6-postcard-export" type="button" data-export-dataset="cost" data-export-kind="json">${escapeHtml(t('export.json'))}</button>
      </div>
    </div>
    <span class="pg6-postcard-status" data-slot="export-status" aria-live="polite"></span>`;
}

function projectDayRowCount(summary) {
  return (summary?.projects || []).reduce((count, project) => {
    return count + Object.values(project?.daily_tokens || {}).filter((v) => Number(v || 0) > 0).length;
  }, 0);
}
