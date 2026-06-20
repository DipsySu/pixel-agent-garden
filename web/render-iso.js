// render-iso.js — isometric "2.5D" courtyard view.
//
// The flat side-elevation (render-svg.js) is one way to draw the garden; this
// is the other: a true isometric "room" matching the design mockup — a diamond
// floor plane with two back walls meeting at a corner, the whole island
// floating on water. Objects (render-garden.js) stand on the floor as upright
// billboards, placed via isoFloorToScreen() — the iso analogue of
// depthToScreen(). Same data flow (source → AgentEvent → summary → UI); ONLY
// the scene geometry differs.
//
// Coordinates: authored in a fixed viewBox; the scene <svg> scales to fit.
// Floor coords (u,v) ∈ [0,1]²: (0,0)=back corner (top), (1,0)=right corner,
// (0,1)=left corner, (1,1)=front corner (screen bottom). isoFloorToScreen maps
// them to viewBox px so the floor, walls, and objects all share one projection.

import { t } from './i18n.js';
import { namedSprite, pickByToken, pick } from './render-helpers.js';
import { unlockTier } from './garden-tiers.js';

// Same viewBox aspect as the flat view (680×440) so DOM object sprites
// positioned by left%/top% of the scene element line up with this SVG exactly
// (the scene box is locked to that ratio; a different aspect would letterbox).
const VB_W = 680, VB_H = 440;

// --- Isometric projection (single source of truth) -------------------------
// A 2:1-ish dimetric floor. halfW/halfH set the diamond's footprint; topY is
// the back corner; wallH is how tall the back walls rise (screen-up) from the
// floor's back edges. Everything (floor grid, walls, object seats) reads off
// these so the geometry stays consistent.
export const ISO = {
  cx: 340,        // floor diamond horizontal center
  topY: 224,      // back-corner y (the diamond's topmost point)
  halfW: 296,     // back→left / back→right horizontal span
  halfH: 96,      // back→left / back→right vertical drop
  slab: 15,       // floor-slab thickness shown on the front edges
  wallH: 138,     // back-wall height (screen px, straight up)
};

// Map floor coord (u,v) → viewBox screen point on the floor PLANE.
export function isoFloorToScreen(u, v) {
  return {
    x: ISO.cx + (u - v) * ISO.halfW,
    y: ISO.topY + (u + v) * ISO.halfH,
  };
}

// Convenience: the four floor corners.
function corners() {
  return {
    B: isoFloorToScreen(0, 0), // back  (top)
    R: isoFloorToScreen(1, 0), // right
    L: isoFloorToScreen(0, 1), // left
    F: isoFloorToScreen(1, 1), // front (bottom)
  };
}

const lerp2 = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
function hash(a, b) {
  const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return x - Math.floor(x);
}
// Time-of-day for the iso scene. Same thresholds as render-svg's systemTimeMode
// (kept local — it's 4 lines and avoids a cross-module export just for this).
function isoTimeMode(settings) {
  const forced = settings?.appearance?.time_mode || 'system';
  if (forced !== 'system') return forced;
  const now = new Date();
  const h = now.getHours() + now.getMinutes() / 60;
  if (h >= 6 && h < 16.5) return 'day';
  if (h >= 16.5 && h < 19.5) return 'dusk';
  return 'night';
}
// Per-mode sky/sea palette + night dressing. Mirrors the flat view's grade so a
// scene reads the same time-of-day in either view.
const ISO_TIME = {
  day:   { skyTop: '#8fc4e8', skyBot: '#cfe6f0', seaTop: '#bcdcea', seaBot: '#7fa8c4', wallShade: null, vignette: 0, moon: false, lampGlow: false },
  dusk:  { skyTop: '#8ea2c8', skyBot: '#e4a174', seaTop: '#caa39a', seaBot: '#8f7782', wallShade: 'rgba(120,70,40,0.16)', vignette: 0.26, moon: false, lampGlow: true },
  night: { skyTop: '#17213a', skyBot: '#2a3550', seaTop: '#2b3a54', seaBot: '#19243c', wallShade: 'rgba(13,18,34,0.5)', vignette: 0.5, moon: true, lampGlow: true },
};

const pt = (p) => p.x.toFixed(1) + ',' + p.y.toFixed(1);
const poly = (pts, fill, extra) =>
  '<polygon points="' + pts.map(pt).join(' ') + '" fill="' + fill + '"' + (extra || '') + '/>';
