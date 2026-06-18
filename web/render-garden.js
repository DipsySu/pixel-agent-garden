import { CONFIG } from './scene-config.js';
import { fmtLocal, escapeHtml, pick, pickByToken, namedSprite, jitter } from './render-helpers.js';
import { sparklineSVG, windowTotal } from './render-insight.js';
import { renderFlowerbed } from './render-flowerbed.js';
import { t } from './i18n.js';

let scene;
let spriteRoot;
let currentWallProjects = [];
// Teardown handle for the JS-driven garden-cat wander loop. The cat element is
// long-lived (see dynamicLayerSelector note); we only call this when actually
// rebuilding the cat (kind change / unlock change). See addGardenCat.
let catWanderStop = null;
// Last known cat position/facing, persisted across rebuilds so a motion-mode
// toggle (full ↔ reduced) doesn't snap the cat back to home.
let catLastPos = null;
const dynamicLayerSelector = [
  '.pg6-sprite',
  '.pg6-wall-edge-cover',
  '.pg6-petal',
  '.pg6-season-particle',
  // Flowerbed view: render-flowerbed.js appends `.pg6-flower` elements (and a
  // single `.pg6-flower-tooltip`) without self-clearing, so they MUST be in
  // the clear list — otherwise every watcher tick re-appends 366 flowers on
  // top of the old ones (stacking + leak). NOT `.pg6-garden-cat` (below) —
  // the cat is deliberately long-lived.
  '.pg6-flower',
  '.pg6-flower-tooltip',
  '.pg6-empty'
].join(', ');
// NOTE: `.pg6-garden-cat` is deliberately NOT in the clear list. The cat owns a
// long-lived rAF wander loop; tearing it down + recreating it at home on every
// watcher tick / settings re-render made it teleport mid-stroll. addGardenCat
// now reuses the live element across renders and only rebuilds it when the cat
// either (un)locks or its motion "kind" changes.

// --- S1/S2 entrance-animation bookkeeping ---------------------------------
// `.is-new` is applied only the first time a project_key / trinket id is seen,
// diffed against a persisted seen-set so grow-in / drop-in never replay on a
// data re-render (settings toggle, watcher tick). The CSS keyframes are
// one-shot and gated by `data-motion`; JS only adds the class + a stagger
// delay. Falls back to an in-memory mirror when localStorage is unavailable
// (private mode / sandboxed webview), in which case entrances may replay on
// reload — acceptable degradation, never an error.
const SEEN_STORE = { projects: 'pg6.seen.projects', trinkets: 'pg6.seen.trinkets' };
const seenMemory = { projects: null, trinkets: null };
let newProjectKeys = new Set();
let newTrinketIds = new Set();

function loadSeen(kind) {
  if (seenMemory[kind]) return seenMemory[kind];
  let set = new Set();
  try {
    const raw = window.localStorage && window.localStorage.getItem(SEEN_STORE[kind]);
    if (raw) set = new Set(JSON.parse(raw));
  } catch (_) { /* storage blocked — memory mirror only */ }
  seenMemory[kind] = set;
  return set;
}

// Records `ids` as seen and returns the subset that was NOT seen before.
function diffNew(kind, ids) {
  const seen = loadSeen(kind);
  const fresh = new Set();
  (ids || []).forEach((id) => {
    if (id && !seen.has(id)) { fresh.add(id); seen.add(id); }
  });
  if (fresh.size) {
    try {
      if (window.localStorage) {
        window.localStorage.setItem(SEEN_STORE[kind], JSON.stringify([...seen]));
      }
    } catch (_) { /* persist failure is non-fatal */ }
  }
  return fresh;
}

// `isFlowerbedEnabled` is a getter so the renderer always sees the live
// setting (settings panel can flip it without rebuilding the renderer).
let isFlowerbedEnabled = () => false;

export function createGardenRenderer(options) {
  scene = options.scene;
  spriteRoot = options.spriteRoot;
  if (typeof options.isFlowerbedEnabled === 'function') {
    isFlowerbedEnabled = options.isFlowerbedEnabled;
  }
  return { renderEverything, showScanning, showCached, selectProjectByKey };
}

function renderEverything(groups, summary) {
  const projects = summary?.projects?.length ? summary.projects : [];
  const wallProjects = projectsForWall(projects);
  currentWallProjects = wallProjects;
  const tiers = unlockTier(summary, projects);

  // S1/S2: diff this render's projects + unlocked trinkets against the
  // persisted seen-set BEFORE rendering, so addSprite / addTrinketSprite can
  // tag only the genuinely-new ones with `.is-new`.
  newProjectKeys = diffNew('projects', wallProjects.map((p) => p.project_key));
  newTrinketIds = diffNew('trinkets', tiers.pavilionTrinkets);

  // Clear previously-rendered sprite layers so re-renders don't stack.
  // The base SVG stays put — it's static.
  clearDynamicLayers();

  updateHeaderMeta();
  updateDataFreshness(summary);
  updateDefaultInfo(summary, wallProjects);
  addIvyOverlay(groups, wallProjects);
  addWallEdgeCover();
  addWallMarks(groups.plaster_patch || []);
  addGroundOverlay(groups);
  // Flowerbed view (D PoC, opt-in). When enabled, the base scene swaps the
  // grass strips for a dirt bed (see render-svg.js) and we lay 366 flower
  // sprites encoding daily activity. Drawn BEFORE courtyard objects so the
  // willow/lantern/pavilion sit in front of the flowers, not on top of them.
  if (isFlowerbedEnabled()) {
    renderFlowerbed(scene, groups.flowerbed || [], summary, { spriteRoot });
  }
  addCourtyardObjects(groups, tiers);
  addFlowerAccents(groups, tiers);
  const liveCatUnlocked = hasLiveGardenCat(groups, tiers);
  addPavilionTrinkets(tiers.pavilion, tiers.pavilionTrinkets, { skipSleepingCat: liveCatUnlocked });
  addGardenCat(groups, tiers);
  addAmbientMotion(groups, tiers);
  if (!projects.length) renderEmptyState();
}

function showScanning() {
  const el = document.getElementById('data-freshness');
  if (!el) return;
  el.textContent = t('fresh.scanning');
  el.classList.remove('is-stale', 'is-paused');
  el.classList.add('is-scanning');
  el.title = t('fresh.scanningTitle');
}

function showCached(summary) {
  updateDataFreshness(summary);
  const el = document.getElementById('data-freshness');
  if (!el) return;
  el.textContent = t('fresh.cached');
  el.classList.remove('is-scanning', 'is-stale');
  el.classList.add('is-paused');
  el.title = t('fresh.cachedTitle');
}


