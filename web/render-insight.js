// Token-insight rendering: turns a project's honest per-day token map
// (`daily_tokens`) into a compact sparkline. Pure data -> SVG-string module.
//
// Boundaries (spec §Modularity, §Surface): this file NEVER invokes Tauri,
// touches the DOM, or mutates the summary it is handed. It takes plain data
// and returns a markup string; the caller decides where to inject it. Number
// formatting for labels is delegated to an injected `format` fn so this module
// stays decoupled from render-helpers.
//
// Why a sparkline and not a calendar: token consumption is heavy-tailed, but a
// sparkline shows each project's OWN series over time, so no cross-project
// scale is implied — the long-tail trap never appears here.

import { t } from './i18n.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function dayKey(date) {
  // UTC date key matching the Rust side (`%Y-%m-%d`, UTC).
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Build a continuous series of the last `days` days ending at `now`
// (inclusive), filling absent days with 0. Returns [{ date, value }] oldest
// first. `dailyTokens` is the `daily_tokens` map ("YYYY-MM-DD" -> tokens);
// missing/empty is treated as all zeros.
export function dailySeries(dailyTokens, days = 14, now = new Date()) {
  const map = dailyTokens || {};
  const series = [];
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(todayUtc - i * DAY_MS);
    const key = dayKey(date);
    series.push({ date: key, value: Number(map[key] || 0) });
  }
  return series;
}

// Render a compact bar sparkline as an inline SVG string. Bars are normalized
// to the window's own max (relative-to-self), so a quiet project and a busy
// one both read clearly. All-zero windows render a flat baseline rather than
// an empty box. Color inherits via `currentColor` so it adapts to theme.
export function sparklineSVG(dailyTokens, opts = {}) {
  const days = opts.days || 14;
  const now = opts.now || new Date();
  const format = typeof opts.format === 'function' ? opts.format : (v) => String(v);
  const series = dailySeries(dailyTokens, days, now);

  const step = 4; // px per day in viewBox units
  const barW = 3;
  const h = 24;
  const pad = 1;
  const usableH = h - pad * 2;
  const width = days * step;
  const max = series.reduce((m, p) => (p.value > m ? p.value : m), 0);
  const total = series.reduce((sum, p) => sum + p.value, 0);

  let rects = '';
  series.forEach((point, i) => {
    const x = i * step;
    if (max <= 0) {
      // flat baseline tick — signals "tracked, no tokens" without an empty box
      rects += `<rect x="${x}" y="${h - pad - 1}" width="${barW}" height="1" rx="0.5" opacity="0.35"/>`;
      return;
    }
    const barH = point.value > 0 ? Math.max(1, Math.round((point.value / max) * usableH)) : 0;
    const y = h - pad - barH;
    const op = point.value > 0 ? 0.9 : 0.18;
    const minH = point.value > 0 ? barH : 1;
    const yy = point.value > 0 ? y : h - pad - 1;
    rects += `<rect x="${x}" y="${yy}" width="${barW}" height="${minH}" rx="0.5" opacity="${op}"/>`;
  });

  const label = t('insight.sparkLabel', { days, total: format(total) });
  const safeLabel = escapeAttr(label);
  return (
    `<svg class="pg6-spark-svg" viewBox="0 0 ${width} ${h}" preserveAspectRatio="none" ` +
    `role="img" aria-label="${safeLabel}"><title>${escapeHtml(label)}</title>${rects}</svg>`
  );
}

export function windowTotal(dailyTokens, days = 14, now = new Date()) {
  return dailySeries(dailyTokens, days, now).reduce((sum, point) => sum + point.value, 0);
}

export function topProjectsByTokens(summary, limit = 10) {
  const projects = Array.isArray(summary?.projects) ? summary.projects.slice() : [];
  projects.sort((a, b) => {
    const tokenDiff = Number(b.total_tokens || 0) - Number(a.total_tokens || 0);
    if (tokenDiff) return tokenDiff;
    return String(a.project_key || '').localeCompare(String(b.project_key || ''));
  });
  return projects.slice(0, Math.max(0, limit));
}

