// Empty-state wood sign (PRD 2.0 §P5-2): when the garden has zero projects,
// a paper board on a wooden post sits lower-center of the scene and invites
// the user to run an agent once. It mounts on the scene HOST — not inside a
// renderer — so the classic wall and the 2.5D courtyard show the identical
// sign. Renderer base paints wipe the scene's innerHTML, so update() re-appends
// the sign whenever it finds itself detached.
//
// Demo mode (?demo=1) never shows the sign: the canned sample summary is the
// whole point of that mode, and a fetch failure there is a broken deploy, not
// a first-run garden.

import { t } from './i18n.js';
import { isDemoMode } from './data-source.js';

// Static display string for now — the sign lists what the garden can watch,
// not what is actually installed on this machine.
// TODO(prd-2.0 §P5-2): light up installed agents once a detection command exists.
const SUPPORTED_AGENTS = 'Claude Code · Claude Cowork · Codex';

/**
 * Pure trigger predicate, exported for tests: "empty" means the summary has
 * no projects at all. A missing summary counts as empty on purpose — a first
 * run has no cache yet, and the sign IS the first-run experience.
 */
export function isEmptySummary(summary) {
  return (summary?.projects?.length ?? 0) === 0;
}

export function mountEmptyState({ host }) {
  if (!host) return { update: () => {} };

  const sign = document.createElement('div');
  sign.className = 'pg6-woodsign';
  // Announce the invitation when it appears (garden emptied / first run),
  // without stealing focus — same politeness rung as the PRD §5.6 banners.
  sign.setAttribute('role', 'status');
  sign.hidden = true;

  const board = document.createElement('div');
  board.className = 'pg6-woodsign-board';
  board.append(
    textLine('pg6-woodsign-title', t('empty.title')),
    textLine('pg6-woodsign-body', t('empty.body')),
    textLine('pg6-woodsign-agents', t('empty.supported', { agents: SUPPORTED_AGENTS }))
  );

  const post = document.createElement('div');
  post.className = 'pg6-woodsign-post';

  sign.append(board, post);
  host.appendChild(sign);

  return {
    update(summary) {
      const show = isEmptySummary(summary) && !isDemoMode();
      // A base repaint (renderer paint / renderer switch) rebuilds the scene
      // via innerHTML and drops the sign; re-attach before showing.
      if (show && !sign.isConnected) host.appendChild(sign);
      sign.hidden = !show;
    }
  };
}

function textLine(className, text) {
  const el = document.createElement('div');
  el.className = className;
  el.textContent = text;
  return el;
}
