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
  }
  s += renderOrb(time, r, assetRoot);
  s += '<image href="' + assetRoot + '/sprites/mountains/mountains_far.png" x="-18" y="104" width="716" height="54" preserveAspectRatio="none" opacity="' + time.mountainFarOpacity + '"/>';
  s += '<image href="' + assetRoot + '/sprites/mountains/mountains_near.png" x="-20" y="124" width="720" height="60" preserveAspectRatio="none" opacity="' + time.mountainNearOpacity + '"/>';

  s += renderBackWalls(time, r);
  s += renderFloor(season, r);
  s += renderFence(r);
  s += renderPetals();
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
  for (let i = 1; i < 7; i++) {
    const a = i / 7;
    const leftBottom = lerpPoint(FLOOR_LEFT, FLOOR_TOP, a);
    const leftTop = lerpPoint(WALL_LEFT_TOP, WALL_CORNER_TOP, a);
    const rightBottom = lerpPoint(FLOOR_TOP, FLOOR_RIGHT, a);
    const rightTop = lerpPoint(WALL_CORNER_TOP, WALL_RIGHT_TOP, a);
    s += '<line x1="' + leftBottom.x.toFixed(1) + '" y1="' + leftBottom.y.toFixed(1) + '" x2="' + leftTop.x.toFixed(1) + '" y2="' + leftTop.y.toFixed(1) + '" stroke="rgba(56,44,33,0.26)" stroke-width="2"/>';
    s += '<line x1="' + rightBottom.x.toFixed(1) + '" y1="' + rightBottom.y.toFixed(1) + '" x2="' + rightTop.x.toFixed(1) + '" y2="' + rightTop.y.toFixed(1) + '" stroke="rgba(56,44,33,0.30)" stroke-width="2"/>';
  }
  for (let i = 1; i < 4; i++) {
    const a = i / 4;
    const left = lerpPoint(WALL_LEFT_TOP, FLOOR_LEFT, a);
    const corner = lerpPoint(WALL_CORNER_TOP, FLOOR_TOP, a);
    const right = lerpPoint(WALL_RIGHT_TOP, FLOOR_RIGHT, a);
    s += '<polyline points="' + points(left, corner, right) + '" fill="none" stroke="rgba(56,44,33,0.22)" stroke-width="2"/>';
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
  for (let i = 1; i < 9; i++) {
    const t = i / 9;
    const a = isoToScreen(t, 0);
    const b = isoToScreen(t, 1);
    const c = isoToScreen(0, t);
    const d = isoToScreen(1, t);
    s += '<line x1="' + a.x.toFixed(1) + '" y1="' + a.y.toFixed(1) + '" x2="' + b.x.toFixed(1) + '" y2="' + b.y.toFixed(1) + '" stroke="rgba(34,52,26,0.12)" stroke-width="1"/>';
    s += '<line x1="' + c.x.toFixed(1) + '" y1="' + c.y.toFixed(1) + '" x2="' + d.x.toFixed(1) + '" y2="' + d.y.toFixed(1) + '" stroke="rgba(34,52,26,0.12)" stroke-width="1"/>';
  }
  for (let i = 0; i < 42; i++) {
    const p = isoToScreen(hash(i, 2), hash(i, 7));
    const c = hash(i, 11) > 0.5 ? season.grassDot : season.grassLight;
    s += r(Math.round(p.x), Math.round(p.y), 2, 2, c);
  }
  return s;
}

function renderFence(r) {
  const posts = [
    isoToScreen(0.03, 0.74), isoToScreen(0.14, 0.86), isoToScreen(0.26, 0.98),
    isoToScreen(0.48, 1.00), isoToScreen(0.72, 0.98), isoToScreen(0.91, 0.82),
    isoToScreen(1.00, 0.62), isoToScreen(0.00, 0.62)
  ];
  let s = '';
  for (let i = 0; i < posts.length; i++) {
    const p = posts[i];
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

function renderPetals() {
  let s = '';
  for (let i = 0; i < 16; i++) {
    const x = Math.round(70 + hash(i, 13) * 560);
    const y = Math.round(76 + hash(i, 17) * 330);
    s += '<rect x="' + x + '" y="' + y + '" width="4" height="3" fill="#d9a1b3" opacity="' + (0.25 + hash(i, 19) * 0.45).toFixed(2) + '" transform="rotate(' + Math.round(hash(i, 23) * 30 - 15) + ' ' + x + ' ' + y + ')"/>';
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
      wallLight: '#9a8b74',
      wallMid: '#83745f',
      wallDark: '#6f604d',
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
    spring: { mode: 'spring', label: t('season.spring'), floorBack: '#426f35', floorFront: '#527d38', grassDot: '#2c4b23', grassLight: '#6e9850' },
    summer: { mode: 'summer', label: t('season.summer'), floorBack: '#386b32', floorFront: '#477d36', grassDot: '#274723', grassLight: '#659446' },
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
