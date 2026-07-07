// First-run growth reveal (PRD 2.0 §P5-1 / §5.4-F, issue I9). The garden's
// first paint grows in layers instead of appearing all at once: stage (ground
// + walls) → vines → stickers → structures → creatures, ~3.5s total, click to
// skip, reduced-motion renders the final state instantly. Runs once per
// install (localStorage flag); `?firstrun=1` forces a replay for validation
// (doc 20) and demos, and demo mode always replays without touching the flag.
//
// Opacity-only on purpose: sprite positioning rides on `--sprite-transform`
// (translate(-50%,-50%) anchoring), so animating transform here would tear
// every sprite off its anchor. The spec's "landing bounce" is dropped for the
// same reason — documented deviation, not an oversight.
import { isDemoMode } from './data-source.js';
import { isMotionStill } from './render-helpers.js';

const FLAG_KEY = 'pg6.firstrun.done';
const TOTAL_MS = 3500;

// Phase buckets by the classes both renderers actually emit (inventoried from
// live DOM in classic + isometric). Order matters: the FIRST matching bucket
// wins, so vines beat the generic structure tail.
const PHASES = [
  { start: 1200, span: 1200, selector: '.project, .vine-decorative, .vine-cornice, .mark' },
  { start: 2000, span: 700, selector: '.code-sticker' },
  { start: 2400, span: 600, selector: '.object, .ground, .flower, .pg6-trinket-sprite, .pg6-wall-edge-cover' },
  { start: 3000, span: 400, selector: '.cat-interactive, .pg6-garden-cat, .pg6-season-particle, .firefly' },
];
// Anything sprite-like that no bucket claims reveals with the structures.
const FALLBACK_START = 2400;

export function shouldRunReveal({ storage, search }) {
  if (/(^|[?&])firstrun=1(&|$)/.test(search || '')) return true;
  if (isDemoMode()) return true;
  try {
    return !storage?.getItem(FLAG_KEY);
  } catch (_) {
    return false;
  }
}

function markDone(storage) {
  if (isDemoMode()) return; // the canned garden must not touch real flags
  try {
    storage?.setItem(FLAG_KEY, String(Date.now()));
  } catch (_) {
    // Blocked storage just means the reveal may play again next launch.
  }
}

/**
 * Stage the reveal on an already-painted scene. Resolves `{ ran }` after the
 * animation finishes or is skipped; `{ ran: false }` when the reveal doesn't
 * apply (repeat visit, reduced motion, empty garden).
 */
export function runGrowthReveal({ scene, summary }) {
  const storage = window.localStorage;
  const search = window.location.search;
  const hasProjects = (summary?.projects?.length ?? 0) > 0;
  if (!scene || !hasProjects || !shouldRunReveal({ storage, search })) {
    return Promise.resolve({ ran: false });
  }
  markDone(storage);
  // Reduced motion: the final state IS the reveal.
  if (isMotionStill(scene)) return Promise.resolve({ ran: false });

  const claimed = new Set();
  for (const phase of PHASES) {
    const members = [...scene.querySelectorAll(phase.selector)].filter(
      (el) => !claimed.has(el)
    );
    members.forEach((el, i) => {
      claimed.add(el);
      const step = members.length > 1 ? phase.span / (members.length - 1) : 0;
      el.style.setProperty('--fr-delay', `${Math.round(phase.start + i * step)}ms`);
    });
  }
  scene.querySelectorAll('.pg6-sprite').forEach((el) => {
    if (!claimed.has(el)) el.style.setProperty('--fr-delay', `${FALLBACK_START}ms`);
  });

  scene.classList.add('pg6-firstrun');
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      scene.removeEventListener('click', finish, true);
      scene.classList.remove('pg6-firstrun');
      // Leave no inline residue behind — the reveal must be deletable.
      claimed.forEach((el) => el.style.removeProperty('--fr-delay'));
      scene
        .querySelectorAll('.pg6-sprite')
        .forEach((el) => el.style.removeProperty('--fr-delay'));
      resolve({ ran: true });
    };
    // One click anywhere skips — capture phase so scene sprites' own click
    // handlers don't swallow it.
    scene.addEventListener('click', finish, true);
    const timer = window.setTimeout(finish, TOTAL_MS + 300);
  });
}
