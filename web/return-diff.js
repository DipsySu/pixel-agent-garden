import { fmtLocal, escapeHtml } from './render-helpers.js';
import { t } from './i18n.js';

const SNAPSHOT_KEY = 'pg6.return.snapshot.v1';
const AUTO_DISMISS_MS = 12_000;

export function mountReturnDiff({ hostFrame, initialSummary }) {
  if (!hostFrame) return null;

  const previous = readSnapshot();
  const current = snapshotSummary(initialSummary);
  const diff = computeReturnDiff(previous, current);
  writeSnapshot(current);

  let card = null;
  let timer = null;
  if (diff) {
    card = buildReturnDiffCard(diff, dismiss);
    hostFrame.appendChild(card);
    timer = setTimeout(() => dismiss(), AUTO_DISMISS_MS);
  }

  function dismiss() {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!card) return;
    card.classList.add('is-closing');
    setTimeout(() => card?.remove(), 180);
    card = null;
  }

  return {
    dismiss,
    record: (summary) => writeSnapshot(snapshotSummary(summary))
  };
}

export function snapshotSummary(summary, savedAt = new Date()) {
  if (!summary || typeof summary !== 'object') return null;
  const projects = Array.isArray(summary.projects) ? summary.projects : [];
  const rows = projects
    .map((project) => ({
      key: String(project.project_key || ''),
      name: String(project.display_name || project.project_key || ''),
      tokens: Number(project.total_tokens || 0),
      sessions: Number(project.sessions || 0)
    }))
    .filter((project) => project.key)
    .sort((a, b) => a.key.localeCompare(b.key));

  return {
    schema: 1,
    saved_at: savedAt.toISOString(),
    last_seen: summary.last_seen || null,
    total_tokens: Number(summary.total_tokens || rows.reduce((sum, project) => sum + project.tokens, 0)),
    active_projects: Number(summary.active_projects || rows.length || 0),
    sessions: rows.reduce((sum, project) => sum + project.sessions, 0),
    projects: rows
  };
}

export function computeReturnDiff(previous, current) {
  if (!previous || !current || previous.schema !== 1 || current.schema !== 1) return null;
  const previousProjects = new Map((previous.projects || []).map((project) => [project.key, project]));

  let newProjects = 0;
  let changedProjects = 0;
  let topChanged = null;

  (current.projects || []).forEach((project) => {
    const before = previousProjects.get(project.key);
    if (!before) {
      newProjects += 1;
    }
    const tokenDelta = Math.max(0, project.tokens - (before?.tokens || 0));
    const sessionDelta = Math.max(0, project.sessions - (before?.sessions || 0));
    if (tokenDelta > 0 || sessionDelta > 0 || !before) {
      changedProjects += 1;
      if (!topChanged || tokenDelta > topChanged.tokenDelta) {
        topChanged = { name: project.name, tokenDelta };
      }
    }
  });

  const tokenDelta = Math.max(0, current.total_tokens - Number(previous.total_tokens || 0));
  const sessionDelta = Math.max(0, current.sessions - Number(previous.sessions || 0));
  if (!tokenDelta && !sessionDelta && !newProjects && !changedProjects) return null;

  return {
    tokenDelta,
    sessionDelta,
    newProjects,
    changedProjects,
    topProjectName: topChanged?.name || ''
  };
}

function buildReturnDiffCard(diff, onDismiss) {
  const card = document.createElement('section');
  card.className = 'pg6-return-diff';
  card.setAttribute('role', 'region');
  card.setAttribute('aria-label', t('return.title'));
  card.setAttribute('aria-live', 'polite');

  const items = [];
  if (diff.tokenDelta > 0) items.push(t('return.tokenDelta', { total: fmtLocal(diff.tokenDelta) }));
  if (diff.sessionDelta > 0) items.push(t('return.sessionDelta', { count: diff.sessionDelta }));
  if (diff.newProjects > 0) items.push(t('return.newVines', { count: diff.newProjects }));
  if (diff.changedProjects > 0) items.push(t('return.changedProjects', { count: diff.changedProjects }));

  const topProject = diff.topProjectName
    ? '<div class="pg6-return-diff-top">' + escapeHtml(t('return.topProject', { name: diff.topProjectName })) + '</div>'
    : '';

  card.innerHTML =
    '<button class="pg6-return-diff-close" type="button" aria-label="' + escapeAttr(t('return.closeAria')) + '">' + closeSvg() + '</button>' +
    '<div class="pg6-return-diff-label">' + escapeHtml(t('return.label')) + '</div>' +
    '<div class="pg6-return-diff-title">' + escapeHtml(t('return.title')) + '</div>' +
    '<div class="pg6-return-diff-stats">' +
      items.slice(0, 3).map((item) => '<span>' + escapeHtml(item) + '</span>').join('') +
    '</div>' +
    topProject;
  card.querySelector('.pg6-return-diff-close')?.addEventListener('click', onDismiss);
  return card;
}

function readSnapshot() {
  try {
    const raw = window.localStorage && window.localStorage.getItem(SNAPSHOT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function writeSnapshot(snapshot) {
  if (!snapshot) return;
  try {
    if (window.localStorage) {
      const stored = {
        ...snapshot,
        projects: (snapshot.projects || []).map((project) => ({
          key: project.key,
          tokens: project.tokens,
          sessions: project.sessions
        }))
      };
      window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(stored));
    }
  } catch (_) {
    // Storage can be blocked; the garden still renders normally.
  }
}

function closeSvg() {
  return (
    '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">' +
    '<path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
    '</svg>'
  );
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#096;');
}
