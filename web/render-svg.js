import { t } from './i18n.js';
import { wallPattern, pathPattern } from './scene-tiles.js';

export function renderBaseScene(scene, assetRoot, options = {}) {
  const W = 680, H = 440;
  // === Scene geometry (single source of truth) =================
  // The wall used to start at y=110 and run to y=380 — ~61% of the frame, which
  // read as cramped and heavy. Dropping the wall top to 158 and the wall bottom
  // to 330 grows the sky to ~30% and the courtyard band, matching the design
  // mockup's airier composition. Everything that anchors to the wall reads off
  // these consts (and the dataset emitted at the end) instead of hard-coding.
  const EAVE_H = 24;          // wooden awning across the very top
  const WT = 158;             // wall top  (was 110)
  const WB = 330;             // wall bottom (was 380)
  const SKY_H = WT - EAVE_H;  // 134 (was 86)
  const GROUND_H = H - WB;    // 110 — courtyard/grass band height
  const PATH_Y = H - 48;      // 392 — flagstone path baseline (kept at old y)
  const r = (x, y, w, h, c) => '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + c + '"/>';
  function hash(a, b) {
    const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
    return x - Math.floor(x);
  }
  const time = resolveTimeScene(options.settings);
  const season = resolveSeasonScene(options.settings);
  // Flowerbed mode: when enabled, the grass-band foreground is replaced by
  // a dirt strip so the 366 flower sprites have a clean substrate to bloom
  // out of (see render-flowerbed.js + render-garden.js). Honor an explicit
  // boolean override (URL query in garden.js) over the settings value so
  // PoC reviewers don't have to persist the toggle.
  const flowerbedEnabled = typeof options.flowerbedEnabled === 'boolean'
    ? options.flowerbedEnabled
    : options.settings?.appearance?.flowerbed === 'enabled';

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
     // Night/dusk light effects (painted by the atmosphere block before </svg>):
     // a warm lantern pool, a wider cool moon glow, a corner vignette, a
     // top-down darkening, plus a faint daytime sun-wash + soft day vignette.
     + '<radialGradient id="pg6LampGlow" cx="50%" cy="50%" r="50%">'
     +   '<stop offset="0%"   stop-color="#ffe6ad" stop-opacity="0.62"/>'
     +   '<stop offset="42%"  stop-color="#ffbe6e" stop-opacity="0.26"/>'
     +   '<stop offset="100%" stop-color="#ffb060" stop-opacity="0"/>'
     + '</radialGradient>'
     + '<radialGradient id="pg6MoonGlow" cx="50%" cy="50%" r="50%">'
     +   '<stop offset="0%"   stop-color="#eef4ff" stop-opacity="0.52"/>'
     +   '<stop offset="55%"  stop-color="#ccdcfb" stop-opacity="0.15"/>'
     +   '<stop offset="100%" stop-color="#ccdcfb" stop-opacity="0"/>'
     + '</radialGradient>'
     + '<radialGradient id="pg6NightVignette" cx="50%" cy="72%" r="80%">'
     +   '<stop offset="0%"   stop-color="#080b16" stop-opacity="0"/>'
     +   '<stop offset="56%"  stop-color="#080b16" stop-opacity="0"/>'
     +   '<stop offset="100%" stop-color="#080b16" stop-opacity="1"/>'
     + '</radialGradient>'
     + '<linearGradient id="pg6NightTop" x1="0" y1="0" x2="0" y2="1">'
     +   '<stop offset="0%"  stop-color="#06090f" stop-opacity="0.58"/>'
     +   '<stop offset="42%" stop-color="#06090f" stop-opacity="0.40"/>'
     +   '<stop offset="74%" stop-color="#06090f" stop-opacity="0"/>'
     + '</linearGradient>'
     + '<radialGradient id="pg6DaySun" cx="48%" cy="8%" r="72%">'
     +   '<stop offset="0%"   stop-color="#fff4d6" stop-opacity="0.20"/>'
     +   '<stop offset="45%"  stop-color="#fff4d6" stop-opacity="0.05"/>'
     +   '<stop offset="100%" stop-color="#fff4d6" stop-opacity="0"/>'
     + '</radialGradient>'
     + '<radialGradient id="pg6DayVignette" cx="50%" cy="54%" r="76%">'
     +   '<stop offset="0%"   stop-color="#241d12" stop-opacity="0"/>'
     +   '<stop offset="62%"  stop-color="#241d12" stop-opacity="0"/>'
     +   '<stop offset="100%" stop-color="#241d12" stop-opacity="0.32"/>'
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
     + wallPattern()
     + pathPattern()
     + '</defs>';

  // === Wooden awning ============================================
  // Top eave with subtle pixel-art grain (knots + grooves).
  s += r(0, 0, W, 14, time.wood[0]);
  s += r(0, 14, W, 6, time.wood[1]);
  s += r(0, 20, W, 4, time.wood[2]);
  // Sky is one tall rect filled with the linear gradient defined above —
  // no more hard y=70 seam between skyTop and skyBottom.
  s += '<rect x="0" y="24" width="' + W + '" height="' + SKY_H + '" fill="url(#pg6Sky)"/>';
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
  // PixelLab cloud sprite (critters/cloud.png, 96x48) replaces the old
  // stacked-rect puffs. [cx, cy, width]; height derives from the 2:1 aspect.
  // Daytime/dusk only; night shows stars below.
  const clouds = [
    [72, 42, 88],
    [300, 36, 60],
    [605, 40, 96],
    [470, 28, 50]
  ];
  if (time.mode !== 'night') {
    for (const [cx, cy, cw] of clouds) {
      s += critter('cloud.png', cx, cy, cw, Math.round(cw / 2), false);
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
  // Sun/moon are PixelLab sprites (assets/sprites/sky/{sun,moon}.png) instead of
  // a hand-plotted pixel disc. orbImage(x, y) takes the same (x,y) orb anchor as
  // the old disc and draws the sprite centered on it; day/dusk show the sun,
  // night the moon. Shared by the front pass + the night-bloom restamp.
  const orbFile = time.mode === 'night' ? 'moon' : 'sun';
  const ORB = 50;
  const orbImage = (x, y) =>
    '<image href="' + assetRoot + '/sprites/sky/' + orbFile + '.png" x="' + (x + 13 - ORB / 2) + '" y="' + (y + 11 - ORB / 2) + '" width="' + ORB + '" height="' + ORB + '" image-rendering="pixelated"/>';
  // halo behind everything (will be partly covered by mountains, that's fine
  // — it pre-tints the sky so the horizon picks up dusk warmth)
  s += '<circle cx="' + (sunX + 13) + '" cy="' + (sunY + 11) + '" r="38" fill="url(#pg6SunGlow)"/>';
  // (orb disc removed — the sprite is drawn in the front pass, after mountains,
  // so it isn't occluded; this behind pass keeps only the halo to pre-tint.)

  // === Mountains ================================================
  s += '<image href="' + assetRoot + '/sprites/mountains/mountains_far.png" x="-12" y="' + (WT - 82) + '" width="704" height="48" preserveAspectRatio="none" opacity="' + time.mountainFarOpacity + '"/>';
  // mountains_near reaches WT (wall top) so the silhouette meets the wall edge
  // without leaving a thin sky strip. Both ranges are pinned to WT so they
  // ride down with the wall when the composition changes.
  s += '<image href="' + assetRoot + '/sprites/mountains/mountains_near.png" x="-10" y="' + (WT - 54) + '" width="700" height="54" preserveAspectRatio="none" opacity="' + time.mountainNearOpacity + '"/>';

  // Re-draw the sun in front of the mountain sprites; the first pass above
  // tints the horizon, this pass keeps the core readable. Halo is the same
  // radial gradient — softer than the original rectangle outlines.
  s += '<circle cx="' + (sunX + 13) + '" cy="' + (sunY + 11) + '" r="30" fill="url(#pg6SunGlow)" opacity="' + time.frontGlowOpacity + '"/>';
  s += orbImage(sunX, sunY);

  // birds — tiny PixelLab silhouettes (daytime/dusk only), some mirrored for
  // variety. critter() is hoisted (defined with the butterflies below).
  if (time.mode !== 'night') {
    s += critter('bird.png', 290, 66, 16, 11, false);
    s += critter('bird.png', 306, 71, 13, 9, true);
    s += critter('bird.png', 437, 58, 18, 12, false);
  }

  const BW = 40, BH = 20;
  s += r(0, WT, W, WB - WT, '#75624f');

  // Wall = a seamless hand-tuned pixel-art brick tile (scene-tiles.js) tiled
  // across the wall band, over a dark mortar backdrop. A sparse weathering
  // overlay (worn-light patches, extra moss, damp streaks) is scattered on top
  // so the tile's ~160-unit repeat doesn't read as an obvious stamp.
  s += '<rect x="0" y="' + WT + '" width="' + W + '" height="' + (WB - WT) + '" fill="url(#pg6WallTex)"/>';
  // Weathering overlay — random (NON-repeating) damp patches, sun-worn patches,
  // moss clumps and hairline cracks scattered across the whole wall, so the
  // tile's ~160-unit repeat reads as one continuous aged wall.
  // Fewer iterations (wall is lighter now, so heavy mottling reads as dirt);
  // patches/cracks are re-toned for the tan ramp — dark patches are softer and
  // browner, cracks are tan-brown not near-black, so the weathering ages the
  // wall without re-darkening it back toward the old heavy brown.
  for (let i = 0; i < 24; i++) {
    const wx = Math.floor(hash(i + 3, 61) * (W - 24));
    const wy = WT + 6 + Math.floor(hash(i + 9, 17) * (WB - WT - 18));
    const k = hash(i, 41);
    if (k > 0.72) {
      // damp / shadowed patch
      s += r(wx, wy, 10 + Math.floor(hash(i, 5) * 16), 6 + Math.floor(hash(i, 7) * 7), 'rgba(72,54,40,0.13)');
    } else if (k > 0.48) {
      // sun-worn lighter patch
      s += r(wx, wy, 8 + Math.floor(hash(i, 6) * 14), 4 + Math.floor(hash(i, 8) * 5), 'rgba(232,213,172,0.16)');
    } else if (k > 0.24) {
      // moss clump creeping from a joint
      s += r(wx, wy, 5, 2, 'rgba(95,107,74,0.5)');
      s += r(wx + 1, wy - 2, 3, 2, 'rgba(110,124,82,0.42)');
      s += r(wx - 1, wy + 2, 2, 1, 'rgba(80,95,60,0.4)');
    } else {
      // hairline crack — a short jagged tan-brown run
      const len = 4 + Math.floor(hash(i, 12) * 6);
      let cxk = wx;
      for (let k2 = 0; k2 < len; k2++) {
        s += r(cxk, wy + k2 * 2, 2, 2, 'rgba(95,75,63,0.4)');
        if (hash(i + k2, 3) > 0.6) cxk += hash(i + k2, 9) > 0.5 ? 2 : -2;
      }
    }
  }

  s += r(580, 180, 35, 30, 'rgba(80,60,44,0.12)');
  s += r(595, 168, 22, 14, 'rgba(80,60,44,0.08)');

  // Time-of-day wash over the whole wall band (see wallShade in resolveTimeScene).
  if (time.wallShade) s += r(0, WT, W, WB - WT, time.wallShade);

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

  // Ground band — two modes:
  //   * default: season-driven grass strips + dither + blades + flagstone path
  //   * flowerbed: a tilled dirt bed with speckled clods, ready for the 366
  //     flower sprites that render-garden.js / render-flowerbed.js will lay on
  //     top. We skip the flagstone path in flowerbed mode because the path's
  //     hard outline reads as foreign once flowers cover the foreground.
  s += r(0, WB, W, H - WB, '#3a2a1a');
  if (flowerbedEnabled) {
    s += r(0, WB - 2, W, 5, '#536a3a');
    s += r(0, WB + 3, W, 10, '#5a3a22');
    s += r(0, WB + 13, W, 14, '#6a4428');
    // Fill the rest of the (now taller) ground band with the deep-soil tone so
    // the lifted WB doesn't expose a flat dark strip below the bed.
    s += r(0, WB + 27, W, (H - 12) - (WB + 27), '#58361f');
    s += r(0, H - 12, W, 12, '#2d1d12');
    // Speckled dirt clods over the bed for texture (spread across the full band).
    for (let i = 0; i < 240; i++) {
      const dx = Math.floor(hash(i, 17) * W);
      const dy = WB + 4 + Math.floor(hash(i, 31) * (GROUND_H - 18));
      const col = hash(i, 43) > 0.62 ? '#7a4d2c' : '#3a2518';
      s += r(dx, dy, 1 + Math.floor(hash(i, 47) * 2), 1, col);
    }
  } else {
    // === 2.5D perspective floor ===================================
    // The courtyard floor reads as a plane tilted away from the viewer:
    // receding from the FRONT (screen bottom, "near") back to the wall base
    // ("far"). Every cue is an axis-aligned <rect>, so it stays pixel-crisp,
    // and all greens come from the season palette (+ one pale haze tint), so
    // it reverses sanely across seasons. Object placement (render-garden.js)
    // seats sprites on this same plane via depthToScreen(). See that fn.
    //
    // (a) Lawn ROWS whose heights COMPRESS toward the back (far rows thin, near
    // rows thick) + aerial haze: the two farthest rows are lightened/cooled
    // toward `haze`, near rows use the deeper grass tones — "lit far, shaded
    // near", which reads as the plane catching light as it tilts up.
    const haze = '#cfdcc0';   // pale cool tint = aerial-perspective distance haze
    const near = '#1a2410';   // deep shade = the plane darkening toward the viewer
    const floorRows = [
      [WB,      8,  blend(season.grass[0], haze, 0.30)], // 0 far — strongest haze (lightest)
      [WB + 8,  10, blend(season.grass[0], haze, 0.18)], // 1
      [WB + 18, 13, blend(season.grass[1], haze, 0.07)], // 2
      [WB + 31, 15, season.grass[1]],                    // 3
      [WB + 46, 18, season.grass[2]],                    // 4
      [WB + 64, 21, blend(season.grass[3], near, 0.08)], // 5
      [WB + 85, 25, blend(season.grass[3], near, 0.18)]  // 6 near — deepest (darkest)
    ];
    for (const [ry, rh, rc] of floorRows) s += r(0, ry, W, rh, rc);
    // (b) Dither the row seams (classic pixel gradient), with the checker
    // getting DENSER toward the front so the texture compresses with depth too.
    const ditherSeam = (yMid, col, step) => {
      for (let dx = 0; dx < W; dx += step) {
        s += r(dx, yMid, 2, 2, col);
        s += r(dx + 2, yMid - 2, 2, 2, col);
      }
    };
    ditherSeam(WB + 8,  blend(season.grass[0], haze, 0.08), 6);
    ditherSeam(WB + 18, season.grass[1], 6);
    ditherSeam(WB + 31, season.grass[1], 5);
    ditherSeam(WB + 46, season.grass[2], 5);
    ditherSeam(WB + 64, season.grass[2], 4);
    ditherSeam(WB + 85, season.grass[3], 3);
    // Wall-base contact shadow — sells "the ground plane butts into the vertical
    // wall" rather than a flat color transition.
    s += r(0, WB, W, 2, 'rgba(30,40,20,0.30)');
    s += r(0, WB + 2, W, 1, 'rgba(40,55,28,0.18)');
    // (c) Grass blades: taller + denser toward the FRONT, sparse/short far back
    // (the two farthest rows get none — sells distance). [rowIndex, y0, y1, count]
    const bladeRows = [[2, WB + 18, WB + 31, 10], [3, WB + 31, WB + 46, 14], [4, WB + 46, WB + 64, 18], [5, WB + 64, WB + 85, 22], [6, WB + 85, H, 26]];
    let bi = 0;
    for (const [ri, ry0, ry1, cnt] of bladeRows) {
      for (let i = 0; i < cnt; i++, bi++) {
        const tx = Math.floor(hash(bi, 17) * W);
        const baseY = ry1 - 1 - Math.floor(hash(bi, 23) * (ry1 - ry0 - 1));
        const bh = ri + (hash(bi, 11) > 0.6 ? 1 : 0);
        const shade = hash(bi, 3) > 0.62 ? season.grass[2] : (hash(bi, 9) > 0.5 ? season.grassDots : season.grass[1]);
        s += r(tx, baseY - bh, 1, bh, shade);
      }
    }
    // (d) The flagstone path is no longer drawn here as a tiled SVG strip — it
    // read as a flat grey grid that clashed with the pixel-art objects. It is
    // now a row of discrete PixelLab stepping-stone sprites placed + depth-scaled
    // in render-garden.js (addSteppingStones), so it recedes on this same plane.
    // (e) Flowers: bias the flecks to the near rows (3..6) so the wildflower
    // carpet compresses toward the back too; a few small 1px ones sit far.
    const flCol = season.flowers;
    const flowerCount = season.flowerCount;
    for (let i = 0; i < flowerCount; i++) {
      const fx = (i * 19 + 11) % W;
      const near = hash(i, 53) > 0.18;
      const fy = near ? (WB + 34 + (i % 5) * 16) : (WB + 19 + (i % 2) * 4);
      const fs = near ? 2 : 1;
      s += r(fx, fy, fs, fs, flCol[i % flCol.length]);
    }
  }

  // Time-of-day wash over the whole courtyard floor (mirrors wallShade) so the
  // lawn doesn't stay day-bright at dusk/night.
  if (time.groundShade) s += r(0, WB, W, H - WB, time.groundShade);

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

  // Butterflies + birds — PixelLab pixel-art sprites replace the old few-rect /
  // polyline glyphs. critter() centers a sprite at (cx,cy), optionally mirrored.
  // Drawn in the base SVG background layer like before; the postcard export
  // inlines these <image>s so the export still matches.
  function critter(file, cx, cy, w, h, flip) {
    cx = Math.round(cx); cy = Math.round(cy);
    const x = cx - Math.round(w / 2), y = cy - Math.round(h / 2);
    const tf = flip ? ' transform="translate(' + (2 * cx) + ' 0) scale(-1 1)"' : '';
    return '<image href="' + assetRoot + '/sprites/critters/' + file + '" x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" image-rendering="pixelated"' + tf + '/>';
  }
  // Two color variants alternate so the trio doesn't read as one stamp (44:36).
  function butterfly(cx, cy, size, variant) {
    return critter('butterfly_' + (variant || 'amber') + '.png', cx, cy, size, Math.round(size * 36 / 44), false);
  }
  // Butterflies are a daytime/dusk accent — none at night (fireflies own the
  // night), matching the gate the birds already use.
  if (time.mode !== 'night') {
    s += butterfly(230, 338, 18, 'amber');
    s += butterfly(160, 378, 14, 'blue');
    s += butterfly(470, 320, 16, 'amber');
  }

  for (let i = 0; i < 8; i++) {
    const px = 140 + i * 60 + (i % 3) * 15;
    const py = 420 + (i % 2) * 6;
    s += r(px, py, 2, 2, '#f4b8c8');
    if (hash(i, 22) > 0.5) s += r(px + 30, py + 3, 1, 1, '#f8c4d4');
  }

  // === Day / night atmosphere ===================================
  // Painted OVER the background but UNDER the DOM object sprites, so the bare
  // upper wall + sky recede while lanterns + moon read as real light sources;
  // the courtyard objects stay bright. In the SVG (not DOM) so postcard.js
  // captures it. (Salvaged from the flat-view polish pass — light effects only,
  // no geometry changes.)
  if (time.mode === 'day') {
    s += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="url(#pg6DaySun)"/>';
    s += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="url(#pg6DayVignette)"/>';
  }
  if (time.mode === 'night' || time.mode === 'dusk') {
    if (time.mode === 'night') {
      s += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="url(#pg6NightTop)"/>';
    }
    const vig = time.mode === 'night' ? 0.5 : 0.34;
    s += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="url(#pg6NightVignette)" opacity="' + vig + '"/>';
    // Warm pool around the lit stone lantern (flat view seats it at x=42%,
    // depth 0.70 — see render-garden.js addCourtyardObjects).
    const lampX = Math.round(0.42 * W);
    const lampBaseY = Math.round(depthToScreen(0.70).yBottomPct / 100 * H);
    s += '<circle cx="' + lampX + '" cy="' + (lampBaseY - 46) + '" r="58" fill="url(#pg6LampGlow)"/>';
    // Warm spill from the pavilion's right-eave hanging lantern (hand-placed).
    s += '<circle cx="642" cy="332" r="42" fill="url(#pg6LampGlow)"/>';
  }
  if (time.mode === 'night') {
    s += '<circle cx="' + (sunX + 13) + '" cy="' + (sunY + 11) + '" r="66" fill="url(#pg6MoonGlow)"/>';
    s += orbImage(sunX, sunY);
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
  scene.dataset.renderer = 'classic';
  scene.dataset.timeLabel = time.label;
  scene.dataset.motion = options.settings?.appearance?.motion || 'system';
  // Season drives both the SVG ground/flower colors above AND a CSS-level
  // hue/saturation tweak applied to sprites in index.html so the cherry,
  // willow, vines, etc. react too.
  scene.dataset.season = season.mode;
  scene.dataset.seasonLabel = season.label;
  scene.dataset.flowerbed = flowerbedEnabled ? 'enabled' : 'disabled';
  // Wall geometry as % of the scene height, so the DOM overlays (wall-edge
  // cover, hanging/climbing vines, cornice, wall marks) anchor to the wall
  // instead of re-hardcoding the old 25% / 24.65% constants. render-garden.js
  // reads wallTopPct/wallBottomPct; the CSS var feeds .pg6-wall-edge-cover.
  const wallTopPct = +(WT / H * 100).toFixed(2);
  const wallBottomPct = +(WB / H * 100).toFixed(2);
  scene.dataset.wallTopPct = String(wallTopPct);
  scene.dataset.wallBottomPct = String(wallBottomPct);
  scene.style.setProperty('--wall-top-pct', wallTopPct + '%');
}

// === 2.5D floor depth → screen mapping =====================================
// The courtyard floor (render above) is drawn as a plane receding from the
// FRONT (screen bottom) back to the WALL BASE. This pure function is the shared
// contract render-garden.js uses to seat sprites ON that plane: given a depth
// d ∈ [0,1] (0 = far/at the wall base, 1 = near/screen bottom) it returns the
// bottom-edge y (in scene-%) and a size scale. Perspective easing makes equal
// real-depth steps compress toward the back, matching the drawn rows that thin
// out toward the wall. Far objects sit higher + smaller, near ones lower +
// bigger. Kept here (not render-garden) so floor and objects share one plane.
export function depthToScreen(d) {
  const dd = Math.max(0, Math.min(1, d));
  const e = dd * dd * (1.7 - 0.7 * dd); // ease-in: small slope near 0 (far bunches up)
  const Y_BACK = 78.0, Y_FRONT = 98.5;  // bottom-edge %: just under wall base → near edge
  const S_BACK = 0.82, S_FRONT = 1.12;  // size scale: far smaller → near bigger
  return {
    yBottomPct: +(Y_BACK + (Y_FRONT - Y_BACK) * e).toFixed(2),
    scale: +(S_BACK + (S_FRONT - S_BACK) * e).toFixed(3),
  };
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
      mountainNearOpacity: 0.52,
      // wallShade: a time-of-day overlay on the (now light tan) wall band.
      // Day leaves it bare; dusk/night re-darken it so the lifted palette
      // doesn't glow unnaturally bright after sundown.
      wallShade: null,
      // groundShade: matching time-of-day wash on the courtyard floor so the
      // bright lawn doesn't stay day-lit under a dusk/night sky.
      groundShade: null
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
      mountainNearOpacity: 0.58,
      wallShade: 'rgba(120,70,40,0.12)',
      groundShade: 'rgba(60,40,46,0.18)'
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
      mountainNearOpacity: 0.48,
      // Pushed deeper (was 0.32) so the bare mid-wall recedes and the lantern
      // light-pools (painted after this wash) read as the focus at night.
      wallShade: 'rgba(13,18,34,0.52)',
      groundShade: 'rgba(16,22,40,0.42)'
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