const line = (a, b, stroke, w, op) =>
  '<line x1="' + a.x.toFixed(1) + '" y1="' + a.y.toFixed(1) + '" x2="' + b.x.toFixed(1) +
  '" y2="' + b.y.toFixed(1) + '" stroke="' + stroke + '" stroke-width="' + (w || 1) + '"' +
  (op != null ? ' stroke-opacity="' + op + '"' : '') + '/>';

export function renderIsoScene(scene, assetRoot, options = {}) {
  const c = corners();
  const down = (p, dy) => ({ x: p.x, y: p.y + dy });   // extrude down (slab)
  const up = (p, dy) => ({ x: p.x, y: p.y - dy });     // extrude up (walls)
  const mode = isoTimeMode(options.settings);
  const tt = ISO_TIME[mode] || ISO_TIME.day;

  let s = '<svg viewBox="0 0 ' + VB_W + ' ' + VB_H + '" width="100%" preserveAspectRatio="xMidYMid meet" ' +
    'shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg" role="img">' +
    '<title>' + t('app.initial') + '</title>';

  // === Sky + sea backdrop =======================================
  s += '<defs>' +
    '<linearGradient id="isoSky" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="' + tt.skyTop + '"/>' +
      '<stop offset="100%" stop-color="' + tt.skyBot + '"/>' +
    '</linearGradient>' +
    '<linearGradient id="isoSea" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="' + tt.seaTop + '"/>' +
      '<stop offset="100%" stop-color="' + tt.seaBot + '"/>' +
    '</linearGradient>' +
    '<radialGradient id="isoLampGlow" cx="50%" cy="50%" r="50%">' +
      '<stop offset="0%" stop-color="#ffe6ad" stop-opacity="0.7"/>' +
      '<stop offset="45%" stop-color="#ffbe6e" stop-opacity="0.28"/>' +
      '<stop offset="100%" stop-color="#ffb060" stop-opacity="0"/>' +
    '</radialGradient>' +
    '<radialGradient id="isoMoonGlow" cx="50%" cy="50%" r="50%">' +
      '<stop offset="0%" stop-color="#eef4ff" stop-opacity="0.55"/>' +
      '<stop offset="55%" stop-color="#ccdcfb" stop-opacity="0.16"/>' +
      '<stop offset="100%" stop-color="#ccdcfb" stop-opacity="0"/>' +
    '</radialGradient>' +
    '<radialGradient id="isoVignette" cx="50%" cy="48%" r="72%">' +
      '<stop offset="0%" stop-color="#070b16" stop-opacity="0"/>' +
      '<stop offset="58%" stop-color="#070b16" stop-opacity="0"/>' +
      '<stop offset="100%" stop-color="#070b16" stop-opacity="1"/>' +
    '</radialGradient>' +
    '</defs>';
  const horizon = 150;
  s += '<rect x="0" y="0" width="' + VB_W + '" height="' + horizon + '" fill="url(#isoSky)"/>';
  s += '<rect x="0" y="' + horizon + '" width="' + VB_W + '" height="' + (VB_H - horizon) + '" fill="url(#isoSea)"/>';
  // a couple of horizon haze bands so the sea reads as receding water
  s += '<rect x="0" y="' + horizon + '" width="' + VB_W + '" height="3" fill="#d6ecf2" opacity="0.6"/>';
  // distant misty islands on the sea horizon (reuse the flat view's mountains)
  s += '<image href="' + assetRoot + '/sprites/mountains/mountains_far.png" x="0" y="' +
    (horizon - 34) + '" width="' + VB_W + '" height="40" preserveAspectRatio="none" opacity="0.5"/>';

  // === Floating courtyard =======================================
  // (a) Floor SLAB sides — front-left (L→F) and front-right (R→F) edges extruded
  //     down, so the island reads as a thick block sitting on the water.
  s += poly([c.R, c.F, down(c.F, ISO.slab), down(c.R, ISO.slab)], '#3a2a1a');   // right slab
  s += poly([c.L, c.F, down(c.F, ISO.slab), down(c.L, ISO.slab)], '#2c2014');   // left slab (darker)
  s += poly([c.L, down(c.L, ISO.slab), down(c.B, ISO.slab + (c.L.y - c.B.y)), c.B], '#241a10', ' opacity="0"'); // (reserved)

  // (b) Floor TOP — the green diamond.
  s += poly([c.B, c.R, c.F, c.L], '#5a8a3a');
  // floor grid (constant-u and constant-v lines), subtle darker green
  for (let i = 1; i < 10; i++) {
    const tline = i / 10;
    s += line(isoFloorToScreen(tline, 0), isoFloorToScreen(tline, 1), '#4d7a32', 1, 0.5);
    s += line(isoFloorToScreen(0, tline), isoFloorToScreen(1, tline), '#4d7a32', 1, 0.5);
  }
  // floor edge highlight
  s += line(c.B, c.R, '#6fa048', 1.5, 0.7);
  s += line(c.B, c.L, '#6fa048', 1.5, 0.7);

  // === Back walls ===============================================
  // Two parallelograms rising straight up from the floor's back edges, meeting
  // at the back vertical corner (B → up).
  const Bt = up(c.B, ISO.wallH), Rt = up(c.R, ISO.wallH), Lt = up(c.L, ISO.wallH);
  // right wall (B→R edge), lighter; left wall (B→L edge), shaded.
  s += poly([c.B, c.R, Rt, Bt], '#b8a079');
  s += poly([c.B, c.L, Lt, Bt], '#a08a64');
  // mortar courses: lines parallel to each wall's bottom edge, stepped up.
  const courses = 7;
  for (let i = 1; i < courses; i++) {
    const f = i / courses;
    s += line(up(c.B, ISO.wallH * f), up(c.R, ISO.wallH * f), '#92775a', 1, 0.5);
    s += line(up(c.B, ISO.wallH * f), up(c.L, ISO.wallH * f), '#7d6850', 1, 0.5);
  }
  // wall top caps (a thin rim)
  s += line(Bt, Rt, '#6f5f4a', 2, 0.9);
  s += line(Bt, Lt, '#5f5040', 2, 0.9);
  // back vertical corner seam
  s += line(c.B, Bt, '#6f5f4a', 1.5, 0.6);

  // === Ivy draping both walls ===================================
  // Hang the wall-ivy decor PNGs straight down (gravity) from points along each
  // wall's TOP edge. Pieces near the back corner (the deep end) are smaller, so
  // the curtain recedes with the wall. Reuses assets/sprites/decor/wall_ivy_*.
  const ivyOnEdge = (top, far, count, baseW) => {
    let out = '';
    for (let i = 0; i <= count; i++) {
      const w = i / count;
      const p = lerp2(top, far, w);          // point along the sloped top edge
      const sc = 0.7 + 0.3 * w;              // narrower toward the back corner (w→0)
      const iw = baseW * sc;
      // Height ≈ wall height (walls rise a constant wallH in screen px at any
      // depth), capped just under it so tips reach the wall base, not the floor.
      const ih = ISO.wallH * (0.74 + hash(i, 7) * 0.24);
      const variant = hash(i, 91) > 0.45 ? 'wall_ivy_02' : 'wall_ivy_01';
      const jx = (hash(i, 71) - 0.5) * 6;
      out += '<image href="' + assetRoot + '/sprites/decor/' + variant + '.png" x="' +
        (p.x - iw / 2 + jx).toFixed(1) + '" y="' + (p.y - 4).toFixed(1) + '" width="' + iw.toFixed(1) +
        '" height="' + ih.toFixed(1) + '" preserveAspectRatio="none" image-rendering="pixelated" opacity="0.92"/>';
    }
    return out;
  };
  // left edge first (farther in z behind the right), then right edge.
  s += ivyOnEdge(Bt, Lt, 11, 78);
  s += ivyOnEdge(Bt, Rt, 11, 78);

  // === Fence posts on the two FRONT edges =======================
  // Short posts marching along L→F and R→F (the near floor edges), like the
  // mockup's low courtyard border. Placed on the floor plane, drawn upright.
  const postH = 26;
  const fenceOnEdge = (a, b, count) => {
    let out = '';
    for (let i = 1; i < count; i++) {
      const p = lerp2(a, b, i / count);
      out += '<rect x="' + (p.x - 2.5).toFixed(1) + '" y="' + (p.y - postH).toFixed(1) +
        '" width="5" height="' + postH + '" fill="#6b4a2c"/>';
      out += '<rect x="' + (p.x - 2.5).toFixed(1) + '" y="' + (p.y - postH).toFixed(1) +
        '" width="2" height="' + postH + '" fill="#8a6440"/>';
    }
    return out;
  };
  s += fenceOnEdge(c.L, c.F, 6);
  s += fenceOnEdge(c.R, c.F, 6);

  // === Time-of-day dressing =====================================
  // Drawn over the SVG room (under the DOM object sprites). Night/dusk shade the
  // walls + sea, hang a moon, pool warm light where the lantern stands, and
  // vignette the frame; day leaves it bright. The lantern's own lit-glow comes
  // from the shared .pg6-sprite.decor-lantern CSS, gated on data-time-mode.
  if (tt.wallShade) {
    s += poly([c.B, c.R, Rt, Bt], tt.wallShade);
    s += poly([c.B, c.L, Lt, Bt], tt.wallShade);
  }
  if (tt.moon) {
    const mx = 552, my = 76;
    s += '<circle cx="' + mx + '" cy="' + my + '" r="44" fill="url(#isoMoonGlow)"/>';
    s += '<circle cx="' + mx + '" cy="' + my + '" r="15" fill="#eef3ff"/>';
    s += '<circle cx="' + (mx + 6) + '" cy="' + (my - 3) + '" r="13" fill="' + tt.skyTop + '"/>';  // carve a crescent
  }
  if (tt.lampGlow) {
    const lp = isoFloorToScreen(0.68, 0.64);   // mirrors the stone-lantern seat
    s += '<circle cx="' + lp.x.toFixed(0) + '" cy="' + (lp.y - 24).toFixed(0) + '" r="42" fill="url(#isoLampGlow)"/>';
  }
  if (tt.vignette > 0) {
    s += '<rect x="0" y="0" width="' + VB_W + '" height="' + VB_H + '" fill="url(#isoVignette)" opacity="' + tt.vignette + '"/>';
  }

  s += '</svg>';
  scene.innerHTML = s;
  scene.dataset.view = 'iso';
  scene.dataset.timeMode = mode;

  placeIsoObjects(scene, options.spriteRoot, options.groups || {}, options.summary || null, mode);
  updateIsoHeader(options.summary || null, mode);
}

