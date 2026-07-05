import { t } from '../i18n.js';

const W = 680;
const H = 440;
const PROJECTION = Object.freeze({
  floorTop: { x: 340, y: 192 },
  floorLeft: { x: 58, y: 282 },
  floorRight: { x: 622, y: 282 },
  floorFront: { x: 340, y: 410 },
  wallHeight: 56,
});

const FLOOR_TOP = PROJECTION.floorTop;
const FLOOR_LEFT = PROJECTION.floorLeft;
const FLOOR_RIGHT = PROJECTION.floorRight;
const FLOOR_FRONT = PROJECTION.floorFront;
const WALL_H = PROJECTION.wallHeight;
const WALL_LEFT_TOP = { x: FLOOR_LEFT.x, y: FLOOR_LEFT.y - WALL_H };
const WALL_CORNER_TOP = { x: FLOOR_TOP.x, y: FLOOR_TOP.y - WALL_H };
const WALL_RIGHT_TOP = { x: FLOOR_RIGHT.x, y: FLOOR_RIGHT.y - WALL_H };

export function renderIsometricBase(scene, assetRoot, options = {}) {
  const time = resolveTimeScene(options.settings);
  const season = resolveSeasonScene(options.settings);
  const r = (x, y, w, h, c) => '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + c + '"/>';
  let s = '<svg class="pg6-iso-svg" viewBox="0 0 ' + W + ' ' + H + '" width="100%" preserveAspectRatio="xMidYMid meet" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg" role="img">';
  s += '<title>' + escapeText(t('svg.title', { time: time.label }) + ' · 2.5D') + '</title>';
  s += '<desc>' + escapeText(t('svg.desc')) + '</desc>';
  s += '<defs>';
  s += '<linearGradient id="pg6IsoSky" x1="0" y1="0" x2="0" y2="1">';
  s += '<stop offset="0%" stop-color="' + time.skyTop + '"/>';
  s += '<stop offset="62%" stop-color="' + time.skyMid + '"/>';
  s += '<stop offset="100%" stop-color="' + time.skyBottom + '"/>';
  s += '</linearGradient>';
  s += '<linearGradient id="pg6IsoFloor" x1="0" y1="0" x2="0" y2="1">';
  s += '<stop offset="0%" stop-color="' + season.floorBack + '"/>';
  s += '<stop offset="100%" stop-color="' + season.floorFront + '"/>';
  s += '</linearGradient>';
  s += '<linearGradient id="pg6IsoWallLeft" x1="0" y1="0" x2="1" y2="1">';
  s += '<stop offset="0%" stop-color="' + time.wallLight + '"/>';
  s += '<stop offset="100%" stop-color="' + time.wallMid + '"/>';
  s += '</linearGradient>';
  s += '<linearGradient id="pg6IsoWallRight" x1="0" y1="0" x2="1" y2="1">';
  s += '<stop offset="0%" stop-color="' + time.wallMid + '"/>';
  s += '<stop offset="100%" stop-color="' + time.wallDark + '"/>';
  s += '</linearGradient>';
  s += '</defs>';

  s += r(0, 0, W, H, 'url(#pg6IsoSky)');
  s += renderStars(time);
  if (time.mode !== 'night') {
    s += cloud(assetRoot, 68, 54, 76) + cloud(assetRoot, 512, 44, 96);
    // third, fainter cloud breaks up the empty left-middle sky band
    s += '<g opacity="0.62">' + cloud(assetRoot, 252, 88, 54) + '</g>';
  }
  s += renderOrb(time, r, assetRoot);
  s += '<image href="' + assetRoot + '/sprites/mountains/mountains_far.png" x="-18" y="104" width="716" height="54" preserveAspectRatio="none" opacity="' + time.mountainFarOpacity + '"/>';
  s += '<image href="' + assetRoot + '/sprites/mountains/mountains_near.png" x="-20" y="124" width="720" height="60" preserveAspectRatio="none" opacity="' + time.mountainNearOpacity + '"/>';

  s += renderWaterContact(time);
  s += renderWaterLife(time, assetRoot);
  s += renderBackWalls(time, r);
  s += renderFloor(season, r);
  s += renderFence(r);
  // Warm pool where the stone lantern stands (mirrors the DOM sprite's seat at
  // isometric-renderer's 0.80,0.61 — same constant-mirroring the flat view
  // uses for its lantern glow). Painted in the SVG so the postcard export
  // keeps it; the lantern <img> lands on top with its lit windows.
  if (time.mode === 'night' || time.mode === 'dusk') {
    const lamp = isoToScreen(0.80, 0.61);
    s += '<radialGradient id="pg6IsoLampGlow" cx="50%" cy="50%" r="50%">'
      + '<stop offset="0%" stop-color="#ffe6ad" stop-opacity="0.55"/>'
      + '<stop offset="45%" stop-color="#ffbe6e" stop-opacity="0.22"/>'
      + '<stop offset="100%" stop-color="#ffb060" stop-opacity="0"/>'
      + '</radialGradient>'
      + '<ellipse cx="' + lamp.x.toFixed(1) + '" cy="' + (lamp.y - 16).toFixed(1) + '" rx="40" ry="26" fill="url(#pg6IsoLampGlow)"/>';
  }
  s += '</svg>';

  scene.innerHTML = s +
    '<div class="pg6-info" aria-live="polite" role="status">' +
      '<div class="pg6-info-label" id="garden-info-label">' + t('card.project.label') + '</div>' +
      '<div class="pg6-info-name" id="garden-info-name">' + t('card.project.defaultName') + '</div>' +
      '<div class="pg6-info-row"><span id="garden-info-total">' + t('card.total', { total: '0' }) + '</span><span id="garden-info-stage">' + t('card.stage', { stage: 1 }) + '</span></div>' +
      '<div class="pg6-info-bar"><div class="pg6-info-fill" id="garden-info-fill"></div></div>' +
      '<div class="pg6-info-detail" id="garden-info-detail"></div>' +
      '<div class="pg6-info-spark" id="garden-info-spark" aria-hidden="true"></div>' +
    '</div>';

  scene.dataset.renderer = 'isometric';
  scene.dataset.timeMode = time.mode;
  scene.dataset.timeLabel = time.label;
  scene.dataset.motion = options.settings?.appearance?.motion || 'system';
  scene.dataset.season = season.mode;
  scene.dataset.seasonLabel = season.label;
  scene.dataset.flowerbed = 'disabled';
  scene.style.removeProperty('--wall-top-pct');
}