export function insightPanelHTML(summary, opts = {}) {
  const format = typeof opts.format === 'function' ? opts.format : (v) => String(v);
  const days = opts.days || 14;
  // `limit` is now the visible-by-default cap (the "top N"); ALL projects are
  // rendered into the DOM so search can reach beyond the cap. Rows past topN
  // get `is-extra` and are hidden by CSS until "show all" or a search query.
  const topN = opts.limit || 10;
  const now = opts.now || new Date();
  const projects = topProjectsByTokens(summary, Infinity);
  const total = Number(summary?.total_tokens || 0);
  const recent = windowTotal(summary?.daily_tokens, days, now);
  const extra = Math.max(0, projects.length - topN);

  // Same project basename can appear on several rows because aggregation keys
  // on full path, not display name (two real dirs named "demo-service" are
  // legitimately distinct). Count names so we can surface a disambiguating
  // path line only where it's actually needed.
  const nameCounts = new Map();
  projects.forEach((project) => {
    const name = project.display_name || 'unknown';
    nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
  });

  const rows = projects.length
    ? projects.map((project, index) => insightRowHTML(project, index, {
        format,
        days,
        now,
        isExtra: index >= topN,
        ambiguous: (nameCounts.get(project.display_name || 'unknown') || 0) > 1
      })).join('')
    : '<div class="pg6-insight-empty">' + escapeHtml(t('insight.empty')) + '</div>';

  // "Show all (N more)" / "Show top N" toggle — only when there's an overflow.
  const showAll = extra > 0
    ? '<button class="pg6-insight-showall" type="button" data-extra="' + extra + '" data-topn="' + topN + '">' +
        escapeHtml(t('insight.showAll', { count: extra })) +
      '</button>'
    : '';

  return (
    '<div class="pg6-insight-head">' +
      '<div><div class="pg6-insight-label">' + escapeHtml(t('insight.label')) + '</div>' +
      '<div class="pg6-insight-title">' + escapeHtml(t('insight.title')) + '</div></div>' +
      '<button class="pg6-insight-close" type="button" aria-label="' + escapeAttr(t('insight.closeAria')) + '">' + closeSvg() + '</button>' +
    '</div>' +
    '<div class="pg6-insight-summary">' +
      '<span><b>' + escapeHtml(format(total)) + '</b><small>' + escapeHtml(t('insight.total')) + '</small></span>' +
      '<span><b>' + escapeHtml(format(recent)) + '</b><small>' + escapeHtml(t('insight.recent', { days })) + '</small></span>' +
      '<span><b>' + escapeHtml(String(summary?.active_projects || projects.length || 0)) + '</b><small>' + escapeHtml(t('insight.projects')) + '</small></span>' +
    '</div>' +
    '<div class="pg6-insight-search">' +
      '<input type="search" class="pg6-insight-search-input" autocomplete="off" spellcheck="false" ' +
        'placeholder="' + escapeAttr(t('insight.searchPlaceholder')) + '" aria-label="' + escapeAttr(t('insight.searchPlaceholder')) + '">' +
    '</div>' +
    '<div class="pg6-insight-list pg6-popover-scroll" role="list">' + rows + '</div>' +
    '<div class="pg6-insight-noresults" hidden>' + escapeHtml(t('insight.noResults')) + '</div>' +
    showAll
  );
}

// Lowercased haystack for client-side filtering: name, path, key, source and
// model identifiers. Lets a search match by tool or model, not just name.
function searchableText(project) {
  const parts = [
    project.display_name || '',
    project.project_path || '',
    project.project_key || '',
    ...Object.keys(project.sources || {}),
    ...Object.keys(project.models || {})
  ];
  return parts.join(' ').toLowerCase();
}

function insightRowHTML(project, index, opts) {
  const recent = windowTotal(project.daily_tokens, opts.days, opts.now);
  const name = project.display_name || 'unknown';
  const path = project.project_path || '';
  // path_inferred means the path was reverse-decoded from a directory name
  // (lossy/ambiguous), so it may not be a real location. We must NOT offer to
  // open it in a terminal, and we flag the row as approximate.
  const inferred = !!project.path_inferred;
  // Open-terminal button only when we have a TRUSTWORTHY project root. Nested
  // <button>s are invalid, so the select-row button and the terminal button are
  // siblings inside a flex line; the panel controller routes clicks by closest().
  const term = (path && !inferred)
    ? '<button class="pg6-insight-term" type="button" data-project-path="' + escapeAttr(path) +
      '" title="' + escapeAttr(t('insight.openTerminalTitle')) + '" aria-label="' + escapeAttr(t('insight.openTerminalAria', { name })) + '">' + terminalSvg() + '</button>'
    : '';
  // "≈ 推测路径" badge marks an inferred (best-effort) path so the user knows
  // the name is a guess, not a verified directory.
  const approxBadge = inferred
    ? '<span class="pg6-insight-approx" title="' + escapeAttr(t('insight.approxTitle')) + '">' + escapeHtml(t('insight.approxBadge')) + '</span>'
    : '';
  // Full path as a hover tooltip on every row (cheap discoverability). For
  // inferred paths the tooltip is explicitly marked approximate.
  const rowTitle = path
    ? ' title="' + escapeAttr(inferred ? t('insight.inferredTooltip', { path }) : path) + '"'
    : '';
  // Show the path line when the basename is ambiguous (duplicate) OR the path
  // is inferred; prefix inferred ones with ≈ to keep the "guess" signal.
  const showPath = (opts.ambiguous || inferred) && path;
  const pathLine = showPath
    ? '<small class="pg6-insight-path" title="' + escapeAttr(path) + '">' + (inferred ? '≈ ' : '') + escapeHtml(path) + '</small>'
    : '';
  const extraClass = opts.isExtra ? ' is-extra' : '';
  return (
    '<div class="pg6-insight-row-line' + extraClass + '" role="listitem" data-search="' + escapeAttr(searchableText(project)) + '">' +
      '<button class="pg6-insight-row" type="button"' + rowTitle + ' data-project-key="' + escapeAttr(project.project_key || '') + '">' +
        '<span class="pg6-insight-rank">' + String(index + 1).padStart(2, '0') + '</span>' +
        '<span class="pg6-insight-main">' +
          '<strong>' + escapeHtml(name) + '</strong>' + approxBadge +
          '<small>' + escapeHtml(t('insight.rowRecent', { days: opts.days, total: opts.format(recent) })) + '</small>' +
          pathLine +
        '</span>' +
        '<span class="pg6-insight-spark" aria-hidden="true">' + sparklineSVG(project.daily_tokens, { days: opts.days, now: opts.now, format: opts.format }) + '</span>' +
        '<span class="pg6-insight-total">' + escapeHtml(opts.format(project.total_tokens || 0)) + '</span>' +
      '</button>' +
      term +
    '</div>'
  );
}

function terminalSvg() {
  return (
    '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
    '<path d="M4 5h16v14H4zM7 9l3 3-3 3M13 15h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>'
  );
}

function closeSvg() {
  return (
    '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
    '<path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
    '</svg>'
  );
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  })[c]);
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#096;');
}
