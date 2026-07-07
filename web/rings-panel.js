// Rings content — the data drawer's "Rings" tab (PRD §P1-3 / §5.4).
// Read-only view of core-owned rings.json: the garden's durable memory,
// presented as a calm natural-history journal — an age line, month-grouped
// moments, and never a raw internal token. The book is cached: update()
// re-renders from memory and the backend is re-read only when the tab is
// activated (drawer open / tab switch), never on watcher ticks.

import { closeButton, escapeHtml, fmtLocal, kpiCard } from './render-helpers.js';
import { currentLocale, t } from './i18n.js';

// Tier transitions reuse the unlock-banner copy so the journal and the
// in-scene celebration can never tell the same story in different words.
const TIER_TITLE_KEYS = {
  'pavilion:mid': 'banner.pavilion.mid',
  'pavilion:full': 'banner.pavilion.full',
  'willow:mature': 'banner.willow.mature',
  'stone_cat:small': 'banner.stone_cat.small',
  'stone_cat:full': 'banner.stone_cat.full',
  'stool:visible': 'banner.stool',
  'cushion:visible': 'banner.cushion',
};

export function mountRingsContent({ host, loadRings, onRequestClose }) {
  let book = null;
  let loading = false;
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

  async function refresh() {
    const id = ++requestId;
    // Only a bookless panel shows the loading placeholder — a refresh with a
    // book on screen keeps showing it until fresh data lands (no skeleton
    // flicker, §5.5).
    if (!book) {
      loading = true;
      render();
    }
    try {
      const next = typeof loadRings === 'function' ? await loadRings() : null;
      if (id !== requestId) return;
      if (next) {
        book = next;
        error = null;
      } else if (!book) {
        error = t('rings.unavailable');
      }
    } catch (err) {
      if (id !== requestId) return;
      if (!book) error = err?.message || String(err || t('rings.unavailable'));
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
    // Watcher ticks only re-render the cached book; the disk is re-read when
    // the user actually looks at the tab (drawer contract: activate()).
    update: () => render(),
    activate: () => refresh(),
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
    <div class="pg6-ring-age" data-slot="rings-age"></div>
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
  const age = host.querySelector('[data-slot="rings-age"]');
  const kpis = host.querySelector('[data-slot="rings-kpis"]');
  const events = host.querySelector('[data-slot="rings-events"]');
  if (state.loading) {
    if (age) age.textContent = '';
    if (kpis) kpis.innerHTML = kpiCard(t('rings.loading'), '…', '');
    if (events) events.innerHTML = '';
    return;
  }
  if (state.error || !book) {
    if (age) age.textContent = '';
    if (kpis) kpis.innerHTML = kpiCard(t('rings.memory'), '—', state.error || t('rings.unavailable'));
    if (events) events.innerHTML = '<div class="pg6-data-empty">' + escapeHtml(t('rings.unavailableHint')) + '</div>';
    return;
  }
  const snapshot = book.snapshot || {};
  const tiers = snapshot.tiers || {};
  const projectCount = Object.keys(snapshot.projects || {}).length;
  const list = Array.isArray(book.events) ? book.events : [];
  if (age) age.textContent = ageLine(list);
  if (kpis) {
    kpis.innerHTML = `
      ${kpiCard(t('rings.events'), String(list.length), t('rings.eventsSub'))}
      ${kpiCard(t('rings.projects'), String(projectCount), t('rings.projectsSub'))}
      ${kpiCard(t('rings.highWater'), fmtLocal(tiers.total_tokens || 0), t('rings.highWaterSub'))}
      ${kpiCard(t('rings.trinkets'), String((tiers.pavilion_trinkets || []).length), t('rings.trinketsSub'))}
    `;
  }
  if (events) {
    events.innerHTML = eventList(list);
  }
}

// "这座庭院 213 天了 · 41 个时刻" — the §P1-3 anti-streak header: age only
// accumulates, counted from the earliest recorded moment.
function ageLine(events) {
  if (!events.length) return '';
  const dates = events.map((event) => event.utc_date).filter(Boolean).sort();
  if (!dates.length) return '';
  const first = Date.parse(dates[0] + 'T00:00:00Z');
  if (!Number.isFinite(first)) return '';
  const days = Math.max(1, Math.floor((Date.now() - first) / 86_400_000) + 1);
  return t('rings.age', { days, count: events.length });
}

function eventList(events) {
  if (!events.length) {
    return '<div class="pg6-data-empty">' + escapeHtml(t('rings.empty')) + '</div>';
  }
  // Newest first, grouped by month (§5.4: 按月分组). The 30-row cap keeps the
  // hidden-tab render cheap; older history stays on disk, not in the DOM.
  const rows = events.slice().reverse().slice(0, 30);
  let lastMonth = '';
  const parts = [];
  for (const event of rows) {
    const month = String(event.utc_date || '').slice(0, 7);
    if (month && month !== lastMonth) {
      lastMonth = month;
      parts.push(`<div class="pg6-ring-month">${escapeHtml(monthLabel(month))}</div>`);
    }
    parts.push(eventRow(event));
  }
  return `<div class="pg6-ring-list">${parts.join('')}</div>`;
}

function eventRow(event) {
  const title = ringEventTitle(event);
  const detail = eventDetail(event);
  return `
    <div class="pg6-ring-row">
      <div class="pg6-ring-date">${escapeHtml(ringDate(event.utc_date))}</div>
      <div class="pg6-ring-main">
        <strong>${escapeHtml(title)}</strong>
        ${detail ? `<small>${escapeHtml(detail)}</small>` : ''}
      </div>
    </div>`;
}

// Dates follow the app locale (pinned, not the browser's): the day key is a
// UTC calendar day, so it must be formatted in UTC or midnight-adjacent
// moments would shift a day in negative offsets.
export function ringDate(utcDate) {
  if (!utcDate) return '—';
  const parsed = Date.parse(utcDate + 'T00:00:00Z');
  if (!Number.isFinite(parsed)) return utcDate;
  return new Date(parsed).toLocaleDateString(appLocaleTag(), {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
  });
}

function monthLabel(yyyyMm) {
  const parsed = Date.parse(yyyyMm + '-01T00:00:00Z');
  if (!Number.isFinite(parsed)) return yyyyMm;
  return new Date(parsed).toLocaleDateString(appLocaleTag(), {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
  });
}

function appLocaleTag() {
  return currentLocale() === 'zh' ? 'zh-CN' : 'en';
}

export function ringEventTitle(event) {
  const type = event.type || '';
  if (type === 'first_seen_project') {
    return t('rings.event.firstSeen', { name: event.label || event.entity || '—' });
  }
  if (type === 'tier_up') {
    // Reuse the banner celebration copy; unknown transitions (a newer core)
    // fall back to the generic localized line rather than raw tokens.
    const key = TIER_TITLE_KEYS[`${event.entity}:${event.to}`];
    if (key) return t(key);
    return t('rings.event.tierUp', { entity: event.entity || '—', to: event.to || '—' });
  }
  if (type === 'trinket_unlocked') {
    return t('rings.event.trinket', { name: trinketName(event.entity || event.label || '—') });
  }
  // PRD-defined types core does not derive yet — titled now so the day core
  // adds them, the journal never shows a raw enum string.
  if (type === 'busiest_day_record') {
    return t('rings.event.busiestDay');
  }
  if (type === 'season_change') {
    return t('rings.event.seasonChange');
  }
  return type || event.id || '—';
}

// Subtitles carry real information only: the project path for first-seen
// rows. State tokens ("seen", "unlocked", "small → full") are implementation
// vocabulary — the localized title already tells the story.
function eventDetail(event) {
  const path = event.payload?.project_path;
  if (event.type === 'first_seen_project' && typeof path === 'string') return path;
  return '';
}

function trinketName(id) {
  const key = 'trinket.' + id + '.name';
  const value = t(key);
  return value === key ? id : value;
}