export function isoToScreen(u, v) {
  const uu = clamp01(u);
  const vv = clamp01(v);
  const x = FLOOR_TOP.x + (FLOOR_RIGHT.x - FLOOR_TOP.x) * uu + (FLOOR_LEFT.x - FLOOR_TOP.x) * vv;
  const y = FLOOR_TOP.y + (FLOOR_RIGHT.y - FLOOR_TOP.y) * uu + (FLOOR_LEFT.y - FLOOR_TOP.y) * vv;
  const depth = (uu + vv) / 2;
  return {
    x,
    y,
    depth,
    scale: 0.72 + depth * 0.46,
    z: Math.round(120 + y + depth * 80),
  };
}

export function wallSlotToScreen(slot) {
  const t = clamp01(slot);
  if (t <= 0.5) {
    const k = t / 0.5;
    return {
      x: WALL_LEFT_TOP.x + (WALL_CORNER_TOP.x - WALL_LEFT_TOP.x) * k,
      y: WALL_LEFT_TOP.y + (WALL_CORNER_TOP.y - WALL_LEFT_TOP.y) * k,
      side: 'left',
    };
  }
  const k = (t - 0.5) / 0.5;
  return {
    x: WALL_CORNER_TOP.x + (WALL_RIGHT_TOP.x - WALL_CORNER_TOP.x) * k,
    y: WALL_CORNER_TOP.y + (WALL_RIGHT_TOP.y - WALL_CORNER_TOP.y) * k,
    side: 'right',
  };
}