// The header token total + time chip are view-independent; the flat renderer
// fills them inside renderEverything (which the iso path skips), so mirror the
// essentials here. (Solar-term sub-line is left to the flat view for now.)
function updateIsoHeader(summary, mode) {
  const total = document.getElementById('meta-total');
  if (total) {
    const n = summary?.total_tokens || 0;
    total.textContent = n > 0
      ? new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
      : '0';
  }
  const timeEl = document.getElementById('meta-time');
  if (timeEl) timeEl.textContent = t('time.' + (mode || 'day'));
}

// --- Objects on the floor --------------------------------------------------
// The same sprites + token tiers as the flat view (render-garden.js), but seated
// on the iso floor at (u,v) coords and depth-sorted (farther = drawn first, so
// nearer objects overlap them). Each is a DOM <img> billboard standing upright;
// positioned by left%/top%/width% of the scene (which is locked to this SVG's
// 680×440 aspect, so the percentages land on the floor plane).
function placeIsoObjects(scene, spriteRoot, groups, summary, mode) {
  if (!spriteRoot) return;
  const projects = summary?.projects?.length ? summary.projects : [];
  const tiers = unlockTier(summary, projects);
  // Lamp reads as lit when there's activity today OR simply because it's dark
  // out (matches the flat view, so dusk/night courtyards are always aglow).
  const lampLit = tiers.lamp === 'lit' || mode === 'night' || mode === 'dusk';
  const items = [];
  // add(u, v, file, width) — width in viewBox px. Skips missing sprites.
  const add = (u, v, file, width, opts) => { if (file) items.push({ u, v, file, width, opts: opts || {} }); };
  const fileOf = (sprite) => (sprite && sprite.file) || null;

  // Pond — top-down koi sprite, squashed a touch; back-left of the floor.
  add(0.26, 0.45, 'critters/koi_pond.png', 130, { scaleY: 0.66 });

  // Stone cat (招财猫) — open left-center, clear of the pavilion.
  if (tiers.stone_cat !== 'hidden') {
    const cats = (groups.stone_cat && groups.stone_cat.length) ? groups.stone_cat : (groups.shrine || []);
    const full = tiers.stone_cat === 'full';
    const sp = namedSprite(cats, full ? 'stone_cat_full' : 'stone_cat_small')
            || namedSprite(cats, full ? 'shrine_full' : 'shrine_small')
            || pickByToken(cats, full ? 5 : 2);
    // Light interactivity for the scenic view: the guardian cat gets a hover
    // tooltip with its session stat + a pointer cursor (the rich info-card panel
    // stays the flat data view's job).
    add(0.44, 0.52, fileOf(sp), 78, {
      className: 'iso-interactive',
      title: t('card.cat.label') + ' · ' + t('card.cat.sessions', { count: tiers.totalSessions || 0 }),
    });
  }
  // Stone cairn / pagoda — center-front of the cat.
  if (groups.stone_cairn && groups.stone_cairn.length) {
    const full = tiers.stone_cat === 'full';
    const sp = namedSprite(groups.stone_cairn, full ? 'stone_cairn_full' : 'stone_cairn_small') || pickByToken(groups.stone_cairn, 3);
    add(0.45, 0.68, fileOf(sp), 42);
  }
  // Cherry — back-center peer anchor.
  if (groups.cherry_tree && groups.cherry_tree.length) {
    const ct = tiers.cherry;
    const sp = ct === 'petal' ? (namedSprite(groups.cherry_tree, 'cherry_tree_petal') || namedSprite(groups.cherry_tree, 'cherry_tree_bloom') || pickByToken(groups.cherry_tree, 5))
      : ct === 'bloom' ? (namedSprite(groups.cherry_tree, 'cherry_tree_bloom') || pickByToken(groups.cherry_tree, 5))
      : (namedSprite(groups.cherry_tree, 'cherry_tree_bud') || pickByToken(groups.cherry_tree, 2));
    add(0.30, 0.24, fileOf(sp), 104);
  }
  // Willow — back-right, behind the pavilion.
  if (groups.willow && groups.willow.length) {
    const sp = namedSprite(groups.willow, tiers.willow === 'mature' ? 'willow_mature' : 'willow_young') || pickByToken(groups.willow, tiers.willow === 'mature' ? 5 : 2);
    add(0.70, 0.17, fileOf(sp), 130);
  }
  // Pavilion — the hero structure, right side. (Manifest group is
  // `pavilion_compact`, matching render-garden.js's source group.)
  if (groups.pavilion_compact && groups.pavilion_compact.length) {
    const idx = { small: 1, mid: 3, full: 5 }[tiers.pavilion] || 1;
    add(0.79, 0.46, fileOf(pickByToken(groups.pavilion_compact, idx)), 178);
  }
  // Stone lantern — front-right, near the pavilion.
  if (groups.stone_lantern && groups.stone_lantern.length) {
    const sp = namedSprite(groups.stone_lantern, lampLit ? 'stone_lantern_lit' : 'stone_lantern_unlit') || pickByToken(groups.stone_lantern, lampLit ? 5 : 1);
    add(0.68, 0.64, fileOf(sp), 40, { className: 'decor-lantern ' + (lampLit ? 'is-lit' : 'is-dim') });
  }
  // Bamboo grove — far right edge. (Manifest group is `bamboo_cluster`.)
  if (groups.bamboo_cluster && groups.bamboo_cluster.length) {
    const sp = namedSprite(groups.bamboo_cluster, 'bamboo_cluster_02') || groups.bamboo_cluster[0];
    add(0.90, 0.46, fileOf(sp), 74);
  }
  // Stepping stones — a short path crossing the floor toward the pavilion.
  const stones = [[0.40, 0.74], [0.50, 0.78], [0.60, 0.74]];
  stones.forEach(([u, v]) => add(u, v, 'critters/stepping_stone.png', 30));

  // Depth sort: farther (smaller u+v) drawn first → nearer objects overlap.
  items.sort((a, b) => (a.u + a.v) - (b.u + b.v));
  items.forEach((it, i) => {
    const p = isoFloorToScreen(it.u, it.v);
    const img = document.createElement('img');
    img.className = 'pg6-sprite object' + (it.opts.className ? ' ' + it.opts.className : '');
    img.src = spriteRoot + it.file;
    img.alt = '';
    img.decoding = 'async';
    img.style.left = (p.x / VB_W * 100) + '%';
    img.style.top = (p.y / VB_H * 100) + '%';
    img.style.width = (it.width / VB_W * 100) + '%';
    img.style.zIndex = String(20 + i);
    const tf = 'translate(-50%, -100%)' + (it.opts.scaleY ? ' scaleY(' + it.opts.scaleY + ')' : '');
    img.style.setProperty('--sprite-transform', tf);
    if (it.opts.title) img.title = it.opts.title;
    scene.appendChild(img);
  });
}
