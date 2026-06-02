import { CONFIG } from './scene-config.js';
import { fmtLocal, escapeHtml, pick, pickByToken, namedSprite, jitter } from './render-helpers.js';
import { sparklineSVG } from './render-insight.js';

let scene;
let spriteRoot;
let currentWallProjects = [];
const dynamicLayerSelector = [
  '.pg6-sprite',
  '.pg6-wall-edge-cover',
  '.pg6-petal',
  '.pg6-season-particle',
  '.pg6-empty'
].join(', ');

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

export function createGardenRenderer(options) {
  scene = options.scene;
  spriteRoot = options.spriteRoot;
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
  renderProjectStrip(wallProjects);
  addIvyOverlay(groups, wallProjects);
  addWallEdgeCover();
  addWallMarks(groups.plaster_patch || []);
  addGroundOverlay(groups);
  addCourtyardObjects(groups, tiers);
  addPavilionTrinkets(tiers.pavilion, tiers.pavilionTrinkets);
  addAmbientMotion(groups, tiers);
  if (!projects.length) renderEmptyState();
}

function showScanning() {
  const el = document.getElementById('data-freshness');
  if (!el) return;
  el.textContent = '· 正在扫描...';
  el.classList.remove('is-stale', 'is-paused');
  el.classList.add('is-scanning');
  el.title = '正在读取本机 agent 数据';
}