function renderBackWalls(time, r) {
  let s = '';
  s += '<polygon points="' + points(FLOOR_LEFT, FLOOR_TOP, WALL_CORNER_TOP, WALL_LEFT_TOP) + '" fill="url(#pg6IsoWallLeft)"/>';
  s += '<polygon points="' + points(FLOOR_TOP, FLOOR_RIGHT, WALL_RIGHT_TOP, WALL_CORNER_TOP) + '" fill="url(#pg6IsoWallRight)"/>';
  s += '<polygon points="' + points(WALL_LEFT_TOP, WALL_CORNER_TOP, WALL_RIGHT_TOP, FLOOR_RIGHT, FLOOR_TOP, FLOOR_LEFT) + '" fill="rgba(32,22,16,0.12)"/>';
  s += '<polyline points="' + points(WALL_LEFT_TOP, WALL_CORNER_TOP, WALL_RIGHT_TOP) + '" fill="none" stroke="' + time.wallEdge + '" stroke-width="4" stroke-linejoin="miter"/>';
  s += '<polyline points="' + points(FLOOR_LEFT, FLOOR_TOP, FLOOR_RIGHT) + '" fill="none" stroke="rgba(45,35,26,0.42)" stroke-width="3"/>';
  // Coursed masonry instead of the old sparse stud/course lines: horizontal
  // mortar joints per wall face, staggered head joints per band (running
  // bond), and cap ticks along the rim. Joint/highlight tones are fixed
  // low-opacity overlays so the underlying time-of-day wall gradient still
  // carries dusk/night shading. Aligns the iso wall with the flat view's
  // sandstone masonry language (scene-tiles.js WALL_PAL family).
  const ln = (p1, p2, stroke, w) =>
    '<line x1="' + p1.x.toFixed(1) + '" y1="' + p1.y.toFixed(1) + '" x2="' + p2.x.toFixed(1) +
    '" y2="' + p2.y.toFixed(1) + '" stroke="' + stroke + '" stroke-width="' + w + '"/>';
  const lift = (p, h) => ({ x: p.x, y: p.y - h });
  const COURSES = 5;
  const JOINTS = 8;
  const faces = [
    { a: FLOOR_LEFT, b: FLOOR_TOP, joint: 'rgba(52,41,30,0.28)', hi: 'rgba(236,222,192,0.10)' },
    { a: FLOOR_TOP, b: FLOOR_RIGHT, joint: 'rgba(52,41,30,0.34)', hi: 'rgba(236,222,192,0.07)' },
  ];
  for (const face of faces) {
    for (let c = 1; c < COURSES; c++) {
      const h = (WALL_H * c) / COURSES;
      s += ln(lift(face.a, h), lift(face.b, h), face.joint, 1.5);
      s += ln(lift(face.a, h + 1.5), lift(face.b, h + 1.5), face.hi, 1);
    }
    for (let c = 0; c < COURSES; c++) {
      const y0 = (WALL_H * c) / COURSES + 1;
      const y1 = (WALL_H * (c + 1)) / COURSES - 1;
      for (let j = 1; j <= JOINTS; j++) {
        const tt = (j - (c % 2) * 0.5) / (JOINTS + 0.5);
        if (tt <= 0.03 || tt >= 0.97) continue;
        const b = lerpPoint(face.a, face.b, tt);
        s += ln(lift(b, y0), lift(b, y1), face.joint, 1);
      }
    }
  }
  // cap stones: short ticks along the two top rims
  for (let i = 1; i < 10; i++) {
    const a = lerpPoint(WALL_LEFT_TOP, WALL_CORNER_TOP, i / 10);
    const b = lerpPoint(WALL_CORNER_TOP, WALL_RIGHT_TOP, i / 10);
    s += ln(a, { x: a.x, y: a.y + 3 }, 'rgba(68,51,33,0.5)', 1.5);
    s += ln(b, { x: b.x, y: b.y + 3 }, 'rgba(68,51,33,0.5)', 1.5);
  }
  for (let i = 0; i < 18; i++) {
    const p = wallSlotToScreen((i + 0.35) / 18);
    if (i % 3 === 0) s += r(p.x - 2, p.y + 28, 4, 10, 'rgba(62,74,42,0.36)');
    if (i % 5 === 1) s += r(p.x + 8, p.y + 54, 8, 3, 'rgba(80,94,52,0.42)');
  }
  return s;
}

