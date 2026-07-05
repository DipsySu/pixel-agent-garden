import { CONFIG } from '../scene-config.js';
import { fmtLocal, escapeHtml, pick, jitter } from '../render-helpers.js';
import { sparklineSVG, windowTotal } from '../render-insight.js';
import { t } from '../i18n.js';
import { isoToScreen, renderIsometricBase, wallSlotToScreen } from './isometric-base.js';

const W = 680;
const H = 440;
const dynamicSelector = '.pg6-iso-dynamic, .pg6-empty';
// v2 sprite set (style harmonization pass): detailed painterly pixel art
// matching the original design mockup + the classic wall view, generated at
// ≥2× render width so nothing upscales (the v1 64px set rendered blurry at
// 104-158px). Tiered objects now carry one file PER TIER — the voxel v1 set
// reused one file and only scaled, which hid the growth semantics.
const ISO_ASSETS = {
  bamboo: { file: 'isometric_generated/bamboo_iso_v2.png' },
  cherry: {
    bud: { file: 'isometric_generated/cherry_iso_v2_bud.png' },
    bloom: { file: 'isometric_generated/cherry_iso_v2_bloom.png' },
    petal: { file: 'isometric_generated/cherry_iso_v2_petal.png' },
  },
  // "calm" = koi-less water; the koi swim as live DOM sprites (addPondKoi)
  koiPond: { file: 'isometric_generated/koi_pond_iso_v2_calm.png' },
  // 4-frame PixelLab swim cycle (tail swish). v3 replaced the earlier bulky
  // curved-tail fish with a slimmer koi and a relaxed straight tail.
  koiFrames: [
    'isometric_generated/koi_iso_v3_f0.png',
    'isometric_generated/koi_iso_v3_f1.png',
    'isometric_generated/koi_iso_v3_f2.png',
    'isometric_generated/koi_iso_v3_f3.png',
  ],
  pavilion: {
    small: { file: 'isometric_generated/pavilion_iso_v2_small.png' },
    mid: { file: 'isometric_generated/pavilion_iso_v2_mid.png' },
    full: { file: 'isometric_generated/pavilion_iso_v2_full.png' },
  },
  stoneCat: {
    small: { file: 'isometric_generated/stone_cat_iso_v2_small.png' },
    full: { file: 'isometric_generated/stone_cat_iso_v2_full.png' },
  },
  stoneLantern: {
    unlit: { file: 'isometric_generated/stone_lantern_iso_v2_unlit.png' },
    lit: { file: 'isometric_generated/stone_lantern_iso_v2_lit.png' },
  },
  willow: {
    young: { file: 'isometric_generated/willow_iso_v2_young.png' },
    mature: { file: 'isometric_generated/willow_iso_v2_mature.png' },
  },
};