function showCached(summary) {
  updateDataFreshness(summary);
  const el = document.getElementById('data-freshness');
  if (!el) return;
  el.textContent = '· 已扫描 · 自动刷新已关闭';
  el.classList.remove('is-scanning', 'is-stale');
  el.classList.add('is-paused');
  el.title = '缓存已更新，打开自动刷新或手动切换视图后会重绘花园';
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
    if (mins < 1)      label = '刚刚';
    else if (mins < 60) label = mins + ' 分钟前';
    else if (hours < 24) label = hours + ' 小时前';
    else if (days < 30)  label = days + ' 天前';
    else                 label = '一个月以上之前';
    el.textContent = '· 更新于 ' + label;
    el.classList.remove('is-scanning', 'is-paused');
    if (diff > 24 * 3_600_000) {
      el.classList.add('is-stale');
      el.title = '运行 agent-garden scan 刷新';
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
    [104, '小寒'], [120, '大寒'], [204, '立春'], [219, '雨水'],
    [305, '惊蛰'], [320, '春分'], [404, '清明'], [420, '谷雨'],
    [505, '立夏'], [521, '小满'], [605, '芒种'], [621, '夏至'],
    [707, '小暑'], [722, '大暑'], [807, '立秋'], [823, '处暑'],
    [907, '白露'], [923, '秋分'], [1008, '寒露'], [1023, '霜降'],
    [1107, '立冬'], [1122, '小雪'], [1207, '大雪'], [1222, '冬至']
  ];
  function currentSolarTerm(d) {
    const md = (d.getMonth() + 1) * 100 + d.getDate();
    let term = '冬至';   // wrap-around for early Jan before 小寒
    for (const [cut, t] of TERMS_24) if (md >= cut) term = t;
    return term;
  }
  function updateHeaderMeta() {
    const now = new Date();
    const season = document.getElementById('meta-season');
    const time = document.getElementById('meta-time');
    if (season) season.textContent = sceneLabel('seasonLabel', '春') + ' · ' + currentSolarTerm(now);
    if (time) {
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      time.textContent = sceneLabel('timeLabel', '白日') + ' · ' + hh + ':' + mm;
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
    const stools = groups.stone_stool || [];
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
      // back row (taller, slightly farther left)
      addSprite(back,  { x:  6.5, y: 90.0, width: 58, z: 23, opacity: 0.95, className: 'object', anchor: 'bottom' });
      // mid row (fuller, anchors the grove)
      addSprite(mid,   { x: 12.5, y: 91.2, width: 68, z: 26, opacity: 0.97, className: 'object', anchor: 'bottom' });
      // foreground accent (smaller, in front for depth)
      addSprite(front, { x:  3.5, y: 92.4, width: 40, z: 29, opacity: 1.0,  className: 'object', anchor: 'bottom' });
    }
    if (cherries.length) {
      // Cherry is one of two visual anchors (with the pavilion). Sized to
      // roughly 60% of the pavilion full width so it reads as a peer object,
      // not a small accent.
      const sprite = namedSprite(cherries, tiers.cherry === 'bud' ? 'cherry_tree_bud' : 'cherry_tree_bloom') || pickByToken(cherries, 5);
      addSprite(sprite, {
        x: 23,
        y: 91.4,
        width: tiers.cherry === 'bud' ? 78 : 100,
        z: 22,
        opacity: 0.98,
        className: 'object decor-cherry',
        anchor: 'bottom'
      });
    }
    if (willows.length) {
      // Willow scales to ~75% of pavilion when mature — it should feel like
      // the biggest tree in the courtyard.
      const sprite = namedSprite(willows, tiers.willow === 'mature' ? 'willow_mature' : 'willow_young') || pickByToken(willows, tiers.willow === 'mature' ? 5 : 2);
      addSprite(sprite, {
        x: 48,
        y: 90.9,
        width: tiers.willow === 'mature' ? 125 : 95,
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
        width: wantFull ? 58 : 46,
        z: 24,
        opacity: 1.0,
        className: 'object cat-interactive',
        anchor: 'bottom'
      });
      // #D3 — cat hover/focus reveals "guardian" info card
      if (catImg) {
        catImg.tabIndex = 0;
        catImg.setAttribute('role', 'img');
        catImg.setAttribute('aria-label', '石猫 · 镇园守护');
        catImg.title = '石猫 · 镇园守护';
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
      addSprite(sprite, {
        x: 60,
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
      const wantFull = tiers.stone_cat === 'full';
      const sprite = namedSprite(cairns, wantFull ? 'stone_cairn_full' : 'stone_cairn_small')
                  || pickByToken(cairns, wantFull ? 5 : 2);
      addSprite(sprite, {
        x: 68,
        y: 92,
        width: wantFull ? 42 : 32,
        z: 25,
        opacity: 1.0,
        className: 'object',
        anchor: 'bottom'
      });
    }
    if (pathStones.length) {
      // Path stones intentionally stay on the .ground class — they're worn
      // and should recede rather than read as a foreground prop.
      addSprite(pathStones[0], {
        x: 55,
        y: 95.4,
        width: 168,
        z: 26,
        opacity: 0.62,
        className: 'ground',
        anchor: 'bottom'
      });
    }
    if (pavilions.length) {
      const pavilionIndex = { small: 1, mid: 3, full: 5 }[tiers.pavilion] || 1;
      const sprite = pickByToken(pavilions, pavilionIndex);
      addSprite(sprite, {
        x: 82.5,
        y: 90.5,
        width: pavilionWidth(tiers.pavilion),
        z: 24,
        opacity: 1.0,
        className: 'object',
        anchor: 'bottom'
      });
    }
    // Stool + cushion now live INSIDE the pavilion, centered on the floor
    // of its interior. Positions are derived from pavilionInteriorPoint so
    // they follow the pavilion tier (small/mid/full) automatically.
    // z = 25/26 places them in front of the pavilion sprite so they peek
    // through the open columns at the front.
    if (tiers.stool === 'visible' && stools.length) {
      const p = pavilionInteriorPoint(tiers.pavilion, 50, 96);
      addSprite(stools[0], {
        x: p.x,
        y: p.y,
        width: 26,
        z: 25,
        opacity: 1.0,
        className: 'object',
        anchor: 'bottom'
      });
    }
    if (tiers.cushion === 'visible' && cushions.length) {
      // Stack cushion on top of stool: stool height in scene-% ≈
      // (26 / 680) × (71 / 83) × (680 / 440) × 100 ≈ 5.05
      const stoolHeightPct = (26 / 680) * (71 / 83) * (680 / 440) * 100;
      const p = pavilionInteriorPoint(tiers.pavilion, 50, 96);
      addSprite(cushions[0], {
        x: p.x,
        y: p.y - stoolHeightPct,
        width: 18,
        z: 26,
        opacity: 1.0,
        className: 'object',
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
      .filter((t) => maxProjectTokens >= t.threshold)
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
  function addPavilionTrinkets(pavilionTier, unlockedIds) {
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
      const xPct = intLeft + (tk.slot.x / 100) * intWidth;
      const yPct = intTop  + (tk.slot.y / 100) * intHeight;
      if (tk.file) addTrinketSprite(tk, xPct, yPct, tk.w, idx);
    });
  }

  function addTrinketSprite(trinket, xPct, yPct, wUnits, idx) {
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
    img.style.setProperty('--sprite-transform', 'translate(-50%, -50%)');
    img.tabIndex = 0;
    img.title = trinket.name + ' · ' + trinket.hint;
    img.setAttribute('aria-label', trinket.name + ', ' + trinket.hint);
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
      '<div class="pg6-empty-title">还没有本地 agent 记录</div>' +
      '<div class="pg6-empty-code">agent-garden scan</div>';
    scene.append(empty);
  }

  function updateInfoFromTrinket(trinket) {
    const label = document.getElementById('garden-info-label');
    const title = document.getElementById('garden-info-name');
    const token = document.getElementById('garden-info-total');
    const stageEl = document.getElementById('garden-info-stage');
    const fill = document.getElementById('garden-info-fill');
    if (label) label.textContent = '亭子陈列';
    if (title) title.textContent = trinket.name;
    if (token) token.textContent = trinket.hint;
    if (stageEl) stageEl.textContent = '阈值 ' + fmtLocal(trinket.threshold);
    if (fill) fill.style.width = '100%';
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
    if (label) label.textContent = '石猫 · 镇园守护';
    if (title) title.textContent = isFull ? '坐镇 · 戴铃' : '坐镇';
    if (token) token.textContent = '累计 ' + sessions + ' 次会话';
    if (stageEl) stageEl.textContent = isFull ? '满级' : '初阶';
    if (fill) fill.style.width = isFull ? '100%' : '40%';
    setInfoSpark(null);
    showInfoCard();
  }

  function addIvyOverlay(groups, projects) {
    const hanging = groups.hanging_vine || [];
    const vertical = groups.vertical_vine || [];
    const leafCaps = groups.leaf_cluster || [];
    if (!hanging.length && !vertical.length) return;

    // Keep the order the strip uses (token desc). Chip #N then visually
    // aligns to the Nth vine from left to right. Slots are generated from the
    // actual project count so every project gets one vine without reusing the
    // old fixed six slots.
    const ordered = projects;
    const maxTokens = Math.max(...ordered.map((project) => project.total_tokens || 0), 1);
    const sortedTokens = ordered
      .map((project) => project.total_tokens || 0)
      .filter(Boolean)
      .sort((a, b) => b - a);
    const entries = ordered.map((project, projectIndex) => {
      const profile = tokenSizeProfile(project.total_tokens || 0, maxTokens, sortedTokens);
      const useHanging = profile.level >= 3 && hanging.length;
      return { project, projectIndex, profile, useHanging };
    });
    const hangingSlots = spreadSlots(entries.filter((entry) => entry.useHanging).length, 8, 92);
    const climbingSlots = spreadSlots(entries.filter((entry) => !entry.useHanging).length, 10, 90);
    let hangingIndex = 0;
    let climbingIndex = 0;
    const densityScale = ordered.length > 18 ? 0.66 : ordered.length > 12 ? 0.78 : ordered.length > 8 ? 0.88 : 1;
    const crownAnchors = [];

    entries.forEach(({ project, projectIndex, profile, useHanging }) => {
      const group = useHanging ? hanging : vertical;
      if (!group.length) return;

      const slot = useHanging
        ? hangingSlots[hangingIndex++]
        : climbingSlots[climbingIndex++];
      const sprite = pickByToken(group, profile.level);
      const width = Math.max(useHanging ? 24 : 13, profile.width * densityScale);

      const x = slot + (jitter(projectIndex, profile.level) - 0.5) * Math.min(2.2, 28 / Math.max(ordered.length, 1));
      const y = useHanging ? 24.65 + jitter(projectIndex, 2) * 0.42 : 52 + (5 - profile.level) * 4;
      const hue = vineHueShift(project);
      if (useHanging) crownAnchors.push({ x, y, projectIndex, profile, hue });

      addSprite(sprite, {
        x,
        y,
        width,
        z: useHanging ? 22 + projectIndex : 18 + projectIndex,
        opacity: profile.opacity,
        className: 'project ' + (useHanging ? 'hanging' : 'climbing'),
        anchor: useHanging ? 'top' : 'bottom',
        project,
        projectIndex,
        title: project.display_name
      });

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

  function tokenSizeProfile(tokens, maxTokens, sortedTokens) {
    const level = tokenSizeLevel(tokens, maxTokens);
    const rank = Math.max(0, sortedTokens.findIndex((value) => value === tokens));
    const count = Math.max(1, sortedTokens.length);
    const rankStrength = 1 - rank / Math.max(1, count - 1);
    const logStrength = tokens > 0 && maxTokens > 0
      ? Math.max(0, Math.min(1, (Math.log10(tokens + 1) - 4) / (Math.log10(maxTokens + 1) - 4)))
      : 0;
    const strength = Math.max(0, Math.min(1, logStrength * 0.68 + rankStrength * 0.32));

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
      [18, 49, 36], [56, 48, 32], [84, 57, 34]
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
      [[17, 86, 48], [78, 86, 44]].forEach(([x, y, width], i) => {
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
    const name = project.display_name || '本地智能体花园';
    const total = project.total_tokens || 0;
    const label = document.getElementById('garden-info-label');
    const title = document.getElementById('garden-info-name');
    const token = document.getElementById('garden-info-total');
    const stageEl = document.getElementById('garden-info-stage');
    const fill = document.getElementById('garden-info-fill');
    if (label) label.textContent = '项目藤 · 当前选中';
    if (title) title.textContent = name;
    if (token) token.textContent = '累计 ' + fmtLocal(total);
    if (stageEl) stageEl.textContent = '阶段 ' + stage + ' / 6';
    if (fill) fill.style.width = Math.max(8, Math.min(100, stage / 6 * 100)) + '%';
    // Honest per-project 14-day token sparkline. Absent daily_tokens (older
    // caches / fallback data) degrades to a flat baseline, never an error.
    setInfoSpark(project.daily_tokens);
    if (reveal) {
      showInfoCard(options && options.event);
    }
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
  // Used by: keyboard focus, chip hover (anchors to the corresponding vine),
  // trinket hover, cat hover. If the anchor is outside the scene (e.g. a
  // chip below it), we pin the card to the scene's top and pick a side based
  // on the anchor's horizontal position.
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
    document.querySelectorAll('.roving-vine, .pg6-project-chip').forEach((el) => {
      el.classList.toggle('is-active', el.dataset.projectIndex === String(index));
    });
  }

  function clearActiveProject() {
    document.querySelectorAll('.roving-vine, .pg6-project-chip').forEach((el) => {
      el.classList.remove('is-active');
    });
  }

  function selectProjectByKey(projectKey) {
    const index = currentWallProjects.findIndex((project) => project.project_key === projectKey);
    if (index < 0) return false;
    const project = currentWallProjects[index];
    const vine = scene.querySelector('.roving-vine[data-project-index="' + index + '"]');
    const chip = document.querySelector('.pg6-project-chip[data-project-index="' + index + '"]');
    setActiveProject(index);
    updateInfoFromProject(project);
    positionInfoCardFromElement(vine || chip);
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
    if (app) app.textContent = '像素花园 · ' + fmtLocal(total) + ' local tokens';
  }

  function renderProjectStrip(projects) {
    const strip = document.getElementById('project-strip');
    if (!strip) return;
    if (!projects.length) {
      strip.innerHTML = '';
      return;
    }
    strip.innerHTML = projects.map((project, index) => {
      return '<button class="pg6-project-chip" type="button" data-project-index="' + index + '" data-project-key="' + escapeHtml(project.project_key || '') + '"><span>' + (index + 1) + '</span><strong>' + escapeHtml(project.display_name || 'unknown') + '</strong><span>' + fmtLocal(project.total_tokens || 0) + '</span></button>';
    }).join('');
    strip.querySelectorAll('.pg6-project-chip').forEach((chip, index) => {
      const project = projects[index];
      // Chip hover/focus anchors the info card to the corresponding vine on
      // the wall — the chip itself lives below the scene, so cursor-based
      // positioning would push the card out of bounds.
      const anchorToVine = () => {
        setActiveProject(index);
        updateInfoFromProject(project);
        const vine = scene.querySelector('.roving-vine[data-project-index="' + index + '"]');
        positionInfoCardFromElement(vine || chip);
      };
      chip.addEventListener('mouseenter', anchorToVine);
      chip.addEventListener('focus', anchorToVine);
      chip.addEventListener('mouseleave', () => {
        clearActiveProject();
        hideInfoCard();
      });
      chip.addEventListener('blur', () => {
        clearActiveProject();
        hideInfoCard();
      });
    });
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