function renderFloor(season, r) {
  let s = '';
  const sideDrop = 10;
  const trayDrop = 12;
  const tray = {
    top: { x: FLOOR_TOP.x, y: FLOOR_TOP.y - 4 },
    left: { x: FLOOR_LEFT.x - 11, y: FLOOR_LEFT.y + 2 },
    right: { x: FLOOR_RIGHT.x + 11, y: FLOOR_RIGHT.y + 2 },
    front: { x: FLOOR_FRONT.x, y: FLOOR_FRONT.y + 8 },
  };
  s += '<polygon points="' + points(
    { x: tray.left.x + 11, y: tray.left.y + trayDrop + 10 },
    { x: tray.front.x, y: tray.front.y + trayDrop + 18 },
    { x: tray.right.x - 11, y: tray.right.y + trayDrop + 10 },
    { x: tray.front.x, y: tray.front.y + trayDrop + 28 }
  ) + '" fill="rgba(31,25,19,0.10)"/>';
  s += '<polygon points="' + points(tray.top, tray.right, tray.front, tray.left) + '" fill="#745233"/>';
  s += '<polygon points="' + points(tray.left, tray.front, { x: tray.front.x, y: tray.front.y + trayDrop }, { x: tray.left.x, y: tray.left.y + trayDrop }) + '" fill="#5a3d25"/>';
  s += '<polygon points="' + points(tray.right, tray.front, { x: tray.front.x, y: tray.front.y + trayDrop }, { x: tray.right.x, y: tray.right.y + trayDrop }) + '" fill="#674227"/>';
  s += '<polyline points="' + points(tray.left, tray.front, tray.right) + '" fill="none" stroke="#906234" stroke-width="2"/>';
  s += '<polygon points="' + points(FLOOR_TOP, FLOOR_RIGHT, FLOOR_FRONT, FLOOR_LEFT) + '" fill="url(#pg6IsoFloor)"/>';
  s += '<polygon points="' + points(FLOOR_LEFT, FLOOR_FRONT, { x: FLOOR_FRONT.x, y: FLOOR_FRONT.y + sideDrop }, { x: FLOOR_LEFT.x, y: FLOOR_LEFT.y + sideDrop }) + '" fill="#4a3522"/>';
  s += '<polygon points="' + points(FLOOR_RIGHT, FLOOR_FRONT, { x: FLOOR_FRONT.x, y: FLOOR_FRONT.y + sideDrop }, { x: FLOOR_RIGHT.x, y: FLOOR_RIGHT.y + sideDrop }) + '" fill="#563721"/>';
  s += '<polyline points="' + points(FLOOR_LEFT, FLOOR_FRONT, FLOOR_RIGHT) + '" fill="none" stroke="#6f4d2a" stroke-width="3"/>';
  s += '<polyline points="' + points({ x: FLOOR_LEFT.x + 3, y: FLOOR_LEFT.y + 1 }, { x: FLOOR_FRONT.x, y: FLOOR_FRONT.y + 1 }, { x: FLOOR_RIGHT.x - 3, y: FLOOR_RIGHT.y + 1 }) + '" fill="none" stroke="rgba(140,104,55,0.28)" stroke-width="1"/>';
  // Organic ground cover replaces the old u/v debug grid + uniform dots:
  // mottled tone patches, small three-blade grass tufts, and sparse flecks,
  // all seated on the floor plane via isoToScreen + the module hash so the
  // layout is deterministic across repaints. The grid read as a game board;
  // a garden floor wants irregular growth.
  for (let i = 0; i < 58; i++) {
    const p = isoToScreen(0.04 + hash(i, 31) * 0.92, 0.04 + hash(i, 47) * 0.92);
    const tone = hash(i, 11) > 0.6 ? season.grassDot : (hash(i, 5) > 0.5 ? season.grassLight : season.floorBack);
    const w = 3 + Math.round(hash(i, 7) * 3);
    s += r(Math.round(p.x), Math.round(p.y), w, 2, tone);
    if (hash(i, 13) > 0.55) s += r(Math.round(p.x + w * 0.4), Math.round(p.y - 2), Math.max(2, w - 2), 2, tone);
  }
  for (let i = 0; i < 22; i++) {
    const p = isoToScreen(0.06 + hash(i + 91, 17) * 0.88, 0.06 + hash(i + 91, 23) * 0.88);
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    s += r(x, y - 4, 1, 4, season.grassDot);
    s += r(x - 2, y - 3, 1, 3, season.grassLight);
    s += r(x + 2, y - 3, 1, 3, season.grassDot);
  }
  for (let i = 0; i < 30; i++) {
    const p = isoToScreen(hash(i + 200, 2), hash(i + 200, 7));
    s += r(Math.round(p.x), Math.round(p.y), 2, 2, hash(i + 200, 11) > 0.5 ? season.grassDot : season.grassLight);
  }
  return s;
}

