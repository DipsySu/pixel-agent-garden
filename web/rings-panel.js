// Rings content — the data drawer's "Rings" tab.
// Read-only view of core-owned rings.json: the garden's durable memory.

import { escapeHtml, fmtLocal } from './render-helpers.js';
import { t } from './i18n.js';

export function mountRingsContent({ host, loadRings, onRequestClose }) {
  let book = null;
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
  refresh();
  render();

  async function refresh() {
    const id = ++requestId;
    loading = true;
    error = null;
    render();
    try {
      book = typeof loadRings === 'function' ? await loadRings() : null;
      if (id !== requestId) return;
      if (!book) error = t('rings.unavailable');
    } catch (err) {
      if (id !== requestId) return;
      error = err?.message || String(err || t('rings.unavailable'));
    } finally {
      if (id === requestId) {
        loading = false;
        render();
      }
    }
  }

  function render() {
    renderBook(host, book, { loading, error });
  }

  return {
    update: () => refresh(),
  };
}

function contentHtml() {
  return `
    <div class="pg6-insight-head">
      <div>
        <div class="pg6-insight-label">${escapeHtml(t('rings.label'))}</div>
        <div class="pg6-insight-title">${escapeHtml(t('rings.title'))}</div>
      </div>
      ${closeButton(t('rings.closeAria'))}
    </div>
    <div class="pg6-dashboard-kpis" data-slot="rings-kpis"></div>
    <div class="pg6-dashboard-section">
      <div class="pg6-dashboard-section-head">
        <h3 class="pg6-dashboard-h3">${escapeHtml(t('rings.eventsTitle'))}</h3>
        <span class="pg6-dashboard-h3-hint">${escapeHtml(t('rings.eventsHint'))}</span>
      </div>
      <div data-slot="rings-events"></div>
    </div>`;
}

function renderBook(host, book, state) {
  const kpis = host.querySelector('[data-slot="rings-kpis"]');
  const events = host.querySelector('[data-slot="rings-events"]');
  if (state.loading) {
    if (kpis) kpis.innerHTML = kpiCard(t('rings.loading'), '…', '');
    if (events) events.innerHTML = '';
    return;
  }
  if (state.error || !book) {
    if (kpis) kpis.innerHTML = kpiCard(t('rings.memory'), '—', state.error || t('rings.unavailable'));
    if (events) events.innerHTML = '<div class="pg6-data-empty">' + escapeHtml(t('rings.unavailableHint')) + '</div>';
    return;
  }
  const snapshot = book.snapshot || {};
  const tiers = snapshot.tiers || {};
  const projectCount = Object.keys(snapshot.projects || {}).length;
  const eventCount = Array.isArray(book.events) ? book.events.length : 0;
  if (kpis) {
    kpis.innerHTML = `
      ${kpiCard(t('rings.events'), String(eventCount), t('rings.eventsSub'))}
      ${kpiCard(t('rings.projects'), String(projectCount), t('rings.projectsSub'))}
      ${kpiCard(t('rings.highWater'), fmtLocal(tiers.total_tokens || 0), t('rings.highWaterSub'))}
      ${kpiCard(t('rings.trinkets'), String((tiers.pavilion_trinkets || []).length), t('rings.trinketsSub'))}
    `;
  }
  if (events) {
    events.innerHTML = eventList(Array.isArray(book.events) ? book.events : []);
  }
}

function eventList(events) {
  if (!events.length) {
    return '<div class="pg6-data-empty">' + escapeHtml(t('rings.empty')) + '</div>';
  }
  return `
    <div class="pg6-ring-list">
      ${events.slice().reverse().slice(0, 30).map(eventRow).join('')}
    </div>`;
}

function eventRow(event) {
  const date = event.utc_date || '—';
  const title = ringEventTitle(event);
  const detail = eventDetail(event);
  return `
    <div class="pg6-ring-row">
      <div class="pg6-ring-date">${escapeHtml(date)}</div>
      <div class="pg6-ring-main">
        <strong>${escapeHtml(title)}</strong>
        ${detail ? `<small>${escapeHtml(detail)}</small>` : ''}
      </div>
    </div>`;
}

export function ringEventTitle(event) {
  const type = eventType(event);
  if (type === 'first_seen_project') {
    return t('rings.event.firstSeen', { name: event.label || event.entity || '—' });
  }
  if (type === 'tier_up') {
    return t('rings.event.tierUp', { entity: event.entity || '—', to: event.to || '—' });
  }
  if (type === 'trinket_unlocked') {
    return t('rings.event.trinket', { name: trinketName(event.entity || event.label || '—') });
  }
  return type || event.id || '—';
}

function eventType(event) {
  // Rust serializes RingEvent.event_type as JSON `type`; keep the older
  // event_type spelling as a defensive fallback for hand-written fixtures.
  return event.type || event.event_type || '';
}

function eventDetail(event) {
  if (event.from || event.to) {
    return [event.from, event.to].filter(Boolean).join(' → ');
  }
  const path = event.payload?.project_path;
  return typeof path === 'string' ? path : '';
}

function trinketName(id) {
  const key = 'trinket.' + id + '.name';
  const value = t(key);
  return value === key ? id : value;
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
