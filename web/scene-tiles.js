// Hand-tuned pixel-art tile generators for the base scene's wall and path.
//
// These build seamless SVG <pattern> tiles (rendered once, repeated by the
// renderer) so the wall/path read as deliberate pixel art — a tight palette
// ramp with NO blended in-between colors, dithered shading transitions, chunky
// 2-unit pixels, dark mortar joints, and running-bond tiling — instead of the
// smooth vector look of computed bevels. The warm-sandstone ramp came out of a
// pixel-art design pass with Codex; the grids themselves are generated in code
// (an LLM can't reliably hand-place a pixel-perfect, seam-continuous grid).
//
// Coordinate note: tiles are authored in PIXELS; `U` scene-units per pixel maps
// them into the 680×440 scene. patternUnits="userSpaceOnUse" means the tile
// repeats in scene coordinates, so it lines up across the filled region.

const U = 2; // scene-units per authored pixel (matches the sprite art density)

// Tiny deterministic hash in [0,1) — local so this module owns its own noise.
function rnd(a, b) {
  const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

// Run-length merge a pixel grid (2D array of palette keys) into <rect>s. Cells
// whose palette value is null/undefined are transparent and skipped.
function gridToRects(grid, palette) {
  const rows = grid.length, cols = grid[0].length;
  let out = '';
  for (let y = 0; y < rows; y++) {
    let x = 0;
    while (x < cols) {
      const ch = grid[y][x];
      const x0 = x;
      while (x < cols && grid[y][x] === ch) x++;
      const color = palette[ch];
      if (color) {
        out += '<rect x="' + (x0 * U) + '" y="' + (y * U) + '" width="' + ((x - x0) * U) + '" height="' + U + '" fill="' + color + '"/>';
      }
    }
  }
  return out;
}

function pattern(id, grid, palette) {
  const w = grid[0].length * U, h = grid.length * U;
  return '<pattern id="' + id + '" patternUnits="userSpaceOnUse" width="' + w + '" height="' + h + '">'
    + gridToRects(grid, palette) + '</pattern>';
}

// --- Wall: running-bond sandstone brick ----------------------------------
// Palette ramp from Codex (mortar/dark → highlight) + moss + crack. The tile is
// 80×20 px (160×40 units) = 4 bricks wide × 2 offset rows, so it carries enough
// brick-color variety that the repeat isn't an obvious stamp; the scene adds a
// sparse weathering overlay on top to break it further.
// Tan ramp (was a dark brown brick). The mockup's wall reads as a light,
// airy #b8a079 body; keeping the brick STRUCTURE but lifting the whole ramp
// toward tan is what makes the scene stop feeling cramped/heavy. The moss
// stays a muted olive so it still reads as growth against the lighter brick,
// and the crack drops to a tan-brown (not near-black) so it doesn't punch
// holes in the lighter wall.
const WALL_PAL = {
  a: '#75624f', // mortar / joint (darkest)
  b: '#92775a', // shadow
  c: '#a98c68', // body dark
  d: '#b8a079', // body mid (the mockup's target tone)
  e: '#c8b28a', // body light
  f: '#dec99e', // highlight
  g: '#6f7f4f', // moss
  h: '#5f4b3f'  // crack
};

export function wallPattern() {
  const TPW = 80, TPH = 20, BW = 20, BH = 10;
  const grid = Array.from({ length: TPH }, () => new Array(TPW).fill('a'));
  const bodyRamp = ['c', 'd', 'e', 'd', 'c', 'e', 'b', 'd'];   // some darker / lighter bricks
  const set = (x, y, ch) => {
    const xx = ((x % TPW) + TPW) % TPW;       // wrap horizontally for seamless tiling
    if (y >= 0 && y < TPH) grid[y][xx] = ch;
  };
  function brick(bx, by, seed) {
    const body = bodyRamp[Math.floor(rnd(seed, by) * bodyRamp.length)];
    for (let yy = 1; yy < BH; yy++) {
      for (let xx = 1; xx < BW; xx++) {
        let ch = body;
        if (yy === 1) ch = 'f';                              // top highlight row
        else if (yy === 2 && xx % 2 === 0) ch = 'f';         // dither under highlight
        if (xx === 1) ch = yy <= 2 ? 'f' : 'e';              // left highlight column
        if (yy === BH - 1) ch = 'b';                         // bottom shadow row
        else if (yy === BH - 2 && xx % 2 === 0) ch = 'b';    // dither above shadow
        if (xx === BW - 1) ch = 'b';                         // right shadow column
        set(bx + xx, by + yy, ch);
      }
    }
    // NOTE: cracks / moss are intentionally NOT baked into the tile — they'd
    // repeat identically every tile width and expose the seam. The scene draws
    // them as a sparse RANDOM overlay across the whole wall instead.
  }
  let seed = 1;
  for (let by = 0; by < TPH; by += BH) {
    const off = ((by / BH) % 2) * (BW / 2);                  // running bond
    for (let bx = off; bx < TPW; bx += BW) brick(bx, by, seed++);
  }
  return pattern('pg6WallTex', grid, WALL_PAL);
}

// --- Path: cool-gray flagstones set in soil ------------------------------
// 30×10 px (60×20 units). Two beveled stones with transparent gaps so the lawn
// shows through and a strip of repeats reads as worn stepping stones.
const PATH_PAL = {
  '.': null,        // transparent (grass shows through)
  o: '#2b2620',     // soil in the joint
  s: '#56544c',     // stone shadow
  m: '#727064',     // stone mid
  b: '#8b8779',     // stone body
  l: '#a4a08f',     // stone light
  h: '#bcb8a6',     // stone highlight
  g: '#5f6b4a'      // moss fleck
};

export function pathPattern() {
  const TPW = 30, TPH = 10;
  const grid = Array.from({ length: TPH }, () => new Array(TPW).fill('.'));
  function stone(x0, w, seed) {
    for (let yy = 1; yy <= 8; yy++) {
      for (let xx = 0; xx < w; xx++) {
        const px = x0 + xx;
        if (px < 0 || px >= TPW) continue;
        let ch = 'b';
        if (yy === 1) ch = 'h';                              // top highlight
        else if (yy === 2 && xx % 2 === 0) ch = 'l';         // dither
        if (xx === 0) ch = yy <= 2 ? 'h' : 'l';              // left light
        if (yy === 8) ch = 's';                              // bottom shadow
        else if (yy === 7 && xx % 2 === 0) ch = 's';         // dither
        if (xx === w - 1) ch = 's';                          // right shadow
        if (yy >= 3 && yy <= 6 && xx > 1 && xx < w - 1 && rnd(seed + px, yy) > 0.84) ch = 'm';
        grid[yy][px] = ch;
      }
    }
    // a little soil + moss tucked at the stone's base joint
    if (x0 - 1 >= 0) grid[8][x0 - 1] = 'o';
    if (rnd(seed, 3) > 0.5 && x0 - 1 >= 0) grid[7][x0 - 1] = 'g';
  }
  stone(2, 11, 4);
  stone(16, 11, 9);
  return pattern('pg6PathTex', grid, PATH_PAL);
}