function renderFence(r) {
  // Post chain traces the two near floor edges, ordered left-rim → front
  // corner → right-rim so the rails can run through them as one polyline.
  // Rails are drawn FIRST so the posts overlap them — without rails the
  // posts read as loose stakes, not a courtyard fence. (The two rim posts
  // that used to float free now anchor the chain's endpoints.)
  const chain = [
    isoToScreen(0.00, 0.62), isoToScreen(0.03, 0.74), isoToScreen(0.14, 0.86),
    isoToScreen(0.26, 0.98), isoToScreen(0.48, 1.00), isoToScreen(0.72, 0.98),
    isoToScreen(0.91, 0.82), isoToScreen(1.00, 0.62)
  ];
  let s = '';
  const rail = (h, w, color) => '<polyline points="'
    + chain.map((p) => p.x.toFixed(1) + ',' + (p.y - h).toFixed(1)).join(' ')
    + '" fill="none" stroke="' + color + '" stroke-width="' + w + '"/>';
  s += rail(17, 2.5, '#4e3520');
  s += rail(8, 2, '#5a3e26');
  for (let i = 0; i < chain.length; i++) {
    const p = chain[i];
    s += r(p.x - 3, p.y - 22, 6, 25, '#5a3b26');
    s += r(p.x - 2, p.y - 22, 4, 4, '#7a5536');
  }
  return s;
}

function renderStars(time) {
  if (time.mode !== 'night') return '';
  let s = '';
  for (let i = 0; i < 54; i++) {
    const x = Math.floor(hash(i, 1) * W);
    const y = Math.floor(hash(i, 2) * 124) + 18;
    const size = hash(i, 3) > 0.86 ? 2 : 1;
    s += '<rect x="' + x + '" y="' + y + '" width="' + size + '" height="' + size + '" fill="' + (hash(i, 4) > 0.6 ? '#f2ead2' : '#b7c1da') + '" opacity="' + (0.45 + hash(i, 5) * 0.45).toFixed(2) + '"/>';
  }
  return s;
}

