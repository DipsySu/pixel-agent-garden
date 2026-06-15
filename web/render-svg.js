import { t } from './i18n.js';

export function renderBaseScene(scene, assetRoot, options = {}) {
  const W = 680, H = 440;
  const r = (x, y, w, h, c) => '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + c + '"/>';
  function hash(a, b) {
    const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
    return x - Math.floor(x);
  }
  const time = resolveTimeScene(options.settings);
  const season = resolveSeasonScene(options.settings);

  let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" preserveAspectRatio="xMidYMid meet" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg" role="img"><title>' + t('svg.title', { time: time.label }) + '</title><desc>' + t('svg.desc') + '</desc>';
  // <defs> — soft radial gradient for the setting-sun halo. Replaces the
  // earlier rectangular halo which showed as ghost squares against the
  // mountain sprites once those went sprite-art.
  //
  // Sky gradient: before this lived as two solid rects (skyTop/skyBottom)
  // meeting at y=70 with no blend, which read as a hard horizontal seam —
  // especially obvious at dusk (gray-blue → orange). The shadeDeep stop in
  // the middle smooths the transition without losing the warm-bottom look.
  s += '<defs>'
     + '<radialGradient id="pg6SunGlow" cx="50%" cy="50%" r="50%">'
     +   '<stop offset="0%"   stop-color="' + time.glow + '" stop-opacity="' + time.glowOpacity + '"/>'
     +   '<stop offset="45%"  stop-color="' + time.glow + '" stop-opacity="' + (time.glowOpacity * 0.42).toFixed(2) + '"/>'
     +   '<stop offset="100%" stop-color="#f8b870" stop-opacity="0"/>'
     + '</radialGradient>'
     + '<linearGradient id="pg6Sky" x1="0" y1="0" x2="0" y2="1">'
     +   '<stop offset="0%" stop-color="' + time.skyTop + '"/>'
     +   '<stop offset="55%" stop-color="' + (time.skyMid || blend(time.skyTop, time.skyBottom, 0.5)) + '"/>'
     +   '<stop offset="100%" stop-color="' + time.skyBottom + '"/>'
     + '</linearGradient>'
     + '<linearGradient id="pg6WoodShadow" x1="0" y1="0" x2="0" y2="1">'
     +   '<stop offset="0%" stop-color="' + time.wood[2] + '" stop-opacity="0.85"/>'
     +   '<stop offset="100%" stop-color="' + time.wood[2] + '" stop-opacity="0"/>'
     + '</linearGradient>'
     + '</defs>';

  // === Wooden awning ============================================
  // Top eave with subtle pixel-art grain (knots + grooves).
  s += r(0, 0, W, 14, time.wood[0]);
  s += r(0, 14, W, 6, time.wood[1]);
  s += r(0, 20, W, 4, time.wood[2]);
  // Sky is one tall rect filled with the linear gradient defined above —
  // no more hard y=70 seam between skyTop and skyBottom.
  s += '<rect x="0" y="24" width="' + W + '" height="86" fill="url(#pg6Sky)"/>';
  // Soft shadow drop from the wood eave onto the top of the sky band; this
  // hides the otherwise-jarring wood→sky transition without losing the eave.
  s += '<rect x="0" y="24" width="' + W + '" height="10" fill="url(#pg6WoodShadow)"/>';
  // grain: short darker pixel runs at irregular x positions
  for (let i = 0; i < 26; i++) {
    const gx = Math.floor(hash(i + 41, 9) * W);
    const gy = 3 + Math.floor(hash(i + 7, 13) * 4);
    const gw = 6 + Math.floor(hash(i, 19) * 14);
    if (hash(i + 71, 5) > 0.5) s += r(gx, gy, gw, 1, '#a87248');
    else s += r(gx, gy + 4, gw, 1, '#8a5a30');
  }
  // small knots
  for (let i = 0; i < 5; i++) {
    const kx = 40 + i * 130 + Math.floor(hash(i, 11) * 30);
    s += r(kx, 5, 3, 3, '#6a4020');
    s += r(kx, 5, 1, 1, '#3a2410');
  }

  // === Sky / clouds =============================================
  // Soft cream-pink cloud silhouettes BEFORE mountains so they sit
  // farther back in z-order.
  const clouds = [
    [60, 42, 38, 5, time.cloud[0]],
    [110, 38, 22, 4, time.cloud[1]],
    [320, 48, 30, 4, time.cloud[2]],
    [600, 38, 46, 5, time.cloud[0]]
  ];
  if (time.mode !== 'night') {
    for (const [cx, cy, cw, ch, col] of clouds) {
      // pixel-art puff: 3 vertically stacked rects of decreasing width
      s += r(cx, cy, cw, ch, col);
      s += r(cx + 3, cy - 3, cw - 6, 3, col);
      s += r(cx + 8, cy - 5, Math.max(2, cw - 16), 2, col);
    }
  } else {
    for (let i = 0; i < 34; i++) {
      if (hash(i, 92) > 0.34) {
        const sx = Math.floor(hash(i, 17) * W);
        const sy = 30 + Math.floor(hash(i, 29) * 60);
        const size = hash(i, 41) > 0.82 ? 2 : 1;
        s += r(sx, sy, size, size, hash(i, 53) > 0.72 ? '#f0e6c8' : '#d8e0f0');
      }
    }
  }

  // === Sun / moon ===============================================
  // The halo is now a single SVG circle filled with a radial gradient — old
  // rgba rectangles showed as flat ghost squares against the mountain sprites.
  const sunX = time.orb.x, sunY = time.orb.y;
  // halo behind everything (will be partly covered by mountains, that's fine
  // — it pre-tints the sky so the horizon picks up dusk warmth)
  s += '<circle cx="' + (sunX + 13) + '" cy="' + (sunY + 11) + '" r="38" fill="url(#pg6SunGlow)"/>';
  // sun core (pixel-art disc)
  s += r(sunX, sunY, 26, 22, time.orb.fill);
  s += r(sunX + 4, sunY - 4, 18, 4, time.orb.fill);
  s += r(sunX + 4, sunY + 22, 18, 3, time.orb.shadow);
  s += r(sunX - 3, sunY + 6, 3, 14, time.orb.fill);
  s += r(sunX + 26, sunY + 6, 3, 14, time.orb.fill);
  s += r(sunX - 8, sunY + 10, 4, 6, time.orb.highlight);
  s += r(sunX + 30, sunY + 8, 4, 6, time.orb.highlight);
  // inner highlight
  s += r(sunX + 6, sunY + 4, 6, 4, time.orb.highlight);
  s += r(sunX + 14, sunY + 12, 4, 3, time.orb.accent);

  // === Mountains ================================================
  s += '<image href="' + assetRoot + '/sprites/mountains/mountains_far.png" x="-12" y="54" width="704" height="40" preserveAspectRatio="none" opacity="' + time.mountainFarOpacity + '"/>';
  // mountains_near now reaches y=110 (wall top, WT) so the silhouette meets
  // the brick wall edge without leaving a thin sky strip. Height bumped from
  // 34 to 38.
  s += '<image href="' + assetRoot + '/sprites/mountains/mountains_near.png" x="-10" y="72" width="700" height="38" preserveAspectRatio="none" opacity="' + time.mountainNearOpacity + '"/>';

  // Re-draw the sun in front of the mountain sprites; the first pass above
  // tints the horizon, this pass keeps the core readable. Halo is the same
  // radial gradient — softer than the original rectangle outlines.
  s += '<circle cx="' + (sunX + 13) + '" cy="' + (sunY + 11) + '" r="30" fill="url(#pg6SunGlow)" opacity="' + time.frontGlowOpacity + '"/>';
  s += r(sunX, sunY, 26, 22, time.orb.fill);
  s += r(sunX + 4, sunY - 4, 18, 4, time.orb.fill);
  s += r(sunX + 4, sunY + 22, 18, 3, time.orb.shadow);
  s += r(sunX - 3, sunY + 6, 3, 14, time.orb.fill);
  s += r(sunX + 26, sunY + 6, 3, 14, time.orb.fill);
  s += r(sunX + 6, sunY + 4, 6, 4, time.orb.highlight);

  // birds — kept; they're tiny accents
  if (time.mode !== 'night') {
    s += '<polyline points="285,68 290,65 295,68" stroke="#2a1d10" stroke-width="1" fill="none"/>';
    s += '<polyline points="300,72 305,69 310,72" stroke="#2a1d10" stroke-width="1" fill="none"/>';
    s += '<polyline points="430,60 437,56 444,60" stroke="#2a1d10" stroke-width="1" fill="none"/>';
  }

  const WT = 110, WB = 380;
  const BW = 40, BH = 20;
  s += r(0, WT, W, WB - WT, '#48382a');

  const bricks = ['#9e8268', '#8c7058', '#a68a72', '#7a6048', '#94795f', '#b09682', '#82684f', '#a89072'];
  let rowI = 0;
  for (let y = WT; y < WB; y += BH) {
    const off = (rowI % 2) * (BW / 2);
    for (let col = -1; col * BW + off < W + BW; col++) {
      const bx = col * BW + off;
      const ci = Math.floor(hash(col + 50, rowI) * bricks.length);
      s += r(bx + 1, y + 1, BW - 2, BH - 2, bricks[ci]);
      if (hash(col + 13, rowI + 7) > 0.84) s += r(bx + 8, y + 8, 3, 2, '#5a4030');
      if (hash(col + 31, rowI + 19) > 0.92) s += r(bx + 24, y + 13, 2, 2, '#6e5440');
    }
    rowI++;
  }

  s += r(580, 180, 35, 30, 'rgba(40,28,18,0.18)');
  s += r(595, 168, 22, 14, 'rgba(40,28,18,0.12)');

  s += r(0, WB - 4, 50, 10, 'rgba(60,100,40,0.35)');
  s += r(0, WB - 8, 36, 8, 'rgba(70,110,45,0.4)');
  s += r(0, WB - 14, 22, 8, 'rgba(80,120,50,0.35)');
  s += r(0, WB - 22, 14, 8, 'rgba(70,110,45,0.3)');

  const scx = 388, scy = WT - 8;
  s += r(scx, scy + 4, 6, 4, '#4a4842');
  s += r(scx + 1, scy + 1, 4, 4, '#4a4842');
  s += r(scx, scy + 2, 2, 2, '#4a4842');
  s += r(scx + 4, scy + 2, 2, 2, '#4a4842');
  s += r(scx + 1, scy + 3, 1, 1, '#1a1a14');
  s += r(scx + 4, scy + 3, 1, 1, '#1a1a14');
  s += r(scx + 6, scy + 5, 4, 2, '#4a4842');
  s += r(scx - 1, scy + 7, 9, 1, '#3a3832');

  // Ground band colors — season-driven. Spring/summer keep the lush greens;
  // autumn shifts toward warm ochres; winter goes cool gray-green with a
  // dusting of frost. The dirt strip at the very bottom is always dark.
  s += r(0, WB, W, H - WB, '#3a2a1a');
  s += r(0, WB - 2, W, 6, season.grass[0]);
  s += r(0, WB + 4, W, 12, season.grass[1]);
  s += r(0, WB + 16, W, 12, season.grass[2]);
  s += r(0, WB + 28, W, H - WB - 28, season.grass[3]);
  for (let i = 0; i < 80; i++) {
    const gx = (i * 11 + 5) % W;
    const gy = WB + 6 + (i % 5) * 6;
    const gh = 2 + Math.floor(hash(i, 5) * 3);
    s += r(gx, gy, 2, gh, season.grassDots);
  }
  // Flower spread varies by season — spring/summer get the full bouquet,
  // autumn switches to warm tones, winter is sparse.
  const flCol = season.flowers;
  const flowerCount = season.flowerCount;
  for (let i = 0; i < flowerCount; i++) {
    const fx = (i * 19 + 11) % W;
    const fy = WB + 12 + (i % 4) * 8;
    s += r(fx, fy, 2, 2, flCol[i % flCol.length]);
  }

  const gx = 480, gy = 220;
  for (let i = 0; i < 22; i++) s += r(gx + i * 2, gy, 2, 3, '#6a8244');
  for (let i = 2; i < 20; i++) s += r(gx + i * 2, gy + 2, 2, 1, '#8aa05a');
  s += r(gx + 44, gy + 1, 6, 2, '#6a8244');
  s += r(gx + 50, gy + 1, 5, 1, '#4a6230');
  s += r(gx - 5, gy - 1, 5, 3, '#6a8244');
  s += r(gx - 3, gy, 1, 1, '#1a1a0a');
  s += r(gx + 6, gy + 3, 2, 3, '#6a8244');
  s += r(gx + 5, gy + 5, 4, 1, '#6a8244');
  s += r(gx + 32, gy + 3, 2, 3, '#6a8244');
  s += r(gx + 31, gy + 5, 4, 1, '#6a8244');

  function butterfly(cx, cy, c1, c2) {
    cx = Math.round(cx); cy = Math.round(cy);
    return r(cx - 3, cy - 3, 3, 3, c1) + r(cx + 1, cy - 3, 3, 3, c1) + r(cx - 3, cy + 1, 3, 2, c2) + r(cx + 1, cy + 1, 3, 2, c2) + r(cx, cy - 2, 1, 5, '#2a1d10') + r(cx - 2, cy - 2, 1, 1, '#3a2a1a') + r(cx + 2, cy - 2, 1, 1, '#3a2a1a');
  }
  s += butterfly(230, 340, '#f4d878', '#e8b04a');
  s += butterfly(160, 380, '#f0c468', '#d49838');
  s += butterfly(470, 320, '#f4d878', '#e8b04a');

  for (let i = 0; i < 8; i++) {
    const px = 140 + i * 60 + (i % 3) * 15;
    const py = 420 + (i % 2) * 6;
    s += r(px, py, 2, 2, '#f4b8c8');
    if (hash(i, 22) > 0.5) s += r(px + 30, py + 3, 1, 1, '#f8c4d4');
  }

  s += '</svg>';

  scene.innerHTML = s +
    '<div class="pg6-info" aria-live="polite" role="status">' +
      '<div class="pg6-info-label" id="garden-info-label">' + t('card.project.label') + '</div>' +
      '<div class="pg6-info-name" id="garden-info-name">' + t('card.project.defaultName') + '</div>' +
      '<div class="pg6-info-row"><span id="garden-info-total">' + t('card.total', { total: '580k' }) + '</span><span id="garden-info-stage">' + t('card.stage', { stage: 4 }) + '</span></div>' +
      '<div class="pg6-info-bar"><div class="pg6-info-fill" id="garden-info-fill"></div></div>' +
      '<div class="pg6-info-detail" id="garden-info-detail"></div>' +
      '<div class="pg6-info-spark" id="garden-info-spark" aria-hidden="true"></div>' +
    '</div>';
  scene.dataset.timeMode = time.mode;
  scene.dataset.timeLabel = time.label;
  scene.dataset.motion = options.settings?.appearance?.motion || 'system';
  // Season drives both the SVG ground/flower colors above AND a CSS-level
  // hue/saturation tweak applied to sprites in index.html so the cherry,
  // willow, vines, etc. react too.
  scene.dataset.season = season.mode;
  scene.dataset.seasonLabel = season.label;
}

