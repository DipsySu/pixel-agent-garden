// Export content — the data drawer's "Export" tab (PRD 2.0 §P4-3).
// The formatters live in data-export.js; this provider owns only the UI state
// and the user-initiated save action.

import { buildDailyTokensCsv, buildDailyTokensJson, suggestedExportName } from './data-export.js';
import { closeButton, escapeHtml, fmtLocal } from './render-helpers.js';
import { t } from './i18n.js';

export function mountExportContent({ host, initialSummary, onRequestClose, saveExportText, onError }) {
  let currentSummary = initialSummary || null;
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
    await exportKind(kind, button);
  });

  renderMeta();

  return {
    update: (summary) => {
      currentSummary = summary || null;
      renderMeta();
    }
  };

  async function exportKind(kind, button) {
    const text = kind === 'json'
      ? buildDailyTokensJson(currentSummary)
      : buildDailyTokensCsv(currentSummary);
    const filename = suggestedExportName(kind);
    button.disabled = true;
    setStatus(t('export.saving'));
    try {
      const saved = typeof saveExportText === 'function'
        ? await saveExportText(text, filename, kind === 'json' ? 'application/json' : 'text/csv')
        : false;
      setStatus(saved ? t('export.saved') : t('export.cancelled'));
    } catch (err) {
      setStatus(t('export.error'));
      if (typeof onError === 'function') onError('data export failed', err);
    } finally {
      button.disabled = false;
    }
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
        <button class="pg6-postcard-export" type="button" data-export-kind="csv">${escapeHtml(t('export.csv'))}</button>
        <button class="pg6-postcard-export" type="button" data-export-kind="json">${escapeHtml(t('export.json'))}</button>
      </div>
      <span class="pg6-postcard-status" data-slot="export-status" aria-live="polite"></span>
    </div>`;
}

function projectDayRowCount(summary) {
  return (summary?.projects || []).reduce((count, project) => {
    return count + Object.values(project?.daily_tokens || {}).filter((v) => Number(v || 0) > 0).length;
  }, 0);
}