function renderOrb(time, r, assetRoot) {
  // Sun/moon are PixelLab sprites (assets/sprites/sky/{sun,moon}.png) — the
  // sprite carries its own corona/halo, so no extra gradient is needed. Night
  // uses the moon at its old crescent anchor; day/dusk use the sun at the
  // scene's orb anchor (centered on the old 23×21 orb box).
  const isNight = time.mode === 'night';
  const file = isNight ? 'moon' : 'sun';
  const cx = isNight ? 600 : (time.orbX + 11);
  const cy = isNight ? 80 : (time.orbY + 10);
  const sz = 56;
  return '<image href="' + assetRoot + '/sprites/sky/' + file + '.png" x="' + (cx - sz / 2) +
    '" y="' + (cy - sz / 2) + '" width="' + sz + '" height="' + sz + '" image-rendering="pixelated"/>';
}

function cloud(assetRoot, cx, cy, w) {
  const h = Math.round(w / 2);
  return '<image href="' + assetRoot + '/sprites/critters/cloud.png" x="' + (cx - w / 2) + '" y="' + (cy - h / 2) + '" width="' + w + '" height="' + h + '" preserveAspectRatio="xMidYMid meet" opacity="0.72"/>';
}

// Ripple rings + drifting sparkles around the island slab so it reads as
// sitting IN the water instead of pasted onto the sky gradient. Replaces the
// old renderPetals(): those 16 petals were static rects frozen mid-air (some
// over open water), which read as stray noise — an animated spring-petal pass
// can return later as a DOM layer like the classic renderer's.
// Drawn before the walls/floor, so the island body covers the rings' far side.
function renderWaterContact(time) {
  const drop = 12;
  const L = { x: FLOOR_LEFT.x - 11, y: FLOOR_LEFT.y + 2 + drop };
  const R = { x: FLOOR_RIGHT.x + 11, y: FLOOR_RIGHT.y + 2 + drop };
  const F = { x: FLOOR_FRONT.x, y: FLOOR_FRONT.y + 8 + drop };
  const tone = time.mode === 'night' ? 'rgba(150,170,205,' : 'rgba(224,240,246,';
  let s = '';
  // dark contact band hugging the slab's waterline, so the island presses INTO
  // the water instead of hovering over it (the ripples alone read as drawn-on)
  s += '<polyline points="'
    + (L.x - 2).toFixed(1) + ',' + (L.y + 2).toFixed(1) + ' '
    + F.x.toFixed(1) + ',' + (F.y + 3).toFixed(1) + ' '
    + (R.x + 2).toFixed(1) + ',' + (R.y + 2).toFixed(1)
    + '" fill="none" stroke="rgba(10,16,28,0.18)" stroke-width="6"/>';
  [[7, 0.28], [14, 0.17], [22, 0.09]].forEach(([off, op]) => {
    s += '<polyline points="'
      + (L.x - off * 1.6).toFixed(1) + ',' + (L.y + off * 0.35).toFixed(1) + ' '
      + F.x.toFixed(1) + ',' + (F.y + off).toFixed(1) + ' '
      + (R.x + off * 1.6).toFixed(1) + ',' + (R.y + off * 0.35).toFixed(1)
      + '" fill="none" stroke="' + tone + op + ')" stroke-width="2"/>';
  });
  for (let i = 0; i < 10; i++) {
    const t = hash(i + 300, 3);
    const x = L.x + (R.x - L.x) * t;
    const y = Math.max(L.y, R.y) + 8 + hash(i + 300, 9) * 26;
    s += '<rect x="' + Math.round(x) + '" y="' + Math.round(y) + '" width="2" height="1" fill="' + tone + '0.45)"/>';
  }
  return s;
}

