// Composition content — the data drawer's "Composition" tab.
// Shows where local agent usage came from: model token share and source event
// share. Pure summary rendering; no backend calls.

import { modelTotalTokens } from './cost-estimate.js';
import { escapeHtml, fmtLocal } from './render-helpers.js';
import { t } from './i18n.js';

export function mountCompositionContent({ host, initialSummary, onRequestClose }) {
  let currentSummary = initialSummary || null;
  host.innerHTML = contentHtml();
  host.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('.pg6-insight-close') && typeof onRequestClose === 'function') {
      onRequestClose();
    }
  });
  render();

  function render() {
    const modelSlot = host.querySelector('[data-slot="models"]');
    const sourceSlot = host.querySelector('[data-slot="sources"]');
    if (modelSlot) {
      modelSlot.innerHTML = shareList(modelRows(currentSummary), {
        empty: t('composition.modelsEmpty'),
        valueLabel: (row) => fmtLocal(row.value),
      });
    }
    if (sourceSlot) {
      sourceSlot.innerHTML = shareList(sourceRows(currentSummary), {
        empty: t('composition.sourcesEmpty'),
        valueLabel: (row) => String(row.value),
      });
    }
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
        <div class="pg6-insight-label">${escapeHtml(t('composition.label'))}</div>
        <div class="pg6-insight-title">${escapeHtml(t('composition.title'))}</div>
      </div>
      ${closeButton(t('composition.closeAria'))}
    </div>
    <div class="pg6-dashboard-section">
      <div class="pg6-dashboard-section-head">
        <h3 class="pg6-dashboard-h3">${escapeHtml(t('composition.modelsTitle'))}</h3>
        <span class="pg6-dashboard-h3-hint">${escapeHtml(t('composition.modelsHint'))}</span>
      </div>
      <div data-slot="models"></div>
    </div>
    <div class="pg6-dashboard-section">
      <div class="pg6-dashboard-section-head">
        <h3 class="pg6-dashboard-h3">${escapeHtml(t('composition.sourcesTitle'))}</h3>
        <span class="pg6-dashboard-h3-hint">${escapeHtml(t('composition.sourcesHint'))}</span>
      </div>
      <div data-slot="sources"></div>
    </div>`;
}

function modelRows(summary) {
  const rows = Object.entries(summary?.models || {})
    .map(([name, usage]) => ({ name, value: modelTotalTokens(usage) }))
    .filter((row) => row.value > 0);
  return rowsWithShare(rows);
}

function sourceRows(summary) {
  const rows = Object.entries(summary?.sources || {})
    .map(([name, value]) => ({ name, value: Number(value || 0) }))
    .filter((row) => row.value > 0);
  return rowsWithShare(rows);
}

function rowsWithShare(rows) {
  rows.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  return rows.map((row) => ({
    ...row,
    share: total > 0 ? row.value / total : 0,
  }));
}

export function shareList(rows, { empty, valueLabel }) {
  if (!rows.length) {
    return '<div class="pg6-data-empty">' + escapeHtml(empty) + '</div>';
  }
  return `
    <div class="pg6-share-list">
      ${rows.slice(0, 12).map((row) => shareRow(row, valueLabel(row))).join('')}
    </div>`;
}

function shareRow(row, value) {
  const percent = Math.round(row.share * 1000) / 10;
  const width = Math.max(2, Math.min(100, row.share * 100));
  return `
    <div class="pg6-share-row">
      <div class="pg6-share-line">
        <span class="pg6-share-name" title="${escapeHtml(row.name)}">${escapeHtml(row.name)}</span>
        <span class="pg6-share-value">${escapeHtml(value)} · ${percent.toFixed(1)}%</span>
      </div>
      <div class="pg6-share-track" aria-hidden="true"><span style="width:${width.toFixed(2)}%"></span></div>
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