export function createIsometricRenderer(options) {
  let currentProjects = [];

  function renderBase(settings) {
    renderIsometricBase(options.scene, options.assetRoot, { settings });
  }

  function renderDynamic(groups, summary) {
    const projects = projectsForGarden(summary?.projects || []);
    const tiers = unlockTier(summary, projects);
    currentProjects = projects;
    clearDynamic(options.scene);
    updateHeaderMeta(options.scene, summary);
    updateDataFreshness(summary);
    updateDefaultInfo(summary, projects);
    addProjectVines(options.scene, options.spriteRoot, groups, projects);
    addCourtyardObjects(options.scene, options.spriteRoot, groups, tiers);
    addIsoGardenCat(options.scene, options.spriteRoot, groups, tiers);
    addIsoSeasonParticles(options.scene, options.spriteRoot, groups, tiers);
    if (!projects.length) renderEmptyState(options.scene);
  }

  function paint(groups, summary, settings) {
    renderBase(settings);
    renderDynamic(groups, summary);
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

  function selectProjectByKey(projectKey) {
    const index = currentProjects.findIndex((project) => project.project_key === projectKey);
    if (index < 0) return false;
    const vine = options.scene.querySelector('.roving-vine[data-project-index="' + index + '"]');
    setActiveProject(index);
    updateInfoFromProject(currentProjects[index]);
    positionInfoCardFromElement(options.scene, vine);
    if (vine) {
      options.scene.querySelectorAll('.roving-vine').forEach((item) => { item.tabIndex = -1; });
      vine.tabIndex = 0;
      vine.focus({ preventScroll: true });
    }
    return true;
  }

  function destroy() {
    stopIsoCat(options.scene);   // the wander rAF must not outlive the renderer
    if (isoKoiStop) { isoKoiStop(); isoKoiStop = null; }   // nor the koi swim loop
    clearDynamic(options.scene);
    currentProjects = [];
  }

  return {
    mode: 'isometric',
    renderBase,
    renderDynamic,
    paint,
    repaintData: renderDynamic,
    showScanning,
    showCached,
    selectProjectByKey,
    destroy,
  };
}

function addProjectVines(scene, spriteRoot, groups, projects) {
  const hanging = groups.hanging_vine || [];
  const vertical = groups.vertical_vine || [];
  const leaves = groups.leaf_cluster || [];
  const vines = hanging.length ? hanging : vertical;
  if (!vines.length || !projects.length) return;

  const maxTokens = Math.max(...projects.map((project) => project.total_tokens || 0), 1);
  const sortedTokens = projects
    .map((project) => project.total_tokens || 0)
    .filter(Boolean)
    .sort((a, b) => b - a);
  // 0.04-0.96 let the end slots crest OVER the walls' outer corners (the vine
  // foliage spilled past the island silhouette and read as a sticker). Keep
  // the whole run on the wall faces proper.
  const slots = spreadSlots(projects.length, 0.10, 0.90);
  const densityScale = projects.length > 50 ? 0.46 : projects.length > 32 ? 0.54 : projects.length > 20 ? 0.64 : 0.76;
  const capLimit = projects.length > 32 ? 8 : projects.length > 20 ? 12 : projects.length;

  projects.forEach((project, projectIndex) => {
    const profile = tokenSizeProfile(project, maxTokens, sortedTokens);
    const top = wallSlotToScreen(slots[projectIndex]);
    const sprite = pick(vines, projectIndex + profile.level);
    const sideTilt = top.side === 'left' ? -3 : 3;
    const img = addSprite(scene, spriteRoot, sprite, {
      x: top.x + (jitter(projectIndex, 3) - 0.5) * 10,
      // +5 (was +2): start the crest BELOW the wall's cap rim so the cap stays
      // visible above the foliage — vines cresting over the rim was the main
      // "pasted on" tell. Jitter tightened so no strand climbs back onto it.
      y: top.y + 5 + jitter(projectIndex, 5) * 6,
      width: Math.max(12, profile.width * densityScale),
      z: 380 - projectIndex,
      opacity: Math.min(0.78, profile.opacity + 0.06),
      anchor: 'top',
      className: 'project hanging pg6-iso-vine',
      project,
      projectIndex,
      title: project.display_name,
    });
    if (img) {
      img.style.setProperty('--iso-vine-tilt', sideTilt + 'deg');
      wireProjectInteractions(scene, img, project, projectIndex);
    }

    if (leaves.length && profile.level >= 4 && projectIndex < capLimit) {
      addSprite(scene, spriteRoot, pick(leaves, projectIndex), {
        x: top.x,
        y: top.y + 2,
        width: 18 + profile.level * 2,
        z: 400 - projectIndex,
        opacity: 0.82,
        anchor: 'bottom',
        className: 'vine-cornice pg6-iso-dynamic',
        hueShift: vineHueShift(project),
      });
    }
  });
}

function addCourtyardObjects(scene, spriteRoot, groups, tiers) {
  void groups;

  // Pond pulled out of the cherry/bamboo cluster (its rim sat under the cherry
  // canopy at 0.24,0.72) toward the open front-left lawn. The sprite is now the
  // koi-less "calm" variant; the koi are LIVE — two DOM sprites driven by a
  // heading-first swim loop (see pg6-iso-koi in index.html, motion-gated).
  const pondSeat = { u: 0.33, v: 0.75 };
  addFloorSprite(scene, spriteRoot, ISO_ASSETS.koiPond, pondSeat.u, pondSeat.v, 104, {
    className: 'object pg6-iso-generated pg6-iso-pond',
    zOffset: -8,
    shadow: false,
  });
  addPondKoi(scene, spriteRoot, pondSeat);

  [
    [0.52, 0.93, 32],
    [0.60, 0.82, 29],
    [0.67, 0.72, 26],
    [0.73, 0.62, 23],
    [0.78, 0.54, 20],
  ].forEach(([u, v, w], index) => {
    addFloorSprite(scene, spriteRoot, { file: 'critters/stepping_stone.png' }, u, v, w, {
      className: 'object pg6-iso-stone',
      zOffset: -14 - index,
    });
  });

  // Tiered objects pick their variant FILE (bud/bloom/petal etc.), not just a
  // width — the v2 sprites carry the growth reading in the art itself.
  // Trees/statue get a slightly heavier contact shadow (0.32) since the v2
  // set has no baked-in base plates to visually seat them.
  const cherrySprite = ISO_ASSETS.cherry[tiers.cherry] || ISO_ASSETS.cherry.bloom;
  addFloorSprite(scene, spriteRoot, cherrySprite, 0.19, 0.47, tiers.cherry === 'petal' ? 82 : 72, {
    className: 'object decor-cherry pg6-iso-generated pg6-iso-tree',
    zOffset: 8,
    opacity: tiers.cherry === 'bud' ? 0.78 : 0.94,
    shadowOpacity: 0.32,
  });

  // Willow moved out from behind the pavilion (0.55,0.27 sat ~90% occluded
  // by the 0.77,0.48 pavilion) to anchor the back-center-left instead.
  const willowSprite = ISO_ASSETS.willow[tiers.willow === 'mature' ? 'mature' : 'young'];
  addFloorSprite(scene, spriteRoot, willowSprite, 0.36, 0.20, tiers.willow === 'mature' ? 116 : 90, {
    className: 'object decor-willow pg6-iso-generated pg6-iso-tree',
    zOffset: 18,
    shadowOpacity: 0.32,
  });

  if (tiers.stone_cat !== 'hidden') {
    const catSprite = ISO_ASSETS.stoneCat[tiers.stone_cat === 'full' ? 'full' : 'small'];
    // 62/50 read undersized against the v2 pavilion (the mockup's guardian is
    // ~55-60% of pavilion height); the v2 cat also lost the v1's oversized
    // pyramid plinth, so the statue itself can carry more of the width.
    addFloorSprite(scene, spriteRoot, catSprite, 0.41, 0.54, tiers.stone_cat === 'full' ? 76 : 60, {
      className: 'object cat-interactive pg6-iso-generated pg6-iso-statue',
      zOffset: 20,
      shadowOpacity: 0.32,
    });
  }

  [
    // left grove nudged front-left so it keeps masking the wall-base seam
    // behind the relocated pond (the pond's back rim tucks under its fronds)
    [0.06, 0.56, 78, -8],
    [0.92, 0.43, 68, -6],
  ].forEach(([u, v, w, z]) => {
    addFloorSprite(scene, spriteRoot, ISO_ASSETS.bamboo, u, v, w, {
      className: 'object pg6-iso-generated pg6-iso-bamboo',
      zOffset: z,
      opacity: 0.82,
    });
  });

  const pavilionWidth = { small: 116, mid: 138, full: 158 }[tiers.pavilion] || 116;
  const pavilionSprite = ISO_ASSETS.pavilion[tiers.pavilion] || ISO_ASSETS.pavilion.small;
  addFloorSprite(scene, spriteRoot, pavilionSprite, 0.77, 0.48, pavilionWidth, {
    className: 'object pg6-iso-generated pg6-iso-pavilion',
    zOffset: 32,
    shadowOpacity: 0.32,
  });

  // lit/unlit is now a sprite PAIR (v1 had the warm windows baked into the
  // only file, so the lantern glowed at 8am). CSS drop-shadow glow still
  // layers on top at night via .is-lit.
  const lit = tiers.lamp === 'lit' || scene.dataset.timeMode === 'night' || scene.dataset.timeMode === 'dusk';
  addFloorSprite(scene, spriteRoot, ISO_ASSETS.stoneLantern[lit ? 'lit' : 'unlit'], 0.80, 0.61, lit ? 46 : 42, {
    className: 'object decor-lantern ' + (lit ? 'is-lit' : 'is-dim') + ' pg6-iso-generated pg6-iso-lantern',
    zOffset: 44,
  });
}

// --- Live garden cat (五亿 token 住客), iso edition -------------------------
// Same 500M unlock + 10×3 spritesheet as the classic view (row 0 walk-right,
// row 1 walk-left, row 2 cols 4-5 sit/idle). The iso cat follows a handful of
// courtyard patrol routes instead of sampling random points, then uses a small
// steering layer to turn and avoid props. The element is long-lived across
// repaints (clearDynamic's selector skips it) so watcher ticks never teleport
// it; destroy() tears the loop down — exactly the renderer-switch contract
// docs/19 added destroy() for. The stone-cat STATUE stays: that one is the
// sessions-tier data object, this one is the resident.
let isoCatStop = null;

function stopIsoCat(scene) {
  if (isoCatStop) { isoCatStop(); isoCatStop = null; }
  scene.querySelector('.pg6-garden-cat')?.remove();
}

function addIsoGardenCat(scene, spriteRoot, groups, tiers) {
  const trinket = (CONFIG.pavilionTrinkets || []).find((item) => item.id === 'sleeping_cat');
  const want = Boolean(groups.garden_cat?.length)
    && (tiers.totalTokens || 0) >= (trinket?.threshold || 500_000_000);
  const motion = scene.dataset.motion || 'system';
  const prefersReduced = typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const full = want && motion !== 'off' && motion !== 'reduced' && !prefersReduced;
  const kind = !want ? 'none' : (full ? 'wander' : 'static');
  const existing = scene.querySelector('.pg6-garden-cat');
  if (existing && existing.dataset.catKind === kind) return;   // nothing changed
  stopIsoCat(scene);
  if (!want) return;

  const sprite = groups.garden_cat.find((item) => (item.name || '').startsWith('garden_cat'))
    || groups.garden_cat[0];
  if (!sprite?.file) return;
  const cat = document.createElement('span');
  cat.className = 'pg6-garden-cat pg6-iso-cat';
  cat.dataset.catKind = kind;
  cat.setAttribute('role', 'img');
  cat.setAttribute('aria-label', '庭院猫');
  cat.title = '庭院猫 · 五亿 token 住客';
  cat.style.setProperty('--cat-sprite', 'url("' + spriteRoot + sprite.file + '")');
  scene.append(cat);

  const frameBg = (col, row) => ((col * 100) / 9).toFixed(3) + '% ' + (row * 50) + '%';
  const place = (uu, vv) => {
    const p = isoToScreen(uu, vv);
    const wpx = 58 * p.scale;
    cat.style.left = ((p.x - wpx / 2) / W * 100).toFixed(3) + '%';
    cat.style.top = ((p.y - wpx * 0.86) / H * 100).toFixed(3) + '%';
    cat.style.width = (wpx / W * 100).toFixed(3) + '%';
    cat.style.zIndex = String(p.z + 24);
  };

  if (!full) {
    place(0.52, 0.74);
    if (motion !== 'reduced') {   // reduced keeps the CSS pg6-cat-idle blink
      cat.style.animation = 'none';
      cat.style.backgroundPosition = frameBg(4, 2);
    }
    return;
  }

  // Route-first motion: waypoints trace plausible open lanes around the pond,
  // statue, pavilion, and bamboo. Steering handles corners/avoidance, but the
  // underlying route keeps the cat from looking like a randomly drifting dot.
  const ROUTES = [
    [{ u: 0.24, v: 0.93 }, { u: 0.43, v: 0.92 }, { u: 0.60, v: 0.88 }, { u: 0.72, v: 0.76 }],
    [{ u: 0.17, v: 0.81 }, { u: 0.26, v: 0.91 }, { u: 0.48, v: 0.91 }, { u: 0.66, v: 0.82 }],
    [{ u: 0.47, v: 0.63 }, { u: 0.58, v: 0.66 }, { u: 0.69, v: 0.61 }, { u: 0.75, v: 0.56 }],
    [{ u: 0.63, v: 0.91 }, { u: 0.58, v: 0.82 }, { u: 0.66, v: 0.72 }, { u: 0.80, v: 0.60 }],
  ];
  const OBSTACLES = [
    { u: 0.33, v: 0.75, r: 0.145, force: 2.2 },  // pond (mirrors pondSeat)
    { u: 0.41, v: 0.54, r: 0.12, force: 1.8 },   // stone-cat statue
    { u: 0.77, v: 0.48, r: 0.24, force: 1.6 },   // pavilion footprint
    { u: 0.06, v: 0.56, r: 0.13, force: 1.4 },   // left bamboo grove
    { u: 0.92, v: 0.43, r: 0.13, force: 1.4 },   // right bamboo grove
  ];
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const wrapAngle = (a) => {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  };
  let u = 0.52;
  let v = 0.74;
  let heading = Math.random() * Math.PI * 2;
  let target = null;
  let route = [];
  let routeIndex = 0;
  let legLen = 1;
  let restUntil = 0;
  let restKind = 'sit';
  let lastRow = 0;
  let dist = 0;
  let lastTs = 0;
  const BASE = 0.048;   // peak amble speed, floor units / second
  const TURN = 2.25;    // rad/s heading turn rate
  const pickTarget = () => {
    if (!route.length || routeIndex >= route.length) {
      const base = ROUTES[Math.floor(Math.random() * ROUTES.length)];
      route = Math.random() < 0.5 ? base : [...base].reverse();
      routeIndex = 0;
    }
    const zone = route[routeIndex++];
    target = {
      u: clamp(zone.u + (Math.random() - 0.5) * 0.045, 0.14, 0.90),
      v: clamp(zone.v + (Math.random() - 0.5) * 0.035, 0.34, 0.94),
    };
    if (Math.abs(target.u - u) + Math.abs(target.v - v) < 0.08) {
      target = null;
      return pickTarget();
    }
    legLen = Math.max(0.05, Math.hypot(target.u - u, target.v - v));
  };
  let raf = 0;
  const tick = (ts) => {
    const dt = Math.min(0.1, lastTs ? (ts - lastTs) / 1000 : 0.016);
    lastTs = ts;
    if (restUntil > ts) {
      if (restKind === 'sit') {
        cat.style.backgroundPosition = frameBg(4 + (Math.floor(ts / 900) % 2), 2);
      }
      // 'stand' keeps the planted walk frame set at arrival — a look-around
      // pause, never a sit mid-stride (the classic renderer's rule).
    } else {
      if (!target) pickTarget();
      const du = target.u - u;
      const dv = target.v - v;
      const len = Math.hypot(du, dv);
      if (len < 0.02) {
        target = null;
        if (Math.random() < 0.68) {
          restKind = 'sit';
          restUntil = ts + 2800 + Math.random() * 5200;
        } else {
          restKind = 'stand';
          restUntil = ts + 900 + Math.random() * 1500;
          cat.style.backgroundPosition = frameBg(0, lastRow);   // planted stance
        }
      } else {
        let steerU = du / len;
        let steerV = dv / len;
        for (const ob of OBSTACLES) {
          const ou = u - ob.u;
          const ov = v - ob.v;
          const d = Math.hypot(ou, ov);
          if (d < ob.r && d > 1e-4) {
            const push = ((ob.r - d) / ob.r) * ob.force;
            steerU += (ou / d) * push;
            steerV += (ov / d) * push;
          }
        }
        const want = Math.atan2(steerV, steerU);
        heading += clamp(wrapAngle(want - heading), -TURN * dt, TURN * dt);
        // ease in/out across the leg: launch gently, stride mid-leg, settle in
        const prog = clamp(1 - len / legLen, 0, 1);
        const ease = 0.35 + 0.65 * Math.sin(prog * Math.PI);
        const step = BASE * ease * dt;
        const prev = isoToScreen(u, v);
        u = clamp(u + Math.cos(heading) * step, 0.12, 0.92);
        v = clamp(v + Math.sin(heading) * step, 0.32, 0.94);
        const now = isoToScreen(u, v);
        dist += Math.hypot(now.x - prev.x, now.y - prev.y);
        lastRow = now.x >= prev.x ? 0 : 1;
        cat.style.backgroundPosition = frameBg(Math.floor(dist / 7) % 8, lastRow);
      }
    }
    place(u, v);
    raf = window.requestAnimationFrame(tick);
  };
  place(u, v);
  raf = window.requestAnimationFrame(tick);
  isoCatStop = () => window.cancelAnimationFrame(raf);
}

// Seasonal ambient particles — the classic wall view has had these all along
// (spring petals, summer fireflies, autumn maple leaves, winter snow); the
// 2.5D scene skipped them. Reuses the SAME .pg6-season-particle / .pg6-petal
// CSS classes + keyframes and the same manifest sprites (snowflake /
// maple_leaf / firefly), so both views speak one particle language; missing
// sprites degrade to the CSS pixel-square fallback. Particles carry
// pg6-iso-dynamic so clearDynamic rebuilds them per repaint (no stacking).
function addIsoSeasonParticles(scene, spriteRoot, groups, tiers) {
  const motion = scene.dataset.motion || 'system';
  if (motion === 'off' || motion === 'reduced') return;
  if (typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const season = scene.dataset.season || 'spring';
  // Live scene height in CSS px: fall distances are computed from it so every
  // particle falls THROUGH the bottom edge before its fade-out. The classic
  // keyframes' fixed 500/520px only reached mid-air at this scene's size —
  // leaves visibly dissolved halfway down, then popped back in at the top.
  const sceneH = scene.clientHeight || 800;

  const particle = (sprite, opts) => {
    const el = sprite ? document.createElement('img') : document.createElement('span');
    el.className = 'pg6-season-particle ' + opts.className + ' pg6-iso-dynamic';
    if (sprite) {
      el.src = spriteRoot + sprite.file;
      el.alt = '';
      el.decoding = 'async';
      el.style.width = (opts.width / W * 100) + '%';
    } else {
      el.style.setProperty('--particle-size', Math.max(3, Math.round(opts.width)) + 'px');
    }
    el.style.left = opts.x + '%';
    el.style.top = opts.y + '%';
    // above every courtyard object/vine (isoToScreen z tops out ~550), below
    // the hover tooltip — weather falls in FRONT of the scene
    el.style.zIndex = String(opts.z);
    el.style.setProperty('--particle-drift', opts.drift || '0px');
    el.style.setProperty('--particle-lift', opts.lift || '0px');
    if (opts.fall) el.style.setProperty('--particle-fall', opts.fall);
    el.style.setProperty('--particle-duration', opts.duration || '10s');
    el.style.animationDelay = opts.delay || '0s';
    scene.append(el);
  };
  const spriteOf = (list, i) => (list && list.length ? pick(list, i) : null);

  if (season === 'winter') {
    for (let i = 0; i < 18; i++) {
      const y = -10 - jitter(i, 52) * 30;
      particle(spriteOf(groups.snowflake, i), {
        className: 'snow',
        x: 2 + jitter(i, 51) * 96,
        y,
        width: 7 + jitter(i, 53) * 7,
        drift: (-36 + jitter(i, 54) * 72) + 'px',
        // fall from this flake's own spawn line through the bottom edge;
        // duration scaled up with the longer run so flakes stay unhurried
        fall: Math.round(sceneH * (1.06 - y / 100)) + 'px',
        duration: (20 + jitter(i, 55) * 16) + 's',
        delay: (-jitter(i, 56) * 30) + 's',
        z: 560 + i,
      });
    }
  } else if (season === 'autumn') {
    for (let i = 0; i < 14; i++) {
      const y = -8 - jitter(i, 15) * 22;
      particle(spriteOf(groups.maple_leaf, i), {
        className: 'maple',
        x: 4 + jitter(i, 14) * 94,
        y,
        width: 11 + jitter(i, 16) * 8,
        drift: (-70 + jitter(i, 17) * 150) + 'px',
        fall: Math.round(sceneH * (1.06 - y / 100)) + 'px',
        duration: (16 + jitter(i, 18) * 12) + 's',
        delay: (-jitter(i, 19) * 26) + 's',
        z: 560 + i,
      });
    }
  } else if (season === 'summer') {
    const timeMode = scene.dataset.timeMode;
    if (timeMode !== 'dusk' && timeMode !== 'night') return;
    const count = timeMode === 'night' ? 14 : 9;
    for (let i = 0; i < count; i++) {
      particle(spriteOf(groups.firefly, i), {
        className: 'firefly',
        x: 8 + jitter(i, 31) * 84,
        y: 42 + jitter(i, 32) * 44,
        width: 4 + jitter(i, 33) * 3,
        drift: (-24 + jitter(i, 34) * 48) + 'px',
        lift: (-10 + jitter(i, 35) * 20) + 'px',
        duration: (3.5 + jitter(i, 36) * 3.5) + 's',
        delay: (-jitter(i, 37) * 7) + 's',
        z: 560 + i,
      });
    }
  } else if (season === 'spring') {
    // Petals shed from the ISO cherry's canopy (seat 0.19,0.47 — mirrors
    // addCourtyardObjects), not the classic tree's screen spot.
    if (tiers.cherry !== 'bloom' && tiers.cherry !== 'petal') return;
    const count = tiers.cherry === 'petal' ? 12 : 6;
    const p = isoToScreen(0.19, 0.47);
    const cxPct = (p.x / W) * 100;
    const cyPct = ((p.y - 58 * p.scale) / H) * 100;
    for (let i = 0; i < count; i++) {
      const petal = document.createElement('span');
      petal.className = 'pg6-petal pg6-iso-dynamic';
      petal.style.setProperty('--petal-x', (cxPct - 6 + jitter(i, 21) * 12) + '%');
      petal.style.setProperty('--petal-y', (cyPct - 3 + jitter(i, 33) * 7) + '%');
      petal.style.setProperty('--petal-drift', ((jitter(i, 44) - 0.5) * 42) + 'px');
      // canopy → ground at the cherry's feet (58u canopy height + a touch),
      // in CSS px of the live scene — the default 120px stopped mid-air here
      petal.style.setProperty('--petal-fall', Math.round(((58 * p.scale + 14) / H) * sceneH) + 'px');
      petal.style.setProperty('--petal-duration', (7 + jitter(i, 55) * 5) + 's');
      petal.style.animationDelay = (-jitter(i, 66) * 9) + 's';
      petal.style.zIndex = String(560 + i);
      scene.append(petal);
    }
  }
}

// Two live koi in the pond. Each koi follows a water-current lane: it swims
// upstream from one end of the pond, pauses, then drifts back with the current.
// Heading is sampled from the same path that moves the sprite, so the visible
// fish head and travel direction stay aligned. Loop is torn down on
// repaint/destroy.
let isoKoiStop = null;

function addPondKoi(scene, spriteRoot, seat) {
  if (isoKoiStop) { isoKoiStop(); isoKoiStop = null; }
  const p = isoToScreen(seat.u, seat.v);
  const pondW = 104 * p.scale;
  // water ellipse in scene units, comfortably inside the stone ring
  const cx = p.x;
  const cy = p.y - pondW * 0.75 * 0.52;
  const rx = pondW * 0.33;
  const ry = pondW * 0.75 * 0.28;
  const motion = scene.dataset.motion || 'system';
  const still = motion === 'off'
    || (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const paceScale = motion === 'reduced' ? 0.45 : 1;

  // pre-warm all swim frames so the first src swap never flashes
  ISO_ASSETS.koiFrames.forEach((file) => { const im = new Image(); im.src = spriteRoot + file; });
  const lanes = [
    {
      size: 13,
      down: { x: -0.48, y: 0.40 },
      up: { x: 0.42, y: -0.36 },
      bow: 0.09,
      upstreamMs: 8600,
      driftMs: 5600,
      topHoldMs: 760,
      bottomHoldMs: 980,
      offsetMs: 0,
      framePhase: 0,
    },
    {
      size: 10.5,
      down: { x: 0.42, y: 0.34 },
      up: { x: -0.34, y: -0.40 },
      bow: -0.075,
      upstreamMs: 10400,
      driftMs: 6800,
      topHoldMs: 940,
      bottomHoldMs: 1250,
      offsetMs: 6400,
      framePhase: 2,
    },
  ].map((lane) => ({
    ...lane,
    upstreamMs: lane.upstreamMs / Math.max(0.2, paceScale),
    driftMs: lane.driftMs / Math.max(0.2, paceScale),
  }));

  const fishes = lanes.map((lane) => {
    const el = document.createElement('img');
    el.className = 'pg6-iso-koi pg6-iso-dynamic';
    el.src = spriteRoot + ISO_ASSETS.koiFrames[0];
    el.alt = '';
    el.decoding = 'async';
    el.style.width = (lane.size / W * 100).toFixed(3) + '%';
    el.style.zIndex = String(p.z - 6);   // above the pond (-8), below standing objects
    scene.append(el);
    return { el, lane, frame: 0 };
  });

  const smooth = (t) => t * t * (3 - 2 * t);
  const clamp01 = (t) => Math.max(0, Math.min(1, t));
  const lanePoint = (lane, leg, t) => {
    const from = leg === 'upstream' ? lane.down : lane.up;
    const to = leg === 'upstream' ? lane.up : lane.down;
    const eased = leg === 'upstream' ? smooth(t) : t;
    const vx = to.x - from.x;
    const vy = to.y - from.y;
    const len = Math.hypot(vx, vy) || 1;
    const px = -vy / len;
    const py = vx / len;
    const bow = Math.sin(t * Math.PI) * lane.bow * (leg === 'upstream' ? 1 : 0.62);
    const ripple = Math.sin(t * Math.PI * 2 + lane.framePhase) * 0.025 * Math.sin(t * Math.PI);
    return {
      x: cx + (from.x + vx * eased + px * (bow + ripple)) * rx,
      y: cy + (from.y + vy * eased + py * (bow + ripple)) * ry,
    };
  };
  const headingFor = (lane, leg, t) => {
    const a = lanePoint(lane, leg, clamp01(t - 0.01));
    const b = lanePoint(lane, leg, clamp01(t + 0.01));
    return Math.atan2(b.y - a.y, b.x - a.x);
  };
  const blendHeading = (from, to, t) => {
    const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
    return from + delta * smooth(t);
  };
  const swimState = (lane, ts) => {
    const cycle = lane.upstreamMs + lane.topHoldMs + lane.driftMs + lane.bottomHoldMs;
    let t = (ts + lane.offsetMs) % cycle;
    if (t < lane.upstreamMs) {
      const p = t / lane.upstreamMs;
      return { leg: 'upstream', progress: p, tailMs: 145, sway: Math.sin(ts / 360 + lane.framePhase) * 1.1 };
    }
    t -= lane.upstreamMs;
    if (t < lane.topHoldMs) {
      return {
        leg: 'turn',
        pointLeg: 'upstream',
        pointProgress: 1,
        fromLeg: 'upstream',
        fromProgress: 1,
        toLeg: 'drift',
        toProgress: 0,
        turn: t / lane.topHoldMs,
        tailMs: 540,
        sway: Math.sin(ts / 520 + lane.framePhase) * 2.2,
      };
    }
    t -= lane.topHoldMs;
    if (t < lane.driftMs) {
      const p = t / lane.driftMs;
      return { leg: 'drift', progress: p, tailMs: 430, sway: Math.sin(ts / 620 + lane.framePhase) * 1.8 };
    }
    const p = (t - lane.driftMs) / lane.bottomHoldMs;
    return {
      leg: 'turn',
      pointLeg: 'drift',
      pointProgress: 1,
      fromLeg: 'drift',
      fromProgress: 1,
      toLeg: 'upstream',
      toProgress: 0,
      turn: p,
      tailMs: 620,
      sway: Math.sin(ts / 680 + lane.framePhase) * 2.4,
    };
  };
  const draw = (fish, state, ts) => {
    const { lane, el } = fish;
    const point = lanePoint(lane, state.pointLeg || state.leg, state.pointProgress ?? state.progress);
    const heading = state.fromLeg
      ? blendHeading(
        headingFor(lane, state.fromLeg, state.fromProgress),
        headingFor(lane, state.toLeg, state.toProgress),
        state.turn
      )
      : headingFor(lane, state.leg, state.progress);
    el.style.left = (point.x / W * 100).toFixed(3) + '%';
    el.style.top = (point.y / H * 100).toFixed(3) + '%';
    // koi_iso_v3's nose points about 44° above screen-right in the source art.
    // Rotate by that calibration offset so the *visible* head, not just the
    // sprite box, points along the same vector that moves the fish.
    const KOI_SPRITE_FORWARD_DEG = 44;
    const deg = (heading * 180) / Math.PI + KOI_SPRITE_FORWARD_DEG + state.sway;
    el.style.transform = 'translate(-50%, -50%) rotate(' + deg.toFixed(1) + 'deg)';
    const frameClock = state.leg === 'upstream' ? ts : ts * 0.7;
    const frame = Math.floor(frameClock / state.tailMs + lane.framePhase) % 4;
    if (frame !== fish.frame) {
      fish.frame = frame;
      el.src = spriteRoot + ISO_ASSETS.koiFrames[frame];
    }
  };

  if (still) {   // motion off: two koi rest in the water, no loop
    fishes.forEach((fish) => draw(fish, { leg: 'drift', progress: 1, tailMs: 620, sway: 0 }, 0));
    return;
  }

  let raf = 0;
  const tick = (ts) => {
    fishes.forEach((fish) => draw(fish, swimState(fish.lane, ts), ts));
    raf = window.requestAnimationFrame(tick);
  };
  raf = window.requestAnimationFrame(tick);
  isoKoiStop = () => window.cancelAnimationFrame(raf);
}

function addFloorSprite(scene, spriteRoot, sprite, u, v, width, options = {}) {
  const p = isoToScreen(u, v);
  const spriteWidth = Math.round(width * p.scale);
  if (options.shadow !== false) {
    addFloorShadow(scene, p, spriteWidth, options);
  }
  return addSprite(scene, spriteRoot, sprite, {
    x: p.x,
    y: p.y,
    width: spriteWidth,
    z: p.z + (options.zOffset || 0),
    opacity: options.opacity ?? 1,
    anchor: 'bottom',
    className: options.className || 'object',
    scaleY: options.scaleY,
  });
}

function addFloorShadow(scene, point, spriteWidth, options = {}) {
  const shadow = document.createElement('span');
  const width = Math.max(18, Math.round(spriteWidth * (options.shadowScale || 0.58)));
  shadow.className = 'pg6-iso-shadow pg6-iso-dynamic';
  shadow.style.left = (point.x / W * 100).toFixed(3) + '%';
  shadow.style.top = (point.y / H * 100).toFixed(3) + '%';
  shadow.style.width = (width / W * 100).toFixed(3) + '%';
  shadow.style.zIndex = String(point.z + (options.zOffset || 0) - 2);
  shadow.style.opacity = String(options.shadowOpacity ?? 0.28);
  scene.append(shadow);
  return shadow;
}

function addSprite(scene, spriteRoot, sprite, options) {
  if (!sprite || !sprite.file) return null;
  const img = document.createElement('img');
  img.className = 'pg6-sprite pg6-iso-dynamic' + (options.className ? ' ' + options.className : '');
  img.src = spriteRoot + sprite.file;
  img.alt = '';
  img.decoding = 'async';
  img.loading = 'eager';
  img.style.left = (options.x / W * 100).toFixed(3) + '%';
  img.style.top = (options.y / H * 100).toFixed(3) + '%';
  img.style.width = (options.width / W * 100).toFixed(3) + '%';
  img.style.zIndex = String(options.z || 10);
  img.style.opacity = String(options.opacity ?? 1);
  const anchor = options.anchor === 'top' ? 'translate(-50%, 0)' : 'translate(-50%, -100%)';
  const scaleY = options.scaleY ? ' scaleY(' + options.scaleY + ')' : '';
  img.style.setProperty('--sprite-transform', anchor + scaleY);
  if (options.hueShift) img.style.setProperty('--vine-hue-shift', options.hueShift);
  if (options.project) {
    img.classList.add('roving-vine');
    img.dataset.projectIndex = String(options.projectIndex ?? 0);
    img.dataset.projectKey = options.project.project_key || '';
    const hue = vineHueShift(options.project);
    if (hue) img.style.setProperty('--vine-hue-shift', hue);
  }
  if (options.title) img.title = options.title;
  scene.append(img);
  return img;
}

function wireProjectInteractions(scene, img, project, projectIndex) {
  img.tabIndex = scene.querySelector('.roving-vine:not([data-project-index="' + projectIndex + '"])') ? -1 : 0;
  img.addEventListener('mouseenter', () => {
    setActiveProject(projectIndex);
    updateInfoFromProject(project);
    positionInfoCardFromElement(scene, img);
  });
  img.addEventListener('mousemove', (event) => {
    positionInfoCardFromPointer(scene, event);
  });
  img.addEventListener('focus', () => {
    setActiveProject(projectIndex);
    updateInfoFromProject(project);
    positionInfoCardFromElement(scene, img);
  });
  img.addEventListener('mouseleave', () => {
    clearActiveProject();
    hideInfoCard();
  });
  img.addEventListener('blur', () => {
    clearActiveProject();
    hideInfoCard();
  });
  img.addEventListener('keydown', (event) => handleVineKey(scene, event));
}

function handleVineKey(scene, event) {
  const dir = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
  const jumpFirst = event.key === 'Home';
  const jumpLast = event.key === 'End';
  if (!dir && !jumpFirst && !jumpLast) return;
  event.preventDefault();
  const vines = Array.from(scene.querySelectorAll('.roving-vine'))
    .sort((a, b) => Number(a.dataset.projectIndex || 0) - Number(b.dataset.projectIndex || 0));
  if (!vines.length) return;
  const cur = vines.indexOf(event.currentTarget);
  const next = jumpFirst ? vines[0] : jumpLast ? vines[vines.length - 1] : vines[(cur + dir + vines.length) % vines.length];
  vines.forEach((vine) => { vine.tabIndex = -1; });
  next.tabIndex = 0;
  next.focus();
}

function updateInfoFromProject(project, options = {}) {
  const stage = Number(project.stage || 1);
  const total = project.total_tokens || 0;
  setText('garden-info-label', t('card.project.label'));
  setText('garden-info-name', project.display_name || t('card.project.defaultName'));
  setText('garden-info-total', t('card.total', { total: fmtLocal(total) }));
  setText('garden-info-stage', t('card.stage', { stage }));
  const fill = document.getElementById('garden-info-fill');
  if (fill) fill.style.width = Math.max(8, Math.min(100, stage / 6 * 100)) + '%';
  setInfoDetail(buildInfoDetail(project));
  setInfoSpark(project.daily_tokens);
  if (options.reveal !== false) showInfoCard();
}

function buildInfoDetail(project) {
  const rows = [];
  const today = windowTotal(project.daily_tokens, 1);
  if (today > 0) rows.push(metaRow(t('card.today'), fmtLocal(today)));
  const sessions = Number(project.sessions || 0);
  const tools = Number(project.tool_calls || 0);
  if (sessions > 0 || tools > 0) {
    const parts = [];
    if (sessions > 0) parts.push(t('card.sessionsShort', { count: sessions }));
    if (tools > 0) parts.push(t('card.toolsShort', { count: fmtLocal(tools) }));
    rows.push(metaRow(t('card.activity'), parts.join(' · ')));
  }
  const sources = sourceSummary(project.sources);
  if (sources) rows.push(metaRow(t('card.sources'), sources));
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

function sourceSummary(sources) {
  if (!sources || typeof sources !== 'object') return '';
  const entries = Object.entries(sources).filter(([, count]) => Number(count || 0) > 0);
  if (entries.length < 2) return '';
  const pretty = { 'claude-code': 'Claude Code', 'claude-cowork': 'Cowork', codex: 'Codex', 'manual-jsonl': t('source.manual') };
  return entries
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .map(([name, count]) => (pretty[name] || name) + ' ' + fmtLocal(Number(count)))
    .join(' · ');
}

function positionInfoCardFromElement(scene, anchor) {
  const card = document.querySelector('.pg6-info');
  if (!card || !anchor) return;
  const sceneRect = scene.getBoundingClientRect();
  const a = anchor.getBoundingClientRect();
  const cardW = card.offsetWidth || 200;
  const cardH = card.offsetHeight || 100;
  const gap = 14;
  const pad = 10;
  const aCx = a.left + a.width / 2 - sceneRect.left;
  let x = aCx < sceneRect.width / 2
    ? (a.right - sceneRect.left) + gap
    : (a.left - sceneRect.left) - cardW - gap;
  x = Math.max(pad, Math.min(sceneRect.width - cardW - pad, x));
  const aTop = a.top - sceneRect.top;
  const aBottom = a.bottom - sceneRect.top;
  const y = Math.max(pad, Math.min(sceneRect.height - cardH - pad, (aTop + aBottom) / 2 - cardH / 2));
  card.style.setProperty('--info-x', x + 'px');
  card.style.setProperty('--info-y', y + 'px');
  card.style.setProperty('--info-bottom', 'auto');
}

function positionInfoCardFromPointer(scene, event) {
  const card = document.querySelector('.pg6-info');
  if (!card) return;
  const sceneRect = scene.getBoundingClientRect();
  const cardW = card.offsetWidth || 220;
  const cardH = card.offsetHeight || 112;
  const gap = 16;
  const pad = 12;
  let x = event.clientX - sceneRect.left + gap;
  let y = event.clientY - sceneRect.top + gap;
  if (x + cardW + pad > sceneRect.width) {
    x = event.clientX - sceneRect.left - cardW - gap;
  }
  if (y + cardH + pad > sceneRect.height) {
    y = event.clientY - sceneRect.top - cardH - gap;
  }
  x = Math.max(pad, Math.min(sceneRect.width - cardW - pad, x));
  y = Math.max(pad, Math.min(sceneRect.height - cardH - pad, y));
  card.style.setProperty('--info-x', x + 'px');
  card.style.setProperty('--info-y', y + 'px');
  card.style.setProperty('--info-bottom', 'auto');
}

function showInfoCard() {
  const card = document.querySelector('.pg6-info');
  if (card) card.classList.add('is-visible');
}

function hideInfoCard() {
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

function updateHeaderMeta(scene, summary) {
  const app = document.querySelector('.pg6-app');
  if (app) app.textContent = t('app.initial') + ' · 2.5D';
  const total = document.getElementById('meta-total');
  if (total) {
    const n = summary?.total_tokens || 0;
    total.textContent = n > 0
      ? new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
      : '0';
  }
  setText('meta-season', scene.dataset.seasonLabel || t('season.spring'));
  setText('meta-season-sub', '2.5D');
  setText('meta-time', scene.dataset.timeLabel || t('time.day'));
  const now = new Date();
  setText('meta-time-sub', String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0'));
}

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
  const diff = Date.now() - new Date(stamp).getTime();
  const mins = Math.round(diff / 60_000);
  const hours = Math.round(diff / 3_600_000);
  const days = Math.round(diff / 86_400_000);
  let label;
  if (mins < 1) label = t('fresh.justNow');
  else if (mins < 60) label = t('fresh.minutesAgo', { count: mins });
  else if (hours < 24) label = t('fresh.hoursAgo', { count: hours });
  else if (days < 30) label = t('fresh.daysAgo', { count: days });
  else label = t('fresh.monthPlusAgo');
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

function updateDefaultInfo(summary, projects) {
  const project = projects[0];
  if (project) updateInfoFromProject(project, { reveal: false });
  void summary;
}

function renderEmptyState(scene) {
  const empty = document.createElement('div');
  empty.className = 'pg6-empty';
  empty.innerHTML =
    '<div class="pg6-empty-title">' + escapeHtml(t('empty.title')) + '</div>' +
    '<div class="pg6-empty-hint">' + escapeHtml(t('empty.hint')) + '</div>';
  scene.append(empty);
}

function clearDynamic(scene) {
  scene.querySelectorAll(dynamicSelector).forEach((el) => el.remove());
}

function projectsForGarden(projects) {
  return [...projects].sort((a, b) => (b.total_tokens || 0) - (a.total_tokens || 0));
}

function unlockTier(summary, projects) {
  const list = projects || [];
  const totalTokens = summary?.total_tokens || list.reduce((sum, project) => sum + (project.total_tokens || 0), 0);
  const maxProjectTokens = Math.max(...list.map((project) => project.total_tokens || 0), 0);
  const totalSessions = list.reduce((sum, project) => sum + (project.sessions || 0), 0);
  const maxStage = Math.max(...list.map((project) => project.stage || 1), 1);
  const recentActivity = list.reduce((sum, project) => sum + (project.recent_activity || 0), 0);
  const todayKey = new Date().toISOString().slice(0, 10);
  const todayActivity = list.reduce((sum, project) => sum + ((project.daily_activity || {})[todayKey] || 0), 0);
  const c = CONFIG;
  return {
    totalTokens,
    maxProjectTokens,
    totalSessions,
    recentActivity,
    todayActivity,
    pavilion: maxProjectTokens >= c.pavilion.full ? 'full' : maxProjectTokens >= c.pavilion.mid ? 'mid' : 'small',
    cherry: recentActivity >= c.cherry.petal ? 'petal' : recentActivity >= c.cherry.bloom ? 'bloom' : 'bud',
    willow: (totalTokens >= c.willow.mature_tokens || list.length >= c.willow.mature_projects) ? 'mature' : 'young',
    stone_cat: totalSessions >= c.stone_cat.full ? 'full' : totalSessions >= c.stone_cat.small ? 'small' : 'hidden',
    lamp: todayActivity > 0 ? 'lit' : 'unlit',
    stool: maxStage >= c.stool.min_stage ? 'visible' : 'hidden',
    cushion: maxStage >= c.cushion.min_stage ? 'visible' : 'hidden',
  };
}

function tokenSizeProfile(project, maxTokens, sortedTokens) {
  const tokens = project.total_tokens || 0;
  const hasCore = Number.isInteger(project.size_level) && project.size_level >= 1;
  const level = hasCore ? project.size_level : tokenSizeLevel(tokens, maxTokens);
  const strength = hasCore && Number.isFinite(project.size_strength)
    ? project.size_strength
    : tokenSizeStrength(tokens, maxTokens, sortedTokens);
  return {
    level,
    width: level >= 3 ? 30 + strength * 66 : 18 + strength * 30,
    opacity: level >= 3 ? 0.54 + strength * 0.30 : 0.48 + strength * 0.18,
  };
}

function tokenSizeLevel(tokens, maxTokens) {
  if (tokens <= 0) return 1;
  const minLog = 3;
  const maxLog = Math.max(minLog + 1, Math.log10(maxTokens + 1));
  const ratio = (Math.log10(tokens + 1) - minLog) / (maxLog - minLog);
  return Math.max(1, Math.min(5, Math.ceil(ratio * 5)));
}

function tokenSizeStrength(tokens, maxTokens, sortedTokens) {
  const rank = Math.max(0, sortedTokens.findIndex((value) => value === tokens));
  const count = Math.max(1, sortedTokens.length);
  const rankStrength = 1 - rank / Math.max(1, count - 1);
  const logStrength = tokens > 0 && maxTokens > 0
    ? Math.max(0, Math.min(1, (Math.log10(tokens + 1) - 4) / (Math.log10(maxTokens + 1) - 4)))
    : 0;
  return Math.max(0, Math.min(1, logStrength * 0.68 + rankStrength * 0.32));
}

function vineHueShift(project) {
  const sources = project && project.sources;
  if (!sources || typeof sources !== 'object') return null;
  const claude = sources['claude-code'] || sources['claude_code'] || 0;
  const codex = sources.codex || 0;
  const other = Object.entries(sources).reduce((sum, [name, count]) => {
    return (name === 'claude-code' || name === 'claude_code' || name === 'codex') ? sum : sum + (count || 0);
  }, 0);
  const total = claude + codex + other;
  if (total <= 0) return null;
  const deg = Math.round(-28 * (codex / total) + 14 * (other / total));
  return deg === 0 ? null : deg + 'deg';
}

function spreadSlots(count, min, max) {
  if (count <= 0) return [];
  if (count === 1) return [(min + max) / 2];
  const slots = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const wave = Math.sin(i * 1.7) * Math.min(0.026, 0.18 / count);
    slots.push(min + (max - min) * t + wave);
  }
  return slots;
}

function setInfoDetail(html) {
  const el = document.getElementById('garden-info-detail');
  if (el) el.innerHTML = html || '';
}

function setInfoSpark(dailyTokens) {
  const spark = document.getElementById('garden-info-spark');
  if (!spark) return;
  spark.innerHTML = dailyTokens ? sparklineSVG(dailyTokens, { days: 14, format: fmtLocal }) : '';
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}