// Near-field life on the open water AROUND the island — the four frame
// corners were flat gradient, which read as "PNG pasted on a void". Corner
// vignettes now give each edge a small subject (stone, reeds, lotus, boat)
// while staying below the garden itself in visual priority. Drawn BEFORE the
// walls / floor, so anything brushing the island silhouette tucks behind it.
function renderWaterLife(time, assetRoot) {
  const night = time.mode === 'night';
  const img = (file, cx, cy, w, h, options = {}) => {
    const opacity = options.opacity == null ? (night ? 0.78 : null) : options.opacity * (night ? 0.78 : 1);
    const opacityAttr = opacity == null ? '' : ' opacity="' + opacity.toFixed(2) + '"';
    return '<image href="' + assetRoot + '/sprites/isometric_generated/' + file + '" x="' + (cx - w / 2) +
      '" y="' + (cy - h) + '" width="' + w + '" height="' + h + '" image-rendering="pixelated"' + opacityAttr + '/>';
  };
  let s = '';

  // Four-corner water dressing. Far corners are small + quieter; near corners
  // carry the visual weight, framing the tray without crowding the courtyard.
  s += img('water_corner_lotus_v1.png', 48, 286, 30, 21, { opacity: 0.76 });
  s += img('water_corner_moss_stones_v1.png', 638, 300, 30, 23, { opacity: 0.72 });
  s += img('water_corner_reeds_v1.png', 36, 404, 34, 34, { opacity: 0.86 });
  s += img('water_corner_lotus_v1.png', 626, 424, 42, 29, { opacity: 0.86 });

  // rocky islets: bottom-left hero, bottom-right smaller, far-left echo
  s += img('water_islet_iso_v2_pine.png', 150, 412, 64, 64);
  s += img('water_islet_iso_v2_rocks.png', 566, 392, 44, 44);
  s += img('water_islet_iso_v2_rocks.png', 86, 312, 30, 30);
  // Existing lower-corner subjects: reeds flank both islets, a moored rowboat
  // drifts on the left open water, and an egret stands watch on the right rocks.
  s += img('water_reeds_iso_v2.png', 196, 424, 30, 40);
  s += img('water_reeds_iso_v2.png', 612, 408, 26, 35);
  s += img('water_boat_iso_v2.png', 100, 352, 48, 36);
  s += img('water_egret_iso_v2.png', 569, 374, 32, 32);
  // lotus drifts (flat on the water: height ≈ 2/3 width per the 96×64 sprite)
  s += img('water_lotus_iso_v2.png', 256, 420, 44, 29);
  s += img('water_lotus_iso_v2.png', 500, 408, 36, 24);
  s += img('water_corner_moss_stones_v1.png', 450, 428, 32, 25, { opacity: 0.82 });
  // koi silhouettes with ripple rings — daytime/dusk accents (they'd glow at
  // night; the courtyard pond keeps its own koi around the clock)
  if (!night) {
    const koi = (cx, cy, flip) => {
      const rings = '<ellipse cx="' + cx + '" cy="' + cy + '" rx="11" ry="5" fill="none" stroke="rgba(228,242,246,0.35)" stroke-width="1"/>'
        + '<ellipse cx="' + cx + '" cy="' + cy + '" rx="17" ry="8" fill="none" stroke="rgba(228,242,246,0.18)" stroke-width="1"/>';
      let body = '<rect x="' + (cx - 4) + '" y="' + (cy - 2) + '" width="7" height="3" fill="#d8763c"/>'
        + '<rect x="' + (cx - 1) + '" y="' + (cy - 2) + '" width="3" height="3" fill="#f2ede2"/>'
        + '<rect x="' + (cx + 3) + '" y="' + (cy - 1) + '" width="2" height="2" fill="#d8763c"/>';
      if (flip) body = '<g transform="translate(' + (2 * cx) + ' 0) scale(-1 1)">' + body + '</g>';
      return rings + body;
    };
    s += koi(118, 352, false);
    s += koi(598, 414, true);
    // low waterbirds skimming the left open water
    s += '<image href="' + assetRoot + '/sprites/critters/bird.png" x="88" y="200" width="16" height="11" image-rendering="pixelated"/>';
    s += '<image href="' + assetRoot + '/sprites/critters/bird.png" x="120" y="212" width="13" height="9" image-rendering="pixelated" transform="translate(253 0) scale(-1 1)"/>';
  }
  return s;
}

