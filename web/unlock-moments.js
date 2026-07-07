// Unlock moments (PRD 2.0 §P1-2, issue I6): diff two normalized tier frames
// and celebrate what changed through the scene banner. Celebration only —
// durable facts (rings.json) are written by core in the scan pipeline; this
// module never authors product history, it only remembers "what did this
// frontend already show" (localStorage) so moments fire exactly once.
//
// Pure parts (diffTiers / tierFrame) run under plain `node --test`; the mount
// wires them to injected collaborators (banner, tier derivation, summary
// stream) so this file needs no DOM, no data-source, and no renderer imports.
import { t } from './i18n.js';

const STORE_KEY = 'pg6.seen.tiers';
const PULSE_CLASS = 'pg6-banner-pulse';
const PULSE_MS = 1300; // slightly past the 1.2s CSS blink so it always completes

// Explicit tier orders, mirrored from core (crates/core/src/rings.rs
// derive_tier_events) plus the frontend-only daily lamp beat. Version-skew
// rule mirrored too: a value unknown to THIS build — on either side — yields
// NO moment, because we cannot order a transition we do not understand.
// Insertion order doubles as celebration order (lamp = the day's first beat).
const TIER_ORDERS = {
  lamp: ['unlit', 'lit'],
  pavilion: ['small', 'mid', 'full'],
  willow: ['young', 'mature'],
  stone_cat: ['hidden', 'small', 'full'],
  stool: ['hidden', 'visible'],
  cushion: ['hidden', 'visible'],
};

// Pure diff: (previous frame, next frame) → moment objects, newest tier state
// wins. A multi-level jump (small→full in one scan) yields ONE moment for the
// final tier — the banner celebrates where the garden IS, not each rung.
export function diffTiers(previous, next) {
  if (!previous || typeof previous !== 'object') return [];
  if (!next || typeof next !== 'object') return [];
  const moments = [];
  for (const entity of Object.keys(TIER_ORDERS)) {
    const order = TIER_ORDERS[entity];
    const fromRank = order.indexOf(previous[entity]);
    const toRank = order.indexOf(next[entity]);
    // Unknown on either side = version skew (or corrupt storage): skip.
    if (fromRank === -1 || toRank === -1) continue;
    if (toRank <= fromRank) continue; // regressions are never celebrated
    moments.push({
      kind: entity === 'lamp' ? 'lamp_lit' : 'tier_up',
      entity,
      from: previous[entity],
      to: next[entity],
    });
  }
  // Trinkets are a set, not a ladder: celebrate additions only. A non-array on
  // either side is unreadable state — same suppression stance as unknown tiers.
  if (Array.isArray(previous.pavilionTrinkets) && Array.isArray(next.pavilionTrinkets)) {
    const before = new Set(previous.pavilionTrinkets);
    for (const id of next.pavilionTrinkets) {
      if (typeof id === 'string' && id && !before.has(id)) {
        moments.push({ kind: 'trinket_unlocked', entity: id, from: null, to: 'unlocked' });
      }
    }
  }
  return moments;
}

// Pluck only the celebrated fields out of a full unlockTier() result, so the
// persisted frame carries no volatile numbers (token totals change every scan
// and must not churn the stored JSON).
export function tierFrame(tiers) {
  if (!tiers || typeof tiers !== 'object') return null;
  return {
    lamp: tiers.lamp,
    pavilion: tiers.pavilion,
    willow: tiers.willow,
    stone_cat: tiers.stone_cat,
    stool: tiers.stool,
    cushion: tiers.cushion,
    pavilionTrinkets: Array.isArray(tiers.pavilionTrinkets)
      ? tiers.pavilionTrinkets.slice()
      : [],
  };
}

// moment → { icon, text } banner copy. Tier copy embeds its glyph directly in
// the localized string (the emoji IS part of the sanctioned copy, see i18n
// keys); trinkets get a separate icon because their line is name-templated.
const TRINKET_ICONS = {
  scroll: '📜',
  tea_set: '🍵',
  wind_chime: '🎐',
  incense: '🪔',
  sleeping_cat: '🐈',
};

