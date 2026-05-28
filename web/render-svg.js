export function renderBaseScene(scene, assetRoot) {
  const W = 680, H = 440;
  const r = (x, y, w, h, c) => '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + c + '"/>';
  function hash(a, b) {
    const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
    return x - Math.floor(x);
  }

  let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" preserveAspectRatio="xMidYMid meet" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg" role="img"><title>像素花园·春·傍晚</title><desc>本地 agent 活动化作墙沿垂落和墙根攀爬的项目藤</desc>';
  // <defs> — soft radial gradient for the setting-sun halo. Replaces the
  // earlier rectangular halo which showed as ghost squares against the
  // mountain sprites once those went sprite-art.
  s += '<defs>'
     + '<radialGradient id="pg6SunGlow" cx="50%" cy="50%" r="50%">'
     +   '<stop offset="0%"   stop-color="#f8b870" stop-opacity="0.62"/>'
     +   '<stop offset="45%"  stop-color="#f8b870" stop-opacity="0.26"/>'
     +   '<stop offset="100%" stop-color="#f8b870" stop-opacity="0"/>'
     + '</radialGradient>'
     + '</defs>';

  // === Wooden awning ============================================
  // Top eave with subtle pixel-art grain (knots + grooves).
  s += r(0, 0, W, 14, '#d4a070');
  s += r(0, 14, W, 6, '#a07248');
  s += r(0, 20, W, 4, '#604028');
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
    [60, 42, 38, 5, '#f0d0c0'],
    [110, 38, 22, 4, '#f4d8c8'],
    [320, 48, 30, 4, '#e8c4b8'],
    [600, 38, 46, 5, '#f0d0c0']
  ];
  for (const [cx, cy, cw, ch, col] of clouds) {
    // pixel-art puff: 3 vertically stacked rects of decreasing width
    s += r(cx, cy, cw, ch, col);
    s += r(cx + 3, cy - 3, cw - 6, 3, col);
    s += r(cx + 8, cy - 5, Math.max(2, cw - 16), 2, col);
  }

  // === Setting sun ==============================================
  // The halo is now a single SVG circle filled with a radial gradient — old
  // rgba rectangles showed as flat ghost squares against the mountain sprites.
  const sunX = 530, sunY = 46;
  // halo behind everything (will be partly covered by mountains, that's fine
  // — it pre-tints the sky so the horizon picks up dusk warmth)
  s += '<circle cx="' + (sunX + 13) + '" cy="' + (sunY + 11) + '" r="38" fill="url(#pg6SunGlow)"/>';
  // sun core (pixel-art disc)
  s += r(sunX, sunY, 26, 22, '#f0a060');
  s += r(sunX + 4, sunY - 4, 18, 4, '#f0a060');
  s += r(sunX + 4, sunY + 22, 18, 3, '#e08850');
  s += r(sunX - 3, sunY + 6, 3, 14, '#f0a060');
  s += r(sunX + 26, sunY + 6, 3, 14, '#f0a060');
  s += r(sunX - 8, sunY + 10, 4, 6, '#f8b870');
  s += r(sunX + 30, sunY + 8, 4, 6, '#f8b870');
  // inner highlight
  s += r(sunX + 6, sunY + 4, 6, 4, '#f8c878');
  s += r(sunX + 14, sunY + 12, 4, 3, '#f4a458');

  // === Mountains ================================================
  s += '<image href="' + assetRoot + '/sprites/mountains/mountains_far.png" x="-12" y="54" width="704" height="40" preserveAspectRatio="none" opacity="0.48"/>';
  // mountains_near now reaches y=110 (wall top, WT) so the silhouette meets
  // the brick wall edge without leaving a thin sky strip. Height bumped from
  // 34 to 38.
  s += '<image href="' + assetRoot + '/sprites/mountains/mountains_near.png" x="-10" y="72" width="700" height="38" preserveAspectRatio="none" opacity="0.56"/>';

  // Re-draw the sun in front of the mountain sprites; the first pass above
  // tints the horizon, this pass keeps the core readable. Halo is the same
  // radial gradient — softer than the original rectangle outlines.
  s += '<circle cx="' + (sunX + 13) + '" cy="' + (sunY + 11) + '" r="30" fill="url(#pg6SunGlow)" opacity="0.85"/>';
  s += r(sunX, sunY, 26, 22, '#f0a060');
  s += r(sunX + 4, sunY - 4, 18, 4, '#f0a060');
  s += r(sunX + 4, sunY + 22, 18, 3, '#e08850');
  s += r(sunX - 3, sunY + 6, 3, 14, '#f0a060');
  s += r(sunX + 26, sunY + 6, 3, 14, '#f0a060');
  s += r(sunX + 6, sunY + 4, 6, 4, '#f8c878');

  // birds — kept; they're tiny accents
  s += '<polyline points="285,68 290,65 295,68" stroke="#2a1d10" stroke-width="1" fill="none"/>';
  s += '<polyline points="300,72 305,69 310,72" stroke="#2a1d10" stroke-width="1" fill="none"/>';
  s += '<polyline points="430,60 437,56 444,60" stroke="#2a1d10" stroke-width="1" fill="none"/>';

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

  s += r(0, WB, W, H - WB, '#3a2a1a');
  s += r(0, WB - 2, W, 6, '#4f7228');
  s += r(0, WB + 4, W, 12, '#5e8a32');
  s += r(0, WB + 16, W, 12, '#6e9a38');
  s += r(0, WB + 28, W, H - WB - 28, '#5e7c2a');
  for (let i = 0; i < 80; i++) {
    const gx = (i * 11 + 5) % W;
    const gy = WB + 6 + (i % 5) * 6;
    const gh = 2 + Math.floor(hash(i, 5) * 3);
    s += r(gx, gy, 2, gh, '#3a5520');
  }
  const flCol = ['#f0c068', '#e08aa0', '#f0e090', '#d870a0', '#e8a058', '#f8e8ec'];
  for (let i = 0; i < 50; i++) {
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
      '<div class="pg6-info-label" id="garden-info-label">项目藤 · 当前选中</div>' +
      '<div class="pg6-info-name" id="garden-info-name">枝繁叶茂期</div>' +
      '<div class="pg6-info-row"><span id="garden-info-total">累计 580k</span><span id="garden-info-stage">阶段 4 / 6</span></div>' +
      '<div class="pg6-info-bar"><div class="pg6-info-fill" id="garden-info-fill"></div></div>' +
    '</div>';
}