// Mix two hex colors by `t` in [0,1]. Used when a scene config doesn't ship
// an explicit skyMid stop — gives the gradient a sensible middle anchor.
function blend(a, b, t) {
  const pa = parseHex(a);
  const pb = parseHex(b);
  if (!pa || !pb) return a;
  const r = Math.round(pa[0] + (pb[0] - pa[0]) * t);
  const g = Math.round(pa[1] + (pb[1] - pa[1]) * t);
  const bl = Math.round(pa[2] + (pb[2] - pa[2]) * t);
  return '#' + [r, g, bl].map((v) => v.toString(16).padStart(2, '0')).join('');
}

function parseHex(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function resolveTimeScene(settings) {
  const forced = settings?.appearance?.time_mode || 'system';
  const now = new Date();
  const hour = now.getHours() + now.getMinutes() / 60;
  const mode = forced === 'system' ? systemTimeMode(hour) : forced;
  const dayProgress = Math.max(0, Math.min(1, (hour - 6) / 12));
  const sunArcY = Math.round(72 - Math.sin(dayProgress * Math.PI) * 42);
  const sunArcX = Math.round(-20 + dayProgress * 720);
  const scenes = {
    day: {
      mode: 'day',
      label: t('time.day'),
      skyTop: '#7fb7e8',
      skyMid: '#a5cce8',
      skyBottom: '#b9d8ea',
      cloud: ['#f5efe4', '#fff4e8', '#e8ddcf'],
      glow: '#f8d078',
      glowOpacity: 0.42,
      frontGlowOpacity: 0.55,
      orb: { x: forced === 'system' ? sunArcX : 330, y: forced === 'system' ? sunArcY : 34, fill: '#f0c868', shadow: '#d8a34f', highlight: '#ffe090', accent: '#f0b460' },
      wood: ['#d4a070', '#a07248', '#604028'],
      mountainFarOpacity: 0.42,
      mountainNearOpacity: 0.52
    },
    dusk: {
      mode: 'dusk',
      label: t('time.dusk'),
      skyTop: '#8ea2c8',
      // Pinkish middle softens the gray-blue → orange jump; the old setup
      // had a sharp seam at y=70 between these two stops.
      skyMid: '#cba7a5',
      skyBottom: '#e4a174',
      cloud: ['#f0d0c0', '#f4d8c8', '#e8c4b8'],
      glow: '#f8b870',
      glowOpacity: 0.62,
      frontGlowOpacity: 0.85,
      orb: { x: forced === 'system' ? Math.max(500, sunArcX) : 530, y: forced === 'system' ? Math.max(42, sunArcY) : 46, fill: '#f0a060', shadow: '#e08850', highlight: '#f8b870', accent: '#f4a458' },
      wood: ['#c69062', '#8e623e', '#4d3322'],
      mountainFarOpacity: 0.50,
      mountainNearOpacity: 0.58
    },
    night: {
      mode: 'night',
      label: t('time.night'),
      skyTop: '#17213a',
      skyMid: '#1e2a44',
      skyBottom: '#273452',
      cloud: ['#56627b', '#66708a', '#4e5870'],
      glow: '#d8e6ff',
      glowOpacity: 0.34,
      frontGlowOpacity: 0.46,
      orb: { x: 520, y: 34, fill: '#dbe4f0', shadow: '#a8b3c6', highlight: '#f0f4ff', accent: '#c8d4e8' },
      wood: ['#8f6748', '#5e432e', '#2f241e'],
      mountainFarOpacity: 0.38,
      mountainNearOpacity: 0.48
    }
  };
  return scenes[mode] || scenes.day;
}

function systemTimeMode(hour) {
  if (hour >= 6 && hour < 16.5) return 'day';
  if (hour >= 16.5 && hour < 19.5) return 'dusk';
  return 'night';
}

// Resolve the season-driven palette: ground band greens, grass flecks, and
// the wildflower carpet. The scene also writes `dataset.season` so CSS in
// index.html can apply a per-season tint to sprites (cherry, willow, vines).
function resolveSeasonScene(settings) {
  const forced = settings?.appearance?.season_mode || 'system';
  const now = new Date();
  const mode = forced === 'system' ? systemSeasonMode(now) : forced;
  const palettes = {
    spring: {
      mode: 'spring',
      label: t('season.spring'),
      grass: ['#4f7228', '#5e8a32', '#6e9a38', '#5e7c2a'],
      grassDots: '#3a5520',
      flowers: ['#f4b8c8', '#f0c068', '#e08aa0', '#f0e090', '#d870a0', '#f8e8ec'],
      flowerCount: 56
    },
    summer: {
      mode: 'summer',
      label: t('season.summer'),
      grass: ['#3f6b22', '#4f8030', '#5e9230', '#4f7022'],
      grassDots: '#2e4a18',
      flowers: ['#f0c068', '#e8a058', '#f0e090', '#f4b06a', '#e89048'],
      flowerCount: 38
    },
    autumn: {
      mode: 'autumn',
      label: t('season.autumn'),
      grass: ['#8a6a24', '#a07c2c', '#b08832', '#8e6628'],
      grassDots: '#5a4218',
      flowers: ['#d8682a', '#c4521e', '#e89c44', '#f0b860', '#a8401a'],
      flowerCount: 32
    },
    winter: {
      mode: 'winter',
      label: t('season.winter'),
      grass: ['#6b7c64', '#7e8c76', '#8e9c84', '#73826c'],
      grassDots: '#52604c',
      flowers: ['#e8eef0', '#cfd6da', '#f0f4f6'],
      flowerCount: 14
    }
  };
  return palettes[mode] || palettes.spring;
}

function systemSeasonMode(date) {
  const m = date.getMonth() + 1;
  if (m === 12 || m <= 2) return 'winter';
  if (m <= 5) return 'spring';
  if (m <= 8) return 'summer';
  return 'autumn';
}