function resolveTimeScene(settings) {
  const forced = settings?.appearance?.time_mode || 'system';
  const hour = new Date().getHours() + new Date().getMinutes() / 60;
  const mode = forced === 'system' ? systemTimeMode(hour) : forced;
  const scenes = {
    day: {
      mode: 'day',
      label: t('time.day'),
      skyTop: '#6ca7df',
      skyMid: '#91bfdf',
      skyBottom: '#b1cfe0',
      // Warmed toward the flat view's sandstone ramp (scene-tiles WALL_PAL
      // #b8a079 family) so the two views read as the same wall material.
      // Dusk/night keep their own darker sets — time shading stays intact.
      wallLight: '#b09d80',
      wallMid: '#98866d',
      wallDark: '#7f6e58',
      wallEdge: '#443321',
      mountainFarOpacity: 0.38,
      mountainNearOpacity: 0.48,
      orbX: 514,
      orbY: 56,
      orb: '#f0ca72',
    },
    dusk: {
      mode: 'dusk',
      label: t('time.dusk'),
      skyTop: '#29304f',
      skyMid: '#3c4262',
      skyBottom: '#78634e',
      wallLight: '#8a7a64',
      wallMid: '#73644f',
      wallDark: '#61513f',
      wallEdge: '#3b2a1c',
      mountainFarOpacity: 0.46,
      mountainNearOpacity: 0.56,
      orbX: 560,
      orbY: 76,
      orb: '#dfa067',
    },
    night: {
      mode: 'night',
      label: t('time.night'),
      skyTop: '#0b0d18',
      skyMid: '#101a35',
      skyBottom: '#1e2944',
      wallLight: '#756b5a',
      wallMid: '#665b4c',
      wallDark: '#574b3c',
      wallEdge: '#30251b',
      mountainFarOpacity: 0.36,
      mountainNearOpacity: 0.48,
      orbX: 592,
      orbY: 82,
      orb: '#d6d6c8',
    },
  };
  return scenes[mode] || scenes.day;
}

function resolveSeasonScene(settings) {
  const forced = settings?.appearance?.season_mode || 'system';
  const now = new Date();
  const mode = forced === 'system' ? systemSeasonMode(now) : forced;
  const palettes = {
    // spring/summer greens pulled slightly gray-ward: the old values read
    // saturated against the muted painterly backdrop once the floor lost its
    // grid (flat expanses amplify chroma). autumn/winter were already muted.
    spring: { mode: 'spring', label: t('season.spring'), floorBack: '#456939', floorFront: '#55763e', grassDot: '#2c4b23', grassLight: '#6e9850' },
    summer: { mode: 'summer', label: t('season.summer'), floorBack: '#3e6537', floorFront: '#4b733c', grassDot: '#274723', grassLight: '#659446' },
    autumn: { mode: 'autumn', label: t('season.autumn'), floorBack: '#746832', floorFront: '#877238', grassDot: '#4f421e', grassLight: '#9a8248' },
    winter: { mode: 'winter', label: t('season.winter'), floorBack: '#687866', floorFront: '#7d8979', grassDot: '#4d5d51', grassLight: '#9fac9f' },
  };
  return palettes[mode] || palettes.spring;
}

function systemTimeMode(hour) {
  if (hour >= 6 && hour < 16.5) return 'day';
  if (hour >= 16.5 && hour < 19.5) return 'dusk';
  return 'night';
}

function systemSeasonMode(date) {
  const month = date.getMonth() + 1;
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
}

function hash(a, b) {
  const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function lerpPoint(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

function points(...items) {
  return items.map((p) => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function escapeText(value) {
  return String(value).replace(/[&<>]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
  })[char]);
}