export function momentCopy(moment) {
  if (moment.kind === 'trinket_unlocked') {
    const nameKey = 'trinket.' + moment.entity + '.name';
    const name = t(nameKey);
    return {
      icon: TRINKET_ICONS[moment.entity] || '✨',
      // t() echoes the key back when a translation is missing (a trinket id
      // from a newer core); the raw id reads better than the raw key.
      text: t('banner.trinket', { name: name === nameKey ? moment.entity : name }),
    };
  }
  if (moment.kind === 'lamp_lit') return { icon: '', text: t('banner.lamp') };
  // tier_up: pavilion/stone_cat celebrate per-tier copy; the binary tiers
  // (willow/stool/cushion) have a single arrival line each.
  const key =
    moment.entity === 'pavilion' || moment.entity === 'stone_cat'
      ? 'banner.' + moment.entity + '.' + moment.to
      : moment.entity === 'willow'
        ? 'banner.willow.mature'
        : 'banner.' + moment.entity;
  return { icon: '', text: t(key) };
}

// Best-effort click-to-focus: pulse the celebrated object if the CURRENT
// renderer happens to expose a hook for it. Selector lists cover only classes
// that already exist in either renderer — no renderer was modified for this
// (the banner is an overlay concern). No hook, no match = silent no-op.
const FOCUS_SELECTORS = {
  lamp: ['.decor-lantern'],
  willow: ['.decor-willow'],
  pavilion: ['.pg6-iso-pavilion'],
  stone_cat: ['.cat-interactive'],
  // Stool/cushion/trinkets live inside the pavilion and have no stable
  // per-object hook; pointing at their host pavilion is the honest fallback.
  stool: ['.pg6-iso-pavilion'],
  cushion: ['.pg6-iso-pavilion'],
};

export function pulseMomentTarget(scene, moment) {
  if (!scene || !moment) return;
  const selectors =
    moment.kind === 'trinket_unlocked'
      ? ['.pg6-iso-pavilion']
      : FOCUS_SELECTORS[moment.entity] || [];
  for (const selector of selectors) {
    let el = null;
    try {
      el = scene.querySelector(selector);
    } catch (_) {
      // A bad selector must never break a click handler.
    }
    if (!el) continue;
    el.classList.add(PULSE_CLASS);
    window.setTimeout(() => el.classList.remove(PULSE_CLASS), PULSE_MS);
    return;
  }
}

// Wire the diff to a summary stream. `subscribe` is injected by the caller
// (garden.js decides what "a visible frame" means — auto_rescan gating, the
// initial load, browser fallback); `getTiers` is injected so this module does
// not care whether tiers come from core (`summary.tiers`) or the frontend
// fallback derivation in garden-tiers.js.
export function mountUnlockMoments({ banner, getTiers, subscribe, onFocus }) {
  // Last frame the user actually saw. localStorage-backed with an in-memory
  // mirror (same degradation stance as the `.is-new` seen-set in
  // render-garden.js): blocked storage just means moments may replay after a
  // reload — never an error, never a first-run banner storm, because the very
  // first frame of a session always seeds silently when nothing was stored.
  let lastFrame = loadFrame();

  subscribe((summary) => {
    if (!summary || typeof summary !== 'object') return;
    const frame = tierFrame(getTiers(summary));
    if (!frame) return;
    const previous = lastFrame;
    lastFrame = frame;
    if (previous) {
      for (const moment of diffTiers(previous, frame)) {
        const copy = momentCopy(moment);
        banner.push({
          icon: copy.icon,
          text: copy.text,
          onActivate: onFocus ? () => onFocus(moment) : undefined,
        });
      }
    }
    saveFrame(frame);
  });
}

function loadFrame() {
  try {
    const raw = window.localStorage && window.localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Returned raw (not tierFrame-normalized) on purpose: corrupt or
    // newer-schema fields must reach diffTiers' suppression guards intact
    // instead of being coerced into a fake "everything is new" frame.
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

function saveFrame(frame) {
  try {
    if (window.localStorage) {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(frame));
    }
  } catch (_) {
    // Persist failure is non-fatal — the in-memory frame still dedupes
    // within this session.
  }
}