function clearDynamicLayers() {
  scene.querySelectorAll(dynamicLayerSelector).forEach((el) => el.remove());
}

  // ==========================================================================
  // #D1 — data freshness in footer
  // ==========================================================================
  function updateDataFreshness(summary) {
    const el = document.getElementById('data-freshness');
    if (!el) return;
    const stamp = summary && summary.last_seen;
    if (!stamp) {
      el.textContent = '';
      el.classList.remove('is-scanning', 'is-stale', 'is-paused');
      el.removeAttribute('title');
      return;
    }
    const last = new Date(stamp);
    const diff = Date.now() - last.getTime();
    const mins = Math.round(diff / 60_000);
    const hours = Math.round(diff / 3_600_000);
    const days = Math.round(diff / 86_400_000);
    let label;
    if (mins < 1)      label = t('fresh.justNow');
    else if (mins < 60) label = t('fresh.minutesAgo', { count: mins });
    else if (hours < 24) label = t('fresh.hoursAgo', { count: hours });
    else if (days < 30)  label = t('fresh.daysAgo', { count: days });
    else                 label = t('fresh.monthPlusAgo');
    el.textContent = t('fresh.updated', { when: label });
    el.classList.remove('is-scanning', 'is-paused');
    if (diff > 24 * 3_600_000) {
      el.classList.add('is-stale');
      el.title = t('fresh.staleTitle');
    } else {
      el.classList.remove('is-stale');
      el.removeAttribute('title');
    }
  }

  // ==========================================================================
  // #D5 — real-time header meta (season · solar term · time of day)
  // ==========================================================================
  // 24 solar terms, indexed by month*100+day. find latest <= today.
  const TERMS_24 = [
    [104, 'term.minorCold'], [120, 'term.majorCold'], [204, 'term.startSpring'], [219, 'term.rainWater'],
    [305, 'term.awakeningInsects'], [320, 'term.springEquinox'], [404, 'term.pureBrightness'], [420, 'term.grainRain'],
    [505, 'term.startSummer'], [521, 'term.lesserFullness'], [605, 'term.grainInEar'], [621, 'term.summerSolstice'],
    [707, 'term.minorHeat'], [722, 'term.majorHeat'], [807, 'term.startAutumn'], [823, 'term.endHeat'],
    [907, 'term.whiteDew'], [923, 'term.autumnEquinox'], [1008, 'term.coldDew'], [1023, 'term.frostDescent'],
    [1107, 'term.startWinter'], [1122, 'term.minorSnow'], [1207, 'term.majorSnow'], [1222, 'term.winterSolstice']
  ];
  function currentSolarTerm(d) {
    const md = (d.getMonth() + 1) * 100 + d.getDate();
    let term = 'term.winterSolstice';   // wrap-around for early Jan before Minor Cold
    for (const [cut, termKey] of TERMS_24) if (md >= cut) term = termKey;
    return t(term);
  }
  function updateHeaderMeta() {
    const now = new Date();
    const season = document.getElementById('meta-season');
    const time = document.getElementById('meta-time');
    if (season) season.textContent = sceneLabel('seasonLabel', t('season.spring')) + ' · ' + currentSolarTerm(now);
    if (time) {
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      time.textContent = sceneLabel('timeLabel', t('time.day')) + ' · ' + hh + ':' + mm;
    }
  }

  function sceneLabel(key, fallback) {
    return scene?.dataset?.[key] || fallback;
  }

  // ==========================================================================
  // #D2 — vine tint by primary source
  // claude-code-only      → 0deg   (default green)
  // codex-only            → -28deg (bluer, cool)
  // mixed                 → linear blend by codex share
  // unknown source        → 0deg
  // ==========================================================================
  function vineHueShift(project) {
    const sources = project && project.sources;
    if (!sources || typeof sources !== 'object') return null;
    const claude = sources['claude-code'] || sources['claude_code'] || 0;
    const codex = sources['codex'] || 0;
    const other = Object.entries(sources).reduce((sum, [k, v]) => {
      return (k === 'claude-code' || k === 'claude_code' || k === 'codex') ? sum : sum + (v || 0);
    }, 0);
    const total = claude + codex + other;
    if (total <= 0) return null;
    // codex share drives the shift; "other" sources nudge slightly warm
    const codexShare = codex / total;
    const otherShare = other / total;
    const deg = Math.round(-28 * codexShare + 14 * otherShare);
    return deg === 0 ? null : deg + 'deg';
  }

  function addCourtyardObjects(groups, tiers) {
    const pavilions = groups.pavilion_compact || [];
    const bamboo = groups.bamboo_cluster || [];
    const pathStones = groups.path_stones || [];
    const lowTables = (groups.wood_low_table && groups.wood_low_table.length)
      ? groups.wood_low_table
      : (groups.stone_stool || []);
    const cushions = groups.cushion || [];
    const cherries = groups.cherry_tree || [];
    const willows = groups.willow || [];
    // Prefer the new stone_cat sprite group; fall back to legacy shrine assets
    // so the page still renders during the asset migration.
    const stoneCats = (groups.stone_cat && groups.stone_cat.length)
      ? groups.stone_cat
      : (groups.shrine || []);
    const lanterns = groups.stone_lantern || [];
    const cairns = groups.stone_cairn || [];
    if (bamboo.length) {
      // A small grove of 3 clusters — back/mid/foreground — built from
      // distinct variants so it doesn't read as one repeated sprite.
      // Falls back gracefully if not all variants are in the manifest.
      const back  = namedSprite(bamboo, 'bamboo_cluster_03') || bamboo[0];
      const mid   = namedSprite(bamboo, 'bamboo_cluster_02') || bamboo[bamboo.length > 1 ? 1 : 0];
      const front = namedSprite(bamboo, 'bamboo_cluster_01') || bamboo[bamboo.length > 2 ? 2 : 0];
      // Grove pulled left + narrowed (layout audit F8): the old grove spanned
      // [0.6,17.5] while the cherry spans [10.1,25.9] — a 7.4% overlap where the
      // mid cluster shoved into the cherry's left canopy. Tucking the grove into
      // the corner ([0,~12]) clears it.
      // back row (taller, slightly farther left)
      addSprite(back,  { x:  4.0, y: 90.0, width: 50, z: 23, opacity: 0.95, className: 'object', anchor: 'bottom' });
      // mid row (fuller, anchors the grove)
      addSprite(mid,   { x:  7.5, y: 91.2, width: 58, z: 26, opacity: 0.97, className: 'object', anchor: 'bottom' });
      // foreground accent (smaller, in front for depth)
      addSprite(front, { x:  2.5, y: 92.4, width: 34, z: 29, opacity: 1.0,  className: 'object', anchor: 'bottom' });
    }
    if (cherries.length) {
      // Cherry is one of two visual anchors (with the pavilion). Sized to
      // roughly 60% of the pavilion full width so it reads as a peer object,
      // not a small accent. Three recent_activity tiers — bud → bloom → petal
      // (peak). The petal frame is a fuller/more-saturated bloom; if it's
      // absent from the manifest we fall back to bloom so older asset sets keep
      // rendering (addSprite has no null guard, so the fallback chain matters).
      const cherryTier = tiers.cherry;
      const sprite =
        cherryTier === 'petal'
          ? (namedSprite(cherries, 'cherry_tree_petal') || namedSprite(cherries, 'cherry_tree_bloom') || pickByToken(cherries, 5))
          : cherryTier === 'bloom'
            ? (namedSprite(cherries, 'cherry_tree_bloom') || pickByToken(cherries, 5))
            : (namedSprite(cherries, 'cherry_tree_bud') || pickByToken(cherries, 2));
      // Peak (petal) reads as the climax via a slightly wider footprint plus the
      // denser sprite + 12 falling petals — kept ≤110 so it doesn't out-scale
      // the pavilion anchor.
      const cherryWidth = cherryTier === 'bud' ? 78 : cherryTier === 'petal' ? 108 : 100;
      // x 23→18→21. First lowered alongside willow x 48→60 (a layout audit
      // found the mature willow engulfing the cherry by ≈59% at the petal tier).
      // Then nudged 18→21 (audit F8) to clear the bamboo grove on its left: the
      // grove [0.6,17.5] had overlapped the cherry [10.1,25.9] by 7.4%, so the
      // grove was pulled into the corner and the cherry stepped right — they now
      // sit shoulder-to-shoulder with a small gap, cherry clearing the stone cat.
      addSprite(sprite, {
        x: 21,
        y: 91.4,
        width: cherryWidth,
        z: 22,
        opacity: 0.98,
        className: 'object decor-cherry',
        anchor: 'bottom'
      });
    }
    if (willows.length) {
      // Willow scales to ~65% of pavilion when mature — it should feel like
      // the biggest tree in the courtyard, BUT not swallow the cherry. Audit
      // fix: x 48→60, mature width 125→105 (cap footprint).
      const sprite = namedSprite(willows, tiers.willow === 'mature' ? 'willow_mature' : 'willow_young') || pickByToken(willows, tiers.willow === 'mature' ? 5 : 2);
      addSprite(sprite, {
        x: 60,
        y: 90.9,
        width: tiers.willow === 'mature' ? 105 : 88,
        z: 21,
        opacity: 0.98,
        className: 'object decor-willow',
        anchor: 'bottom'
      });
    }
    if (tiers.stone_cat !== 'hidden' && stoneCats.length) {
      // Try new stone_cat names first, fall back to legacy shrine names.
      const wantFull = tiers.stone_cat === 'full';
      const sprite =
           namedSprite(stoneCats, wantFull ? 'stone_cat_full' : 'stone_cat_small')
        || namedSprite(stoneCats, wantFull ? 'shrine_full'    : 'shrine_small')
        || pickByToken(stoneCats, wantFull ? 5 : 2);
      const catImg = addSprite(sprite, {
        x: 34,
        y: 92.3,
        // wantFull width 58→50: audit found 18.5% overlap with stone_lantern
        // (x=60, w=31). Cap to 50 → overlap drops to ~14.5 / 47% of lantern.
        width: wantFull ? 50 : 46,
        z: 24,
        opacity: 1.0,
        className: 'object cat-interactive',
        anchor: 'bottom'
      });
      // #D3 — cat hover/focus reveals "guardian" info card
      if (catImg) {
        const catLabel = t('card.cat.label');
        catImg.tabIndex = 0;
        catImg.setAttribute('role', 'img');
        catImg.setAttribute('aria-label', catLabel);
        catImg.title = catLabel;
        catImg.addEventListener('mouseenter', () => {
          updateInfoFromCat(tiers);
          positionInfoCardFromElement(catImg);
        });
        catImg.addEventListener('focus', () => {
          updateInfoFromCat(tiers);
          positionInfoCardFromElement(catImg);
        });
        catImg.addEventListener('mouseleave', hideInfoCard);
        catImg.addEventListener('blur', hideInfoCard);
      }
    }
    if (lanterns.length) {
      const sprite = namedSprite(lanterns, tiers.lamp === 'lit' ? 'stone_lantern_lit' : 'stone_lantern_unlit') || pickByToken(lanterns, tiers.lamp === 'lit' ? 5 : 1);
      const timeMode = sceneTimeMode();
      const lampLit = tiers.lamp === 'lit' || timeMode === 'night' || timeMode === 'dusk';
      // x 60→45 (layout audit F6): the lantern (x=60, bbox [57.7,62.3]) sat
      // ENTIRELY inside the mature willow (x=60, bbox [52.3,67.7]) — a regression
      // from moving the willow 48→60 to clear the cherry, which parked it right
      // on top of the lantern (willow droops hid the lantern cap). Move the
      // lantern into the empty 14%-wide bay between the stone cat (right 37.7)
      // and the willow (left 52.3), centered — it now lights the path edge with
      // ~5% clearance on each side instead of being swallowed by the tree.
      addSprite(sprite, {
        x: 45,
        y: 91.5,
        width: 31,
        z: 25,
        opacity: lampLit ? 1.0 : 0.82,
        className: 'object decor-lantern ' + (lampLit ? 'is-lit' : 'is-dim'),
        anchor: 'bottom'
      });
    }
    if (cairns.length) {
      // Cairn size piggybacks on the stone_cat tier (both grow with sessions).
      // Placement is space-constrained: the willow [52.3,67.7] and pavilion
      // [65.4,96.6] nearly fill the right half, so the cairn lives in the narrow
      // willow–pavilion gap. Iterated x 78→72→70 + width 42→38→30 / 32→30→26
      // (audit F7/F9): x=78 stood INSIDE the pavilion on the floor beside the
      // tea table (indoor-furniture look); x=70 + the downsize tuck it against
      // the willow's right edge (~0% overlap) as a slim pagoda that clears the
      // pavilion's front-left column and no longer pokes into the eave.
      const wantFull = tiers.stone_cat === 'full';
      const sprite = namedSprite(cairns, wantFull ? 'stone_cairn_full' : 'stone_cairn_small')
                  || pickByToken(cairns, wantFull ? 5 : 2);
      addSprite(sprite, {
        x: 70,
        y: 92,
        width: wantFull ? 30 : 26,
        z: 25,
        opacity: 1.0,
        className: 'object',
        anchor: 'bottom'
      });
    }
    // NOTE: the worn-path sprite is no longer placed here — the courtyard path
    // is now drawn as crisp pixel-art flagstones in the base scene
    // (render-svg.js), so it reads as deliberate pixel art instead of a faint
    // 0.62-opacity blur. `path_stones` stays in the manifest as a legacy asset.
    void pathStones;
    if (pavilions.length) {
      // Audit fix F5: was hardcoded x=82.5 / y=90.5 here while scene-config's
      // pavilionAnchor was {cx_pct:81, bottom_pct:91} — the trinket-placement
      // math read from CONFIG but the actual pavilion sprite sat 1.5 scene-%
      // to the right of where the interior bounding box thought it did, so
      // trinkets drifted leftward relative to the visible pavilion. Use the
      // config as the single source of truth.
      const pavilionIndex = { small: 1, mid: 3, full: 5 }[tiers.pavilion] || 1;
      const sprite = pickByToken(pavilions, pavilionIndex);
      addSprite(sprite, {
        x: CONFIG.pavilionAnchor.cx_pct,
        y: CONFIG.pavilionAnchor.bottom_pct,
        width: pavilionWidth(tiers.pavilion),
        z: 24,
        opacity: 1.0,
        className: 'object',
        anchor: 'bottom'
      });
    }
    // Low table + cushion live INSIDE the pavilion on the floor. The table is
    // a warm wooden replacement for the old stone stool, sized wide enough for
    // tea_set + incense trinkets to read as placed on its top surface. Cushion
    // stays beside it on the floor, matching the reference's quiet resting area.
    // z = 25/26 places them in front of the pavilion sprite so they peek
    // through the open columns at the front.
    if (tiers.stool === 'visible' && lowTables.length) {
      const p = pavilionInteriorPoint(tiers.pavilion, 50, 94);
      addSprite(lowTables[0], {
        x: p.x,
        y: p.y,
        width: 54,
        z: 25,
        opacity: 1.0,
        className: 'object',
        anchor: 'bottom'
      });
    }
    if (tiers.cushion === 'visible' && cushions.length) {
      // Floor-left of the stool. Mirrors sleeping_cat (right floor at slot
      // x=80) so the floor reads symmetric: cushion left, stool center,
      // sleeping_cat right.
      const p = pavilionInteriorPoint(tiers.pavilion, 22, 96);
      addSprite(cushions[0], {
        x: p.x,
        y: p.y,
        width: 18,
        z: 26,
        opacity: 1.0,
        className: 'object',
        anchor: 'bottom'
      });
    }
  }

  // Activity-driven flower accents at the cherry base. Count tracks the cherry
  // tier so flowers and the cherry peak together: bud→0, bloom→2, petal→4. Max
  // 4 == the number of flower_cluster variants, so a full pass never repeats a
  // sprite. A growing-season accent — spring/summer only, hidden in
  // autumn/winter (same spirit as addSpringPetals being spring-only). Clustered
  // tightly around the cherry trunk (x:23, ~17..30) so it never collides with
  // bamboo (≤12.5) / stone_cat (34) / lantern / pavilion. Deterministic via
  // jitter — no Math.random — so re-renders don't reshuffle. Flowers are
  // pointer-events:none in CSS so they never block vine/cat/trinket hover.
  function addFlowerAccents(groups, tiers) {
    const flowers = groups.flower_cluster || [];
    if (!flowers.length) return;
    const season = sceneSeason();
    if (season !== 'spring' && season !== 'summer') return;
    const count = tiers.cherry === 'petal' ? 4 : tiers.cherry === 'bloom' ? 2 : 0;
    for (let i = 0; i < count; i++) {
      const spread = count > 1 ? i / (count - 1) : 0.5;
      addSprite(pick(flowers, i), {
        x: 18 + spread * 11 + (jitter(i, 71) - 0.5) * 2.2,  // ~17..30, hugs the cherry base
        y: 91.6 + jitter(i, 72) * 2.2,                       // 91.6..~93.8 on the ground band
        width: 25 + jitter(i, 73) * 9,                       // 25..34, small accent
        z: 23,
        opacity: 0.92,
        className: 'flower',
        anchor: 'bottom'
      });
    }
  }

  function projectsForWall(projects) {
    // The garden wall is a token-growth visualization, so visible vines are
    // ordered by token mass. Nothing is truncated: smaller projects still get
    // a thinner vine and a chip, because the garden is an archive, not a top-N
    // leaderboard.
    return [...projects]
      .sort((a, b) => (b.total_tokens || 0) - (a.total_tokens || 0));
  }

  function pavilionWidth(tier) {
    return CONFIG.pavilionWidths[tier] || CONFIG.pavilionWidths.small;
  }

  function unlockTier(summary, projects) {
    const list = projects || [];
    const totalTokens = summary?.total_tokens || list.reduce((sum, project) => sum + (project.total_tokens || 0), 0);
    const maxProjectTokens = Math.max(...list.map((project) => project.total_tokens || 0), 0);
    const totalSessions = list.reduce((sum, project) => sum + (project.sessions || 0), 0);
    const maxStage = Math.max(...list.map((project) => project.stage || 1), 1);
    const recentActivity = list.reduce((sum, project) => sum + (project.recent_activity || 0), 0);
    const now = new Date();
    const todayKey = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0')
    ].join('-');
    const todayActivity = list.reduce((sum, project) => {
      const daily = project.daily_activity || {};
      return sum + (daily[todayKey] || 0);
    }, 0);

    const trinkets = CONFIG.pavilionTrinkets
      .filter((t) => totalTokens >= t.threshold)
      .map((t) => t.id);

    const c = CONFIG;
    return {
      totalTokens,
      maxProjectTokens,
      totalSessions,
      recentActivity,
      todayActivity,
      pavilion:
        maxProjectTokens >= c.pavilion.full ? 'full'
        : maxProjectTokens >= c.pavilion.mid ? 'mid'
        : 'small',
      cherry:
        recentActivity >= c.cherry.petal ? 'petal'
        : recentActivity >= c.cherry.bloom ? 'bloom'
        : 'bud',
      willow:
        (totalTokens >= c.willow.mature_tokens || list.length >= c.willow.mature_projects)
          ? 'mature' : 'young',
      stone_cat:
        totalSessions >= c.stone_cat.full ? 'full'
        : totalSessions >= c.stone_cat.small ? 'small'
        : 'hidden',
      lamp: todayActivity > 0 ? 'lit' : 'unlit',
      stool: maxStage >= c.stool.min_stage ? 'visible' : 'hidden',
      cushion: maxStage >= c.cushion.min_stage ? 'visible' : 'hidden',
      pavilionTrinkets: trinkets
    };
  }

  // ========================================================================
  // Pavilion trinket slot system.
  // Each trinket has a slot.{x,y} inside the pavilion's interior bounding box.
  // ========================================================================
  function addPavilionTrinkets(pavilionTier, unlockedIds, options = {}) {
    if (!unlockedIds || !unlockedIds.length) return;
    const bbox = pavilionBoundingBox(pavilionTier);
    const int = CONFIG.pavilionInterior;
    const intLeft   = bbox.left + int.left   * bbox.width;
    const intTop    = bbox.top  + int.top    * bbox.height;
    const intWidth  = (int.right  - int.left) * bbox.width;
    const intHeight = (int.bottom - int.top)  * bbox.height;

    const unlocked = new Set(unlockedIds);
    CONFIG.pavilionTrinkets.forEach((tk, idx) => {
      if (!unlocked.has(tk.id)) return;
      if (options.skipSleepingCat && tk.id === 'sleeping_cat') return;
      const xPct = intLeft + (tk.slot.x / 100) * intWidth;
      const yPct = intTop  + (tk.slot.y / 100) * intHeight;
      if (tk.file) addTrinketSprite(tk, xPct, yPct, tk.w, idx);
    });
  }

  function addTrinketSprite(trinket, xPct, yPct, wUnits, idx) {
    const label = trinketLabel(trinket);
    const img = document.createElement('img');
    img.className = 'pg6-sprite object pg6-trinket-sprite';
    img.src = spriteRoot + trinket.file;
    img.alt = '';
    img.decoding = 'async';
    img.loading = 'eager';
    img.style.left = xPct + '%';
    img.style.top = yPct + '%';
    img.style.width = (wUnits / 680 * 100) + '%';
    img.style.zIndex = String(40 + idx);
    const anchorTransform = trinket.anchor === 'bottom' ? 'translate(-50%, -100%)' : 'translate(-50%, -50%)';
    img.style.setProperty('--sprite-transform', anchorTransform);
    img.tabIndex = 0;
    img.title = label.name + ' · ' + label.hint;
    img.setAttribute('aria-label', label.name + ', ' + label.hint);
    img.addEventListener('mouseenter', () => {
      updateInfoFromTrinket(trinket);
      positionInfoCardFromElement(img);
    });
    img.addEventListener('focus', () => {
      updateInfoFromTrinket(trinket);
      positionInfoCardFromElement(img);
    });
    img.addEventListener('mouseleave', hideInfoCard);
    img.addEventListener('blur', hideInfoCard);
    // S2: one-shot drop-in when this trinket's threshold is unlocked for the
    // first time. Stagger by trinket index so multiple simultaneous unlocks
    // land in sequence. CSS gates the actual motion.
    if (newTrinketIds.has(trinket.id)) {
      img.classList.add('is-new');
      img.style.setProperty('--drop-delay', (Math.min(idx, 6) * 90) + 'ms');
    }
    scene.append(img);
  }

  function hasLiveGardenCat(groups, tiers) {
    return Boolean(
      groups.garden_cat?.length
      && Array.isArray(tiers.pavilionTrinkets)
      && tiers.pavilionTrinkets.includes('sleeping_cat')
    );
  }

  // --- Garden cat (五亿 token 住客) ---------------------------------------
  // Roam box in scene-% coords: a wide courtyard band the cat strolls within.
  // x spans most of the yard (was a fixed ±116px wander on the right only),
  // y is a shallow ground band that also drives a subtle near/far scale.
  const CAT_ROAM = { xMin: 30, xMax: 72, yMin: 76, yMax: 84 };
  // Resting spot used by the static (reduced/off) fallback.
  const CAT_HOME = { x: 60, y: 80 };
  // 68px sprite cell (~58px of actual cat body with padding). Sized so the
  // displayed cat body lands near the old ~55px width despite the square
  // cell's vertical padding.
  const CAT_W_FRAC = 64 / 680;
  // Habit zones (Codex's #1 fix): real cats don't sample a rectangle uniformly —
  // they revisit a handful of favored spots and graze the perimeter. Weighted
  // anchors over the open grass / path; medium + cross-yard hops aim at these,
  // while most legs are short local patrols that keep their heading. Aligned to
  // courtyard landmarks: left grass, center, the worn path, the lantern, the
  // pavilion apron, and a rare back-center point.
  const CAT_ZONES = [
    { x: 36, y: 82, w: 3 },
    { x: 44, y: 80, w: 2 },
    { x: 55, y: 83, w: 3 },
    { x: 62, y: 79, w: 2 },
    { x: 69, y: 81, w: 2 },
    { x: 50, y: 77, w: 1 }
  ];

  // Sprite sheet is 10 cols × 3 rows (background-size 1000% 300%). Authored as:
  //   row 0 cols 0-7 → walk right    row 1 cols 0-7 → walk left
  //   row 2 cols 0-3 → turn frames   row 2 cols 4-5 → sit / idle
  function catFrameBg(col, row) {
    return ((col * 100) / 9).toFixed(3) + '% ' + row * 50 + '%';
  }

  function addGardenCat(groups, tiers) {
    // The cat element is long-lived across re-renders. We only rebuild it when
    // it (un)locks or its motion "kind" changes — otherwise we leave the live
    // element + its wander loop running so the cat never teleports home.
    const want = hasLiveGardenCat(groups, tiers);
    const mode = sceneMotionMode();
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const full = mode !== 'off' && mode !== 'reduced' && !prefersReduced;
    const kind = !want ? 'none' : full ? 'wander' : (mode === 'reduced' ? 'reduced' : 'static');

    const existing = scene.querySelector('.pg6-garden-cat');
    if (existing && existing.dataset.catKind === kind) return;  // nothing changed

    // Kind changed (or first appearance / disappearance): tear the old one down.
    if (catWanderStop) { catWanderStop(); catWanderStop = null; }
    if (existing) existing.remove();
    if (!want) return;

    const sprite = namedSprite(groups.garden_cat || [], 'garden_cat')
      || namedSprite(groups.garden_cat || [], 'garden_cat_walk')
      || groups.garden_cat[0];
    if (!sprite?.file) return;
    const cat = document.createElement('span');
    cat.className = 'pg6-garden-cat';
    cat.dataset.catKind = kind;
    cat.setAttribute('role', 'img');
    cat.setAttribute('aria-label', '庭院猫');
    cat.title = '庭院猫 · 五亿 token 住客';
    cat.style.setProperty('--cat-sprite', `url("${spriteRoot + sprite.file}")`);
    cat.style.setProperty('--cat-width', (CAT_W_FRAC * 100) + '%');
    cat.style.zIndex = '64';

    if (full) {
      scene.append(cat);
      catWanderStop = startCatWander(cat);
      return;
    }

    // Static fallback. data-motion="reduced" keeps the CSS pg6-cat-idle blink
    // (so leave background-position/animation to CSS); off / system-with-
    // prefers-reduced sit still on a single idle frame. Sit wherever the cat
    // last was so a mid-stroll motion toggle doesn't snap it home.
    cat.style.setProperty('--cat-left', (catLastPos?.x ?? CAT_HOME.x) + '%');
    cat.style.setProperty('--cat-top', (catLastPos?.y ?? CAT_HOME.y) + '%');
    if (mode !== 'reduced') {
      cat.style.animation = 'none';
      cat.style.backgroundPosition = catFrameBg(4, 2);
    }
    scene.append(cat);
  }

  // JS-driven wander state machine over rAF. Position is transform-only (GPU, no
  // per-frame layout) and recomputed against the live scene size, so the roam
  // range scales with the display. Honors data-motion via the `full` gate in
  // addGardenCat. The behavior model came out of an adversarial design pass with
  // Codex — the goal is "a real cat strolling a yard", within a tiny sprite
  // vocabulary (walk L/R, turn, sit). Highest-ROI moves, in order:
  //   • destinations are weighted habit-zones + short heading-preserving patrols
  //     (not uniform-random) — kills the "drone cutting across the yard" tell;
  //   • subtle accel/decel ZONES per leg (never easing to zero → no moonwalk),
  //     while the walk-frame cadence stays distance-driven so feet never slide;
  //   • a turn + brief hesitation before walking (anticipation reads as life);
  //   • an arrival "plant" frame before sitting, and a rest menu that is mostly
  //     short beats with rare long sits and "alert" stillness (animals aren't
  //     animated 100% of the time). Mid-walk pauses, when they happen, freeze a
  //     planted WALK frame — never a SIT (sitting mid-stride is a visual lie).
  function startCatWander(cat) {
    const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
    const rand = (a, b) => a + Math.random() * (b - a);
    const yspan = CAT_ROAM.yMax - CAT_ROAM.yMin;
    const center = (CAT_ROAM.xMin + CAT_ROAM.xMax) / 2;
    // STRIDE was 2.4, BASE_SPEED was lerp(7.5, 12.5). Slowed ~20% to a more
    // contemplative pacing (user request: "动作稍微慢一些"). The slower base
    // makes idle / sit / lie beats land in a calmer rhythm too, so the cat
    // reads as a courtyard resident rather than a busy NPC.
    const STRIDE = 2.0;   // % of scene width travelled per walk frame

    const zoneTotal = CAT_ZONES.reduce((sum, z) => sum + z.w, 0);
    function weightedZone() {
      let r = Math.random() * zoneTotal;
      for (const z of CAT_ZONES) { if ((r -= z.w) <= 0) return z; }
      return CAT_ZONES[0];
    }
    function farZone() {
      let best = CAT_ZONES[0], bestD = -1;
      for (const z of CAT_ZONES) { const d = Math.abs(z.x - x); if (d > bestD) { bestD = d; best = z; } }
      return best;
    }

    cat.style.left = '0px';
    cat.style.top = '0px';
    cat.style.animation = 'none';
    // Hidden until the first frame positions it — avoids a corner flash when
    // the scene hasn't been laid out yet at append time (clientWidth === 0).
    cat.style.visibility = 'hidden';

    let sceneW = 0, sceneH = 0, catWpx = 0;
    function measure() {
      const r = scene.getBoundingClientRect();
      sceneW = scene.clientWidth || r.width || 0;
      sceneH = scene.clientHeight || r.height || 0;
      catWpx = CAT_W_FRAC * sceneW;
    }
    measure();

    let x = catLastPos?.x ?? CAT_HOME.x;
    let y = catLastPos?.y ?? CAT_HOME.y;
    let facing = catLastPos?.facing ?? (Math.random() < 0.5 ? 'right' : 'left');
    let lastDir = facing === 'right' ? 1 : -1;
    let sx = x, sy = y, tx = x, ty = y;
    let pendingFacing = facing;
    let state = 'rest', timer = 600;
    let legDist = 0, baseSpeed = 10, accelZone = 1, decelZone = 1, turnDur = 320;
    let pauseAt = -1, paused = false;
    // Rest "kind" picks WHICH row-2 cell pair to toggle between, so each
    // rest length looks visually distinct:
    //   alert  = stand & look (col 4↔5) — the "I heard something" pose
    //   sit    = sit up (col 6↔7) — classic seated cat
    //   lie    = settle on belly (col 8↔9) — long, relaxed rest
    // `restAnimate=false` freezes a single frame (alert-stillness).
    let restAnimate = true, restKind = 'sit', sitFrame = 6, toggleTimer = 0;
    let rafId = 0, lastTs = 0, stopped = false;

    function apply() {
      if (!sceneW) measure();
      if (!sceneW) return;
      const leftPx = (x / 100) * sceneW - catWpx / 2;
      const topPx = (y / 100) * sceneH;
      const s = 0.95 + 0.1 * clamp((y - CAT_ROAM.yMin) / yspan, 0, 1);
      cat.style.transform =
        'translate3d(' + leftPx.toFixed(1) + 'px,' + topPx.toFixed(1) + 'px,0) scale(' + s.toFixed(3) + ')';
      if (cat.style.visibility === 'hidden') cat.style.visibility = 'visible';
      catLastPos = { x, y, facing };
    }

    // Walk frame is chosen by distance travelled this leg, NOT elapsed time, so
    // the legs always match ground speed through accel/decel (no foot slide).
    function walkFrameBg() {
      const col = Math.floor(Math.abs(x - sx) / STRIDE) % 8;
      return catFrameBg(col, facing === 'right' ? 0 : 1);
    }

    // 70% short local patrol that keeps its heading (commitment bias), 20%
    // medium hop to a weighted habit zone, 10% cross-yard to the farthest zone.
    function pickDestination() {
      const r = Math.random();
      let nx, ny;
      if (r < 0.70) {
        let dir = lastDir;
        if (Math.random() > 0.65) dir = -dir;          // 35% reverse, else commit
        nx = x + dir * rand(4, 13);
        ny = y + rand(-1.2, 1.2);
      } else if (r < 0.90) {
        const z = weightedZone();
        nx = z.x + rand(-4, 4);
        ny = z.y + rand(-1.5, 1.5);
      } else {
        const z = farZone();
        nx = z.x + rand(-4, 4);
        ny = z.y + rand(-1.5, 1.5);
      }
      nx = clamp(nx, CAT_ROAM.xMin, CAT_ROAM.xMax);
      ny = clamp(ny, CAT_ROAM.yMin, CAT_ROAM.yMax);
      if (Math.abs(nx - x) < 3) nx = clamp(x + (x < center ? 6 : -6), CAT_ROAM.xMin, CAT_ROAM.xMax);
      return { nx, ny };
    }

    // Set up the next leg: easing zones, optional micro-pause, and a turn or a
    // small hesitation before the walk actually starts.
    function beginLeg() {
      const { nx, ny } = pickDestination();
      sx = x; sy = y; tx = nx; ty = ny;
      legDist = Math.abs(tx - sx);
      baseSpeed = lerp(6.0, 10.0, clamp(legDist / 32, 0, 1)) * rand(0.9, 1.12);
      accelZone = Math.min(0.18 * legDist, 2.5);
      decelZone = Math.min(0.22 * legDist, 3.0);
      pendingFacing = tx >= sx ? 'right' : 'left';
      pauseAt = (legDist > 18 && Math.random() < 0.18) ? rand(0.35, 0.70) : -1;
      paused = false;
      if (pendingFacing !== facing) { state = 'preturn'; turnDur = rand(360, 480); timer = turnDur; }
      else if (Math.random() < 0.35) { state = 'hesitate'; timer = rand(160, 380); }
      else { facing = pendingFacing; lastDir = facing === 'right' ? 1 : -1; state = 'walk'; }
    }

    // Rest menu. Each branch picks a duration AND a posture (restKind) that
    // matches the duration's mood. Slowed ~20% per the user's pacing request.
    //
    //   55% short stand-and-look (alert pose, col 4↔5 toggle) — the cat
    //        paused mid-yard to listen / glance around
    //   20% alert stillness — same alert pose, held on one frame (no toggle)
    //   12% medium sit (col 6↔7 toggle) — actually sits down for a beat
    //    8% long lie (col 8↔9 toggle) — settles on belly to rest
    //    5% immediate next hop (no perceptible rest)
    //
    // The toggle pair is { col_a, col_b }: 4/5 (alert), 6/7 (sit), 8/9 (lie).
    function beginRest() {
      const r = Math.random();
      if (r < 0.55) {
        timer = rand(800, 2200);  restAnimate = true;  restKind = 'alert';
      } else if (r < 0.75) {
        timer = rand(1300, 2900); restAnimate = false; restKind = 'alert';
      } else if (r < 0.87) {
        timer = rand(2500, 5000); restAnimate = true;  restKind = 'sit';
      } else if (r < 0.95) {
        timer = rand(4500, 9000); restAnimate = true;  restKind = 'lie';
      } else {
        timer = rand(180, 450);   restAnimate = false; restKind = 'alert';
      }
      state = 'rest';
      const baseCol = restKind === 'lie' ? 8 : restKind === 'sit' ? 6 : 4;
      sitFrame = baseCol;
      // Slower toggle on calmer rests — sit/lie ought to feel still.
      toggleTimer = restKind === 'lie' ? rand(1400, 2600)
                  : restKind === 'sit' ? rand(1100, 2200)
                                       : rand(900, 2000);
      cat.style.backgroundPosition = catFrameBg(sitFrame, 2);
    }

    function frame(ts) {
      if (stopped) return;
      if (!cat.isConnected) { stop(); return; }
      if (!lastTs) lastTs = ts;
      let dt = ts - lastTs; lastTs = ts;
      if (dt < 0) dt = 0; if (dt > 50) dt = 50;

      if (state === 'rest') {
        timer -= dt;
        if (restAnimate) {
          toggleTimer -= dt;
          if (toggleTimer <= 0) {
            // Each rest kind toggles within its own pair: alert 4↔5,
            // sit 6↔7, lie 8↔9. baseCol stays constant per rest, the
            // toggle flips +/- 1.
            const baseCol = restKind === 'lie' ? 8 : restKind === 'sit' ? 6 : 4;
            sitFrame = sitFrame === baseCol ? baseCol + 1 : baseCol;
            toggleTimer = restKind === 'lie' ? rand(1400, 2600)
                        : restKind === 'sit' ? rand(1100, 2200)
                                             : rand(900, 2000);
            cat.style.backgroundPosition = catFrameBg(sitFrame, 2);
          }
        }
        if (timer <= 0) beginLeg();
      } else if (state === 'preturn') {
        timer -= dt;
        const p = clamp(1 - timer / turnDur, 0, 1);
        cat.style.backgroundPosition = catFrameBg(Math.min(3, Math.floor(p * 4)), 2);
        if (timer <= 0) { facing = pendingFacing; lastDir = facing === 'right' ? 1 : -1; state = 'hesitate'; timer = rand(120, 300); }
      } else if (state === 'hesitate' || state === 'micropause') {
        timer -= dt;                              // hold the current planted frame
        if (timer <= 0) state = 'walk';
      } else if (state === 'walk') {
        const dir = facing === 'right' ? 1 : -1;
        const traveled = Math.abs(x - sx);
        const remaining = Math.max(0, legDist - traveled);
        let m = 1;                                // subtle accel/decel, never → 0
        if (traveled < accelZone && accelZone > 0) m = lerp(0.4, 1, smooth(traveled / accelZone));
        else if (remaining < decelZone && decelZone > 0) m = lerp(0.5, 1, smooth(remaining / decelZone));
        const step = (baseSpeed * m * dt) / 1000;
        if (remaining <= step) {
          x = tx; y = ty;
          cat.style.backgroundPosition = walkFrameBg();
          state = 'settle'; timer = rand(120, 220);
        } else {
          x += dir * step;
          if (legDist > 0.001) y = sy + (ty - sy) * (Math.abs(x - sx) / legDist);
          cat.style.backgroundPosition = walkFrameBg();
          if (pauseAt >= 0 && !paused && legDist > 0 && (Math.abs(x - sx) / legDist) >= pauseAt) {
            paused = true; state = 'micropause'; timer = rand(250, 700);
          }
        }
      } else { // settle — hold the just-arrived planted frame, then sit
        timer -= dt;
        if (timer <= 0) beginRest();
      }

      apply();
      rafId = requestAnimationFrame(frame);
    }

    function onResize() { measure(); apply(); }
    function stop() {
      stopped = true;
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
    }

    window.addEventListener('resize', onResize);
    beginRest();
    apply();
    rafId = requestAnimationFrame(frame);
    return stop;
  }

  function pavilionInteriorPoint(tier, slotX, slotY) {
    // slotX / slotY are 0..100, relative to the pavilion's INTERIOR sub-box
    // (not the full sprite). Returns scene-percentage coords.
    const bbox = pavilionBoundingBox(tier);
    const int = CONFIG.pavilionInterior;
    const intLeft = bbox.left + int.left * bbox.width;
    const intTop  = bbox.top  + int.top  * bbox.height;
    const intW = (int.right  - int.left) * bbox.width;
    const intH = (int.bottom - int.top)  * bbox.height;
    return {
      x: intLeft + (slotX / 100) * intW,
      y: intTop  + (slotY / 100) * intH
    };
  }

  function pavilionBoundingBox(tier) {
    // Returns {left, top, width, height} in scene-percentage coords for the
    // pavilion sprite at the configured anchor.
    const widthUnits = pavilionWidth(tier);
    const widthPct = widthUnits / 680 * 100;
    // Sprite rendered height in scene-%:
    //   widthPct is % of scene width. Convert to scene height-% by accounting
    //   for the scene's pixel aspect (680/440) and the sprite's own aspect.
    const aspect = CONFIG.pavilionAspect[tier] || CONFIG.pavilionAspect.small;
    const heightPct = widthPct * aspect * (680 / 440);
    const cx = CONFIG.pavilionAnchor.cx_pct;
    const bottom = CONFIG.pavilionAnchor.bottom_pct;
    return {
      left: cx - widthPct / 2,
      top: bottom - heightPct,
      width: widthPct,
      height: heightPct
    };
  }

  function addAmbientMotion(groups, tiers) {
    const motion = sceneMotionMode();
    if (motion === 'off' || motion === 'reduced') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const season = sceneSeason();
    if (season === 'spring') addSpringPetals(tiers);
    else if (season === 'summer') addSummerFireflies(groups.firefly || []);
    else if (season === 'autumn') addAutumnMapleLeaves(groups.maple_leaf || []);
    else if (season === 'winter') addWinterSnowflakes(groups.snowflake || []);
  }

  function addSpringPetals(tiers) {
    if (tiers.cherry !== 'bloom' && tiers.cherry !== 'petal') return;
    const count = tiers.cherry === 'petal' ? 12 : 6;
    for (let i = 0; i < count; i++) {
      const petal = document.createElement('span');
      petal.className = 'pg6-petal';
      petal.style.setProperty('--petal-x', (18 + jitter(i, 21) * 22) + '%');
      petal.style.setProperty('--petal-y', (66 + jitter(i, 33) * 8) + '%');
      petal.style.setProperty('--petal-drift', ((jitter(i, 44) - 0.5) * 42) + 'px');
      petal.style.setProperty('--petal-duration', (7 + jitter(i, 55) * 5) + 's');
      petal.style.animationDelay = (-jitter(i, 66) * 9) + 's';
      scene.append(petal);
    }
  }

  function addAutumnMapleLeaves(sprites) {
    const count = 14;
    for (let i = 0; i < count; i++) {
      addSeasonParticle(pickParticleSprite(sprites, i), {
        className: 'maple',
        x: 4 + jitter(i, 14) * 94,
        y: -8 - jitter(i, 15) * 22,
        width: 11 + jitter(i, 16) * 8,
        drift: (-70 + jitter(i, 17) * 150) + 'px',
        duration: (11 + jitter(i, 18) * 9) + 's',
        delay: (-jitter(i, 19) * 18) + 's',
        z: 74 + i
      });
    }
  }

  function addSummerFireflies(sprites) {
    const timeMode = sceneTimeMode();
    if (timeMode !== 'dusk' && timeMode !== 'night') return;
    const count = timeMode === 'night' ? 14 : 9;
    for (let i = 0; i < count; i++) {
      addSeasonParticle(pickParticleSprite(sprites, i), {
        className: 'firefly',
        x: 8 + jitter(i, 31) * 84,
        y: 42 + jitter(i, 32) * 44,
        width: 4 + jitter(i, 33) * 3,
        drift: (-24 + jitter(i, 34) * 48) + 'px',
        lift: (-10 + jitter(i, 35) * 20) + 'px',
        duration: (3.5 + jitter(i, 36) * 3.5) + 's',
        delay: (-jitter(i, 37) * 7) + 's',
        z: 76 + i
      });
    }
  }

  function addWinterSnowflakes(sprites) {
    const count = 18;
    for (let i = 0; i < count; i++) {
      addSeasonParticle(pickParticleSprite(sprites, i), {
        className: 'snow',
        x: 2 + jitter(i, 51) * 96,
        y: -10 - jitter(i, 52) * 30,
        width: 7 + jitter(i, 53) * 7,
        drift: (-36 + jitter(i, 54) * 72) + 'px',
        duration: (13 + jitter(i, 55) * 11) + 's',
        delay: (-jitter(i, 56) * 20) + 's',
        z: 72 + i
      });
    }
  }

  function pickParticleSprite(sprites, index) {
    if (!sprites || !sprites.length) return null;
    return pick(sprites, index);
  }

  function addSeasonParticle(sprite, options) {
    const el = sprite ? document.createElement('img') : document.createElement('span');
    el.className = 'pg6-season-particle ' + options.className;
    if (sprite) {
      el.src = spriteRoot + sprite.file;
      el.alt = '';
      el.decoding = 'async';
      el.loading = 'eager';
      el.style.width = (options.width / 680 * 100) + '%';
    } else {
      el.style.setProperty('--particle-size', Math.max(3, Math.round(options.width)) + 'px');
    }
    el.style.left = options.x + '%';
    el.style.top = options.y + '%';
    el.style.zIndex = String(options.z || 70);
    el.style.setProperty('--particle-drift', options.drift || '0px');
    el.style.setProperty('--particle-lift', options.lift || '0px');
    el.style.setProperty('--particle-duration', options.duration || '10s');
    el.style.animationDelay = options.delay || '0s';
    scene.append(el);
  }

  function renderEmptyState() {
    const empty = document.createElement('div');
    empty.className = 'pg6-empty';
    empty.innerHTML =
      '<div class="pg6-empty-title">' + escapeHtml(t('empty.title')) + '</div>' +
      '<div class="pg6-empty-hint">' + escapeHtml(t('empty.hint')) + '</div>';
    scene.append(empty);
  }

  function updateInfoFromTrinket(trinket) {
    const translated = trinketLabel(trinket);
    const label = document.getElementById('garden-info-label');
    const title = document.getElementById('garden-info-name');
    const token = document.getElementById('garden-info-total');
    const stageEl = document.getElementById('garden-info-stage');
    const fill = document.getElementById('garden-info-fill');
    if (label) label.textContent = t('card.trinket.label');
    if (title) title.textContent = translated.name;
    if (token) token.textContent = translated.hint;
    if (stageEl) stageEl.textContent = t('card.threshold', { threshold: fmtLocal(trinket.threshold) });
    if (fill) fill.style.width = '100%';
    setInfoDetail('');
    setInfoSpark(null);
    showInfoCard();
  }

  // #D3 — info card adapter for the stone cat. Reuses the same fields the
  // project/trinket adapters write to, so hover transitions are smooth.
  function updateInfoFromCat(tiers) {
    const label = document.getElementById('garden-info-label');
    const title = document.getElementById('garden-info-name');
    const token = document.getElementById('garden-info-total');
    const stageEl = document.getElementById('garden-info-stage');
    const fill = document.getElementById('garden-info-fill');
    const isFull = tiers.stone_cat === 'full';
    const sessions = tiers.totalSessions || 0;
    if (label) label.textContent = t('card.cat.label');
    if (title) title.textContent = isFull ? t('card.cat.fullTitle') : t('card.cat.smallTitle');
    if (token) token.textContent = t('card.cat.sessions', { count: sessions });
    if (stageEl) stageEl.textContent = isFull ? t('card.cat.fullStage') : t('card.cat.smallStage');
    if (fill) fill.style.width = isFull ? '100%' : '40%';
    setInfoDetail('');
    setInfoSpark(null);
    showInfoCard();
  }

  function addIvyOverlay(groups, projects) {
    const hanging = groups.hanging_vine || [];
    const vertical = groups.vertical_vine || [];
    const leafCaps = groups.leaf_cluster || [];
    if (!hanging.length && !vertical.length) return;

    // Keep the order the strip uses (token desc). Chip #N then visually
    // aligns to the Nth project's primary vine from left to right. Slots are
    // generated from the actual project count so every project gets a slot
    // (and one or more session-driven strands) without reusing the old fixed
    // six slots.
    const ordered = projects;
    const maxTokens = Math.max(...ordered.map((project) => project.total_tokens || 0), 1);
    const maxRecent = Math.max(...ordered.map((project) => project.recent_activity || 0), 1);
    const sortedTokens = ordered
      .map((project) => project.total_tokens || 0)
      .filter(Boolean)
      .sort((a, b) => b - a);
    const entries = ordered.map((project, projectIndex) => {
      const profile = tokenSizeProfile(project, maxTokens, sortedTokens);
      const useHanging = profile.level >= 3 && hanging.length;
      return { project, projectIndex, profile, useHanging };
    });
    const hangingSlots = spreadSlots(entries.filter((entry) => entry.useHanging).length, 8, 92);
    const climbingSlots = spreadSlots(entries.filter((entry) => !entry.useHanging).length, 10, 90);
    let hangingIndex = 0;
    let climbingIndex = 0;
    const densityScale = ordered.length > 18 ? 0.66 : ordered.length > 12 ? 0.78 : ordered.length > 8 ? 0.88 : 1;
    const crownAnchors = [];

    // Anti-clutter cap on strands-per-project, tighter as the wall fills up.
    const strandCap = ordered.length > 28 ? 2 : ordered.length > 18 ? 3 : 4;
    const showFreshLeaves = leafCaps.length && ordered.length <= 28;

    entries.forEach(({ project, projectIndex, profile, useHanging }) => {
      const group = useHanging ? hanging : vertical;
      if (!group.length) return;

      const slot = useHanging
        ? hangingSlots[hangingIndex++]
        : climbingSlots[climbingIndex++];
      const baseWidth = Math.max(useHanging ? 24 : 13, profile.width * densityScale);
      const hue = vineHueShift(project);

      // Session count → number of independent strands (docs/sprite-rendering.md).
      // 1+floor(log2(sessions)): sessions 1→1, 2-3→2, 4-7→3, 8+→4 (capped).
      // 1-session projects stay single, so the common case is unchanged. Climbing
      // (sparse-wall) vines stay sparser than hanging.
      const sessions = Math.max(1, project.sessions || 1);
      let strandCount = Math.max(1, Math.min(strandCap, 1 + Math.floor(Math.log2(sessions))));
      if (!useHanging) strandCount = Math.min(strandCount, 3);

      // cache_ratio → "health" tint. 0 / absent ⇒ no vars ⇒ today's exact look,
      // because cache_ratio==0 is overwhelmingly "this source reported no cache
      // fields", not a genuinely cold cache (see docs/13 §2). Only >0 tints.
      const cacheRatio = project.cache_ratio || 0;
      const healthVars = cacheRatio > 0
        ? (() => {
            const health = Math.max(0, Math.min(1, (cacheRatio - 0.2) / 0.8));
            return {
              '--vine-health-sat': (1 + health * 0.5).toFixed(3),
              '--vine-health-bright': (1 + health * 0.10).toFixed(3)
            };
          })()
        : null;

      const spreadX = Math.min(2.2, 28 / Math.max(ordered.length, 1));

      for (let strandIndex = 0; strandIndex < strandCount; strandIndex++) {
        const isPrimary = strandIndex === 0;
        // Pick the frame by position (not pickByToken) so every variant in the
        // group is reachable and adjacent strands/projects differ; SIZE stays
        // token-driven via profile below.
        const sprite = pick(group, projectIndex + strandIndex);
        const x = slot + (isPrimary
          ? (jitter(projectIndex, profile.level) - 0.5) * spreadX
          : (jitter(projectIndex, strandIndex + 7) - 0.5) * 5);
        const y = useHanging
          ? 24.65 + jitter(projectIndex, strandIndex + 2) * 0.42
          : 52 + (5 - profile.level) * 4 + (isPrimary ? 0 : jitter(projectIndex, strandIndex + 3) * 3);
        const width = isPrimary ? baseWidth : baseWidth * 0.85;
        const opacity = isPrimary ? profile.opacity : profile.opacity * 0.82;

        // Only the primary strand is interactive: passing `project` makes
        // addSprite tag it `.roving-vine` + wire focus/hover/keyboard. Decorative
        // strands stay out of the roving/select model (pointer-events:none in CSS)
        // but still animate + tint. crownAnchors collects the primary only.
        if (isPrimary && useHanging) crownAnchors.push({ x, y, projectIndex, profile, hue });

        addSprite(sprite, {
          x,
          y,
          width,
          z: useHanging ? 22 + projectIndex : 18 + projectIndex,
          opacity,
          className: 'project ' + (useHanging ? 'hanging' : 'climbing') + (isPrimary ? '' : ' vine-decorative'),
          anchor: useHanging ? 'top' : 'bottom',
          healthVars,
          ...(isPrimary
            ? { project, projectIndex, title: project.display_name }
            : { hueShift: hue || undefined })
        });

        if (isPrimary && showFreshLeaves) {
          const recent = project.recent_activity || 0;
          const freshLeaves = Math.max(0, Math.min(3, Math.round((Math.log1p(recent) / Math.log1p(maxRecent)) * 3)));
          for (let leafIndex = 0; leafIndex < freshLeaves; leafIndex++) {
            addSprite(pick(leafCaps, projectIndex + leafIndex), {
              x: x + (jitter(projectIndex, leafIndex + 101) - 0.5) * 2.2,
              y: y + 1.4 + jitter(projectIndex, leafIndex + 113) * 1.1,
              width: 14 + jitter(projectIndex, leafIndex + 127) * 6,
              z: Math.min(58, Math.max(40 + leafIndex, 24 + projectIndex)),
              opacity: 0.62 + jitter(projectIndex, leafIndex + 139) * 0.16,
              className: 'vine-fresh-leaf',
              anchor: 'bottom',
              hueShift: hue || undefined
            });
          }
        }
      }
    });

    addVineCornice(leafCaps, crownAnchors);
  }

  function addVineCornice(leafCaps, anchors) {
    if (!leafCaps.length || !anchors.length) return;
    const minX = Math.max(4, Math.min(...anchors.map((item) => item.x)) - 4.2);
    const maxX = Math.min(96, Math.max(...anchors.map((item) => item.x)) + 4.2);
    // Smaller tiles → thinner cornice band that doesn't extend high above
    // the vine tops. Was 28/32, now 22/26.
    const tileWidth = anchors.length > 12 ? 22 : 26;
    const step = tileWidth / 680 * 100 * 0.74;
    const count = Math.max(1, Math.ceil((maxX - minX) / step) + 1);

    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0 : i / (count - 1);
      const x = minX + (maxX - minX) * t + (jitter(i, 41) - 0.5) * 0.7;
      // Bigger ridge amplitude (was ±0.6, now up to ±1.5) so the cornice's
      // bottom edge isn't a flat horizontal line — some tiles ride high,
      // some hang lower like overgrown ivy clumps.
      const ridge = Math.sin(t * Math.PI) * 1.05 + Math.sin(i * 1.37) * 0.5;
      // Random extra drop on some tiles — produces the "a few clumps hanging
      // lower" look that real ivy clusters have.
      const drop = jitter(i, 73) > 0.6 ? jitter(i, 91) * 1.2 : 0;
      addSprite(pick(leafCaps, i), {
        x,
        // y bumped from 25.18 → 25.4 so the tile's bottom sits ON the wall
        // edge cover band (top: 25%) instead of floating above it. + drop
        // pushes individual tiles down into the wall for a draped look.
        y: 25.4 - ridge + drop,
        width: tileWidth,
        z: 61 + i,
        // opacity bumped from 0.54..0.59 → 0.78..0.85 so the cornice has the
        // same visual density as the vines (which sit at 0.70).
        opacity: 0.78 + Math.sin(i * 0.9) * 0.07,
        className: 'vine-cornice',
        anchor: 'bottom'
      });
    }
  }

  function spreadSlots(count, min, max) {
    if (count <= 0) return [];
    if (count === 1) return [(min + max) / 2];
    const slots = [];
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const wave = Math.sin(i * 1.7) * Math.min(1.8, 16 / count);
      slots.push(min + (max - min) * t + wave);
    }
    return slots;
  }

  function tokenSizeLevel(tokens, maxTokens) {
    if (tokens <= 0) return 1;
    const minLog = 3;
    const maxLog = Math.max(minLog + 1, Math.log10(maxTokens + 1));
    const ratio = (Math.log10(tokens + 1) - minLog) / (maxLog - minLog);
    return Math.max(1, Math.min(5, Math.ceil(ratio * 5)));
  }

  // Fallback strength computation, identical to the core `size_strength` port
  // (crates/core/src/aggregate.rs). Used only when a summary lacks the
  // core-computed fields (older caches, browser fallback data).
  function tokenSizeStrength(tokens, maxTokens, sortedTokens) {
    const rank = Math.max(0, sortedTokens.findIndex((value) => value === tokens));
    const count = Math.max(1, sortedTokens.length);
    const rankStrength = 1 - rank / Math.max(1, count - 1);
    const logStrength = tokens > 0 && maxTokens > 0
      ? Math.max(0, Math.min(1, (Math.log10(tokens + 1) - 4) / (Math.log10(maxTokens + 1) - 4)))
      : 0;
    return Math.max(0, Math.min(1, logStrength * 0.68 + rankStrength * 0.32));
  }

  // Magnitude → vine size. Prefers the core-computed `size_level` /
  // `size_strength` (single source of truth); falls back to the identical local
  // formula when those fields are absent. The pixel width/opacity mapping is
  // presentation and deliberately stays in the frontend, not in core.
  function tokenSizeProfile(project, maxTokens, sortedTokens) {
    const tokens = project.total_tokens || 0;
    const hasCore = Number.isInteger(project.size_level) && project.size_level >= 1;
    const level = hasCore ? project.size_level : tokenSizeLevel(tokens, maxTokens);
    const strength = hasCore && Number.isFinite(project.size_strength)
      ? project.size_strength
      : tokenSizeStrength(tokens, maxTokens, sortedTokens);

    if (level >= 3) {
      return {
        level,
        width: 28 + strength * 78,
        opacity: 0.48 + strength * 0.28
      };
    }

    return {
      level,
      width: 14 + strength * 24,
      opacity: 0.44 + strength * 0.18
    };
  }



  function addWallEdgeCover() {
    const edge = document.createElement('div');
    edge.className = 'pg6-wall-edge-cover';
    scene.append(edge);
  }

  function addWallMarks(patches) {
    if (!patches.length) return;
    const marks = [
      [18, 49, 36], [56, 48, 32], [84, 57, 34], [36, 58, 30]
    ];
    marks.forEach(([x, y, width], i) => {
      addSprite(pick(patches, i), { x, y, width, z: 9, opacity: 0.22, className: 'mark' });
    });
  }

  function addGroundOverlay(groups) {
    const grasses = groups.grass_tuft || [];
    const rocks = groups.rock || [];
    const stones = groups.stone_base || [];
    if (stones.length) {
      [[17, 86, 48], [78, 86, 44], [42, 88, 34], [62, 90, 30]].forEach(([x, y, width], i) => {
        addSprite(pick(stones, i), { x, y, width, z: 12, opacity: 0.36, className: 'ground' });
      });
    }
    if (grasses.length) {
      [[8, 89, 50], [26, 88, 42], [63, 89, 44], [91, 89, 42]].forEach(([x, y, width], i) => {
        addSprite(pick(grasses, i), { x, y, width, z: 30, opacity: 0.58, className: 'ground' });
      });
    }
    if (rocks.length) {
      [[42, 92, 32], [73, 92, 30], [95, 93, 22]].forEach(([x, y, width], i) => {
        addSprite(pick(rocks, i), { x, y, width, z: 31, opacity: 0.54, className: 'ground' });
      });
    }
  }

  function addSprite(sprite, options) {
    const img = document.createElement('img');
    img.className = 'pg6-sprite' + (options.className ? ' ' + options.className : '');
    img.src = spriteRoot + sprite.file;
    img.alt = '';
    img.decoding = 'async';
    img.loading = 'eager';
    img.style.left = options.x + '%';
    img.style.top = options.y + '%';
    img.style.width = (options.width / 680 * 100) + '%';
    img.style.zIndex = String(options.z || 10);
    img.style.opacity = String(options.opacity ?? 1);
    if (options.anchor === 'bottom') {
      img.style.setProperty('--sprite-transform', 'translate(-50%, -100%)');
    } else {
      img.style.setProperty('--sprite-transform', 'translate(-50%, 0)');
    }
    if (options.title) img.title = options.title;
    if (options.hueShift) img.style.setProperty('--vine-hue-shift', options.hueShift);
    // cache_ratio "health" tint — set on every strand of a >0-cache project. The
    // CSS multipliers default to 1, so absence is a no-op (today's exact look).
    if (options.healthVars) {
      for (const [prop, val] of Object.entries(options.healthVars)) {
        img.style.setProperty(prop, val);
      }
    }
    if (options.project) {
      img.classList.add('roving-vine');
      img.dataset.projectIndex = String(options.projectIndex ?? 0);
      img.dataset.projectKey = options.project.project_key || '';
      // #D2 tint vine by primary source. codex-heavy projects skew blue-green,
      // claude-code-heavy stay default green, mixed lands in between.
      const hue = vineHueShift(options.project);
      if (hue) img.style.setProperty('--vine-hue-shift', hue);
      img.addEventListener('mouseenter', () => {
        setActiveProject(options.projectIndex ?? 0);
        updateInfoFromProject(options.project);
        // Anchor next to the vine (not under cursor). Cursor-follow used to
        // park the card inside the vine's leaf area where it got covered.
        positionInfoCardFromElement(img);
      });
      img.addEventListener('focus', () => {
        setActiveProject(options.projectIndex ?? 0);
        updateInfoFromProject(options.project);
        positionInfoCardFromElement(img);
      });
      img.addEventListener('mouseleave', () => {
        clearActiveProject();
        hideInfoCard();
      });
      img.addEventListener('blur', () => {
        clearActiveProject();
        hideInfoCard();
      });
      img.addEventListener('keydown', handleVineKey);
      // Roving tabindex: first vine is tab-stop; siblings reachable via arrows.
      img.tabIndex = scene.querySelector('.roving-vine') ? -1 : 0;
      // S1: one-shot grow-in for a project_key seen for the first time. Stagger
      // by strip order so a first-run reveal (everything new) cascades instead
      // of all vines popping at once. CSS gates the actual motion.
      if (newProjectKeys.has(options.project.project_key)) {
        img.classList.add('is-new');
        const order = Math.min(options.projectIndex ?? 0, 12);
        img.style.setProperty('--grow-delay', (order * 55) + 'ms');
      }
    }
    scene.append(img);
    return img;
  }

  function handleVineKey(event) {
    const dir = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    const jumpFirst = event.key === 'Home';
    const jumpLast  = event.key === 'End';
    if (!dir && !jumpFirst && !jumpLast) return;
    event.preventDefault();
    const vines = Array.from(scene.querySelectorAll('.roving-vine'))
      .sort((a, b) => parseFloat(a.style.left) - parseFloat(b.style.left));
    if (!vines.length) return;
    const cur = vines.indexOf(event.currentTarget);
    let next;
    if (jumpFirst) next = vines[0];
    else if (jumpLast) next = vines[vines.length - 1];
    else next = vines[(cur + dir + vines.length) % vines.length];
    vines.forEach((v) => (v.tabIndex = -1));
    next.tabIndex = 0;
    next.focus();
  }

  function updateInfoFromProject(project, options) {
    const reveal = !options || options.reveal !== false;
    const stage = Number(project.stage || 1);
    const name = project.display_name || t('card.project.defaultName');
    const total = project.total_tokens || 0;
    const label = document.getElementById('garden-info-label');
    const title = document.getElementById('garden-info-name');
    const token = document.getElementById('garden-info-total');
    const stageEl = document.getElementById('garden-info-stage');
    const fill = document.getElementById('garden-info-fill');
    if (label) label.textContent = t('card.project.label');
    if (title) title.textContent = name;
    if (token) token.textContent = t('card.total', { total: fmtLocal(total) });
    if (stageEl) stageEl.textContent = t('card.stage', { stage });
    if (fill) fill.style.width = Math.max(8, Math.min(100, stage / 6 * 100)) + '%';
    // Mini project profile: fields aggregate.rs already computes but the card
    // never showed. Each line omits itself when its value is zero/absent so a
    // sparse project keeps a clean card.
    setInfoDetail(buildInfoDetail(project));
    // Honest per-project 14-day token sparkline. Absent daily_tokens (older
    // caches / fallback data) degrades to a flat baseline, never an error.
    setInfoSpark(project.daily_tokens);
    if (reveal) {
      showInfoCard(options && options.event);
    }
  }

  // Build the compact detail block for a project card. Returns an HTML string
  // of `.pg6-info-meta` rows; empty string when nothing is worth showing.
  // Pure data → markup, omit-if-zero throughout.
  function buildInfoDetail(project) {
    const rows = [];
    const today = windowTotal(project.daily_tokens, 1);
    if (today > 0) rows.push(metaRow(t('card.today'), fmtLocal(today)));

    // cache_ratio is a 0..1 float (share of input served from cache).
    const cacheRatio = Number(project.cache_ratio || 0);
    if (cacheRatio > 0) rows.push(metaRow(t('card.cacheHit'), Math.round(cacheRatio * 100) + '%'));

    // Sessions and tool calls share one row to keep the card short.
    const sessions = Number(project.sessions || 0);
    const tools = Number(project.tool_calls || 0);
    if (sessions > 0 || tools > 0) {
      const parts = [];
      if (sessions > 0) parts.push(t('card.sessionsShort', { count: sessions }));
      if (tools > 0) parts.push(t('card.toolsShort', { count: fmtLocal(tools) }));
      rows.push(metaRow(t('card.activity'), parts.join(' · ')));
    }

    const model = topModel(project.models);
    if (model) rows.push(metaRow(t('card.topModel'), model));

    // Multi-source projects: show the split so the vine's hue tint is explained
    // and same-named dirs from different tools are distinguishable.
    const sources = sourceSummary(project.sources);
    if (sources) rows.push(metaRow(t('card.sources'), sources));

    const ago = relativeAgo(project.last_seen);
    if (ago) rows.push(metaRow(t('card.lastActive'), ago));

    return rows.join('');
  }

  function metaRow(label, value) {
    return (
      '<div class="pg6-info-meta">' +
      '<span class="pg6-info-meta-k">' + escapeHtml(label) + '</span>' +
      '<span class="pg6-info-meta-v">' + escapeHtml(value) + '</span>' +
      '</div>'
    );
  }

  // Most-used model by event count (models is model -> count). Trims the long
  // "[1m]" context-window suffix so it fits the narrow card.
  function topModel(models) {
    if (!models || typeof models !== 'object') return '';
    let best = null;
    let bestCount = -1;
    for (const [name, count] of Object.entries(models)) {
      const n = Number(count || 0);
      if (n > bestCount) {
        bestCount = n;
        best = name;
      }
    }
    return best ? String(best).replace(/\[[^\]]*\]\s*$/, '').trim() : '';
  }

  // "Claude Code 18 · Codex 4" — only when more than one source contributed.
  function sourceSummary(sources) {
    if (!sources || typeof sources !== 'object') return '';
    const entries = Object.entries(sources).filter(([, c]) => Number(c || 0) > 0);
    if (entries.length < 2) return '';
    // Brand names stay as-is across locales; only the generic "manual" source
    // is translated.
    const pretty = { 'claude-code': 'Claude Code', 'claude-cowork': 'Cowork', codex: 'Codex', 'manual-jsonl': t('source.manual') };
    return entries
      .sort((a, b) => Number(b[1]) - Number(a[1]))
      .map(([name, count]) => (pretty[name] || name) + ' ' + fmtLocal(Number(count)))
      .join(' · ');
  }

  // Humanize an ISO timestamp into a short relative string, reusing the footer
  // freshness pill's i18n keys (fresh.*). Returns '' for missing/invalid input.
  function relativeAgo(stamp) {
    if (!stamp) return '';
    const ms = new Date(stamp).getTime();
    if (!Number.isFinite(ms)) return '';
    const diff = Date.now() - ms;
    if (diff < 0) return t('fresh.justNow');
    const mins = Math.round(diff / 60_000);
    const hours = Math.round(diff / 3_600_000);
    const days = Math.round(diff / 86_400_000);
    if (mins < 1) return t('fresh.justNow');
    if (mins < 60) return t('fresh.minutesAgo', { count: mins });
    if (hours < 24) return t('fresh.hoursAgo', { count: hours });
    if (days < 30) return t('fresh.daysAgo', { count: days });
    return t('fresh.monthPlusAgo');
  }

  function setInfoDetail(html) {
    const el = document.getElementById('garden-info-detail');
    if (el) el.innerHTML = html || '';
  }

  // Inject or clear the info-card sparkline. Pass a daily_tokens map to show a
  // series; pass null/undefined to clear it (trinket / cat cards have no token
  // history). Rendering is delegated to the pure render-insight module.
  function setInfoSpark(dailyTokens) {
    const spark = document.getElementById('garden-info-spark');
    if (!spark) return;
    if (!dailyTokens) {
      spark.innerHTML = '';
      return;
    }
    spark.innerHTML = sparklineSVG(dailyTokens, { days: 14, format: fmtLocal });
  }

  function showInfoCard(event) {
    const card = document.querySelector('.pg6-info');
    if (!card) return;
    if (event) positionInfoCard(event);
    card.classList.add('is-visible');
  }

  function positionInfoCard(event) {
    const card = document.querySelector('.pg6-info');
    if (!card || !event) return;
    const rect = scene.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const gap = 14;
    const pad = 10;
    let x = event.clientX - rect.left + gap;
    let y = event.clientY - rect.top - cardRect.height / 2;

    if (x + cardRect.width > rect.width - pad) {
      x = event.clientX - rect.left - cardRect.width - gap;
    }
    x = Math.max(pad, Math.min(rect.width - cardRect.width - pad, x));
    y = Math.max(pad, Math.min(rect.height - cardRect.height - pad, y));

    card.style.setProperty('--info-x', x + 'px');
    card.style.setProperty('--info-y', y + 'px');
    card.style.setProperty('--info-bottom', 'auto');
  }

  // Position the card NEXT TO a DOM element (vs. next to the cursor).
  // Used by: keyboard focus, Insight project selection, trinket hover,
  // cat hover. If the anchor is outside the scene, we pin the card to the
  // scene's top and pick a side based on the anchor's horizontal position.
  function positionInfoCardFromElement(anchor) {
    const card = document.querySelector('.pg6-info');
    if (!card || !anchor) return;
    const sceneRect = scene.getBoundingClientRect();
    const a = anchor.getBoundingClientRect();
    const cardW = card.offsetWidth || 200;
    const cardH = card.offsetHeight || 100;
    const gap = 14;
    const pad = 10;

    const aCx = a.left + a.width / 2 - sceneRect.left;
    // Side: put card on the side with more room
    let x = aCx < sceneRect.width / 2
      ? (a.right - sceneRect.left) + gap
      : (a.left - sceneRect.left) - cardW - gap;
    x = Math.max(pad, Math.min(sceneRect.width - cardW - pad, x));

    let y;
    const aTop = a.top - sceneRect.top;
    const aBottom = a.bottom - sceneRect.top;
    if (aBottom < 0 || aTop > sceneRect.height) {
      // Anchor is fully outside scene vertically (chip case): pin near top.
      y = pad;
    } else {
      // Align card vertically with the anchor's center.
      y = (aTop + aBottom) / 2 - cardH / 2;
    }
    y = Math.max(pad, Math.min(sceneRect.height - cardH - pad, y));

    card.style.setProperty('--info-x', x + 'px');
    card.style.setProperty('--info-y', y + 'px');
    card.style.setProperty('--info-bottom', 'auto');
  }

  function hideInfoCard() {
    // Remove .is-visible — CSS transition handles the fade-out.
    // If the user immediately enters another vine, updateInfoFromProject
    // re-adds the class mid-fade and the transition reverses smoothly.
    const card = document.querySelector('.pg6-info');
    if (card) card.classList.remove('is-visible');
  }

  function setActiveProject(index) {
    document.querySelectorAll('.roving-vine').forEach((el) => {
      el.classList.toggle('is-active', el.dataset.projectIndex === String(index));
    });
  }

  function clearActiveProject() {
    document.querySelectorAll('.roving-vine').forEach((el) => {
      el.classList.remove('is-active');
    });
  }

  function selectProjectByKey(projectKey) {
    const index = currentWallProjects.findIndex((project) => project.project_key === projectKey);
    if (index < 0) return false;
    const project = currentWallProjects[index];
    const vine = scene.querySelector('.roving-vine[data-project-index="' + index + '"]');
    setActiveProject(index);
    updateInfoFromProject(project);
    positionInfoCardFromElement(vine);
    if (vine) {
      document.querySelectorAll('.roving-vine').forEach((item) => { item.tabIndex = -1; });
      vine.tabIndex = 0;
      vine.focus({ preventScroll: true });
    }
    return true;
  }



  function updateDefaultInfo(summary, projects) {
    // Pre-fill the info card content but do NOT make it visible — the card
    // only appears once the user hovers or focuses a project vine.
    const project = projects[0];
    if (project) updateInfoFromProject(project, { reveal: false });
    const app = document.querySelector('.pg6-app');
    const total = summary ? summary.total_tokens : projects.reduce((sum, item) => sum + (item.total_tokens || 0), 0);
    if (app) app.textContent = t('app.tokens', { total: fmtLocal(total) });
  }

  function trinketLabel(trinket) {
    return {
      name: t('trinket.' + trinket.id + '.name'),
      hint: t('trinket.' + trinket.id + '.hint')
    };
  }

function sceneTimeMode() {
  return scene?.dataset?.timeMode || 'day';
}

function sceneSeason() {
  return scene?.dataset?.season || 'spring';
}

function sceneMotionMode() {
  return scene?.dataset?.motion || 'system';
}
