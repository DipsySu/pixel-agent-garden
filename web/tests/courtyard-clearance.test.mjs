// Peak-tier scene-% footprints for the landmarks placed by addCourtyardObjects.
// Six fixes (2026-06-16..19) stacked the same x-ranges: cairn inside the
// pavilion, lantern inside the willow, bamboo through the cherry. Screen width
// is `options.width / 680 * 100`, centered on `x` (bottom anchor). Pond,
// stepping stones, flowers, and pavilion-interior props may share x; that is
// occlusion, not a second landmark. A regex cannot see this, and the draw
// helper must stay open for those overlapping layers.
//
// Every pair of landmarks is checked, not a hand-picked list: the stacking kept
// recurring between pairs nobody had listed yet. A pair may overlap only via
// ALLOWED_OVERLAPS, which names the depth reason and caps the overlap.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MIN_GAP = 0.5;
// fbe3847 is the parent of 0d4aa74, the last revision with all three stacked pairs.
const HISTORICAL = 'fbe3847d8affc7e72cfcb98c2bc69a00d70699e7';
const HISTORICAL_PAIRS = ['bamboo/cherry', 'lantern/willow', 'cairn/pavilion'];

const LANDMARKS = [
  ['bamboo', 'if (bamboo.length)'],
  ['cherry', 'if (cherries.length)'],
  ['willow', 'if (willows.length)'],
  ['lantern', 'if (lanterns.length)'],
  ['cairn', 'if (cairns.length)'],
  ['pavilion', 'if (pavilions.length)'],
  ['stone_cat', "if (tiers.stone_cat !== 'hidden' && stoneCats.length)"]
];

const ALLOWED_OVERLAPS = [
  {
    pair: 'pavilion/willow',
    maxOverlap: 2.5,
    why: 'the willow (d 0.30, z 19) droops behind the pavilion eave (z 24)'
  }
];

test('courtyard landmarks in addCourtyardObjects stay 0.5 scene-% apart at peak tier', () => {
  const failures = clearanceFailures(loadLayout(fromWorkingTree));
  assert.equal(failures.length, 0, failures.map((f) => f.message).join('\n'));
});

test('mutation: the cairn moved onto the willow x fails the guard', () => {
  const read = mutated('if (cairns.length)', 'x: 48,', 'x: 60,');
  assert.deepEqual(failedPairs(loadLayout(read)), ['cairn/willow']);
});

test('mutation: the lantern moved into the bamboo grove fails the guard', () => {
  const read = mutated('if (lanterns.length)', 'x: 42,', 'x: 6,');
  assert.deepEqual(failedPairs(loadLayout(read)), ['bamboo/lantern']);
});

test('mutation: the willow sliding further behind the pavilion exceeds its allowance', () => {
  const read = mutated('if (willows.length)', 'x: 60,', 'x: 64,');
  assert.deepEqual(failedPairs(loadLayout(read)), ['pavilion/willow']);
});

test(`replay: ${HISTORICAL.slice(0, 7)} still fails with its three stacked pairs`, (t) => {
  const read = fromRevision(HISTORICAL);
  if (read('web/render-garden.js') == null) {
    // A shallow clone has no history. CI sets COURTYARD_REPLAY_REQUIRED and
    // fetches full history so the replay can never silently stop running.
    assert.ok(!process.env.COURTYARD_REPLAY_REQUIRED, `git cannot read ${HISTORICAL}; fetch full history`);
    t.skip(`${HISTORICAL} is not in this clone`);
    return;
  }
  const pairs = failedPairs(loadLayout(read));
  for (const pair of HISTORICAL_PAIRS) {
    assert.ok(pairs.includes(pair), `${pair} should fail on ${HISTORICAL}; failed: ${pairs.join(', ')}`);
  }
});

function clearanceFailures(layout) {
  const failures = [];
  for (let i = 0; i < LANDMARKS.length; i++) {
    for (let j = i + 1; j < LANDMARKS.length; j++) {
      const [a, b] = [LANDMARKS[i][0], LANDMARKS[j][0]].sort();
      const pair = `${a}/${b}`;
      const allowed = ALLOWED_OVERLAPS.find((o) => o.pair === pair);
      const gapPct = gap(layout[a], layout[b]);
      if (!(gapPct >= (allowed ? -allowed.maxOverlap : MIN_GAP))) {
        failures.push({ pair, message: failLine(a, layout[a], b, layout[b], gapPct, allowed) });
      }
    }
  }
  return failures;
}

function failedPairs(layout) {
  return clearanceFailures(layout).map((f) => f.pair).sort();
}

function failLine(nameA, a, nameB, b, gapPct, allowed) {
  const rel = gapPct < 0 ? `overlap ${(-gapPct).toFixed(2)}` : `clear only ${gapPct.toFixed(2)}`;
  const want = allowed
    ? `the overlap is at most ${allowed.maxOverlap} scene-% (allowed because ${allowed.why}).`
    : `the gap is at least ${MIN_GAP} scene-%.`;
  return [
    `${nameA} [${a.left.toFixed(2)}, ${a.right.toFixed(2)}] and`,
    `${nameB} [${b.left.toFixed(2)}, ${b.right.toFixed(2)}] ${rel} scene-%.`,
    'Separate them in addCourtyardObjects() in web/render-garden.js',
    `(peak-tier addSprite width; scene % = width/680, centered on x)`,
    `so ${want}`
  ].join(' ');
}

// Source readers: rel path -> file text, or null when the file does not exist.
function fromWorkingTree(rel) {
  const file = path.join(ROOT, rel);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

function fromRevision(rev) {
  return (rel) => {
    try {
      return execFileSync('git', ['-C', ROOT, 'show', `${rev}:${rel}`], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      });
    } catch {
      return null;
    }
  };
}

// The working tree with one edit inside one landmark block. Throws when the
// block no longer holds `from`, so a refactor cannot turn a mutation into a
// silent no-op that passes for the wrong reason.
function mutated(marker, from, to) {
  const src = fromWorkingTree('web/render-garden.js');
  const markerAt = src.indexOf(marker);
  if (markerAt < 0) throw new Error(`addCourtyardObjects is missing \`${marker}\``);
  const open = src.indexOf('{', markerAt);
  const at = src.indexOf(from, open);
  if (at < 0 || at > matchBrace(src, open)) {
    throw new Error(`mutation target \`${from}\` is not inside \`${marker}\``);
  }
  const edited = src.slice(0, at) + to + src.slice(at + from.length);
  return (rel) => (rel === 'web/render-garden.js' ? edited : fromWorkingTree(rel));
}

function loadLayout(read) {
  const garden = read('web/render-garden.js');
  const config = read('web/scene-config.js');
  if (garden == null || config == null) throw new Error('missing web/render-garden.js or web/scene-config.js');
  const sceneUnits = sceneWidthUnits(garden);
  const pavilion = pavilionAnchor(config);
  const fn = extractFunction(garden, 'addCourtyardObjects');
  const stripped = stripComments(fn);
  const scaleOf = /depthToScreen|\.scale\b/.test(stripped) ? loadScale(read) : null;
  const env = {
    cx: pavilion.cx,
    pavilionFull: pavilion.full,
    scales: {},
    scale: scaleOf,
    named: {}
  };
  if (scaleOf) {
    for (const m of stripped.matchAll(/(\w+)\s*=\s*depthToScreen\(\s*([0-9.]+)\s*\)/g)) {
      env.scales[m[1]] = scaleOf(Number(m[2]));
    }
  }
  for (const m of stripped.matchAll(/\b(?:const|let)\s+(\w+)\s*=\s*([^;]+);/g)) {
    try {
      const v = evalBase(m[2], env);
      if (Number.isFinite(v)) env.named[m[1]] = v;
    } catch {
      // Sprite lookups and other non-width consts are not footprints.
    }
  }
  const layout = {};
  for (const [name, marker] of LANDMARKS) {
    const body = blockBody(fn, marker);
    const rects = addSpriteObjects(body).map((obj) => {
      const x = evalBase(fieldExpr(obj, 'x'), env);
      const widthUnits = evalWidth(fieldExpr(obj, 'width'), env);
      return rectOf(x, widthUnits, sceneUnits);
    });
    if (name === 'bamboo') {
      if (rects.length < 2) {
        throw new Error(`addCourtyardObjects bamboo grove: expected clustered addSprite calls, found ${rects.length}`);
      }
      layout.bamboo = {
        left: Math.min(...rects.map((r) => r.left)),
        right: Math.max(...rects.map((r) => r.right))
      };
    } else if (rects.length !== 1) {
      throw new Error(`addCourtyardObjects ${name}: expected 1 addSprite, found ${rects.length}`);
    } else {
      layout[name] = rects[0];
    }
  }
  return layout;
}

function sceneWidthUnits(garden) {
  const found = new Set();
  for (const m of garden.matchAll(/options\.width\s*\/\s*([0-9.]+)\s*\*\s*100/g)) {
    found.add(Number(m[1]));
  }
  if (found.size !== 1) {
    throw new Error(`expected one addSprite scene divisor (options.width / N * 100), found ${[...found].join(', ') || 'none'}`);
  }
  return [...found][0];
}

function pavilionAnchor(config) {
  const anchor = /pavilionAnchor\s*:\s*\{([^}]*)\}/.exec(config);
  const widths = /pavilionWidths\s*:\s*\{([^}]*)\}/.exec(config);
  const cx = anchor && /cx_pct\s*:\s*([0-9.]+)/.exec(anchor[1]);
  const full = widths && /full\s*:\s*([0-9.]+)/.exec(widths[1]);
  if (!cx || !full) throw new Error('scene-config.js is missing pavilionAnchor.cx_pct or pavilionWidths.full');
  return { cx: Number(cx[1]), full: Number(full[1]) };
}

function loadScale(read) {
  for (const file of ['web/render-svg.js', 'web/render-garden.js']) {
    const src = read(file);
    if (src == null) continue;
    const fn = /function depthToScreen\([^)]*\)\s*\{([\s\S]*?)\n\}/.exec(src);
    if (!fn) continue;
    const ease = /dd\s*\*\s*dd\s*\*\s*\(\s*([0-9.]+)\s*-\s*([0-9.]+)\s*\*\s*dd\s*\)/.exec(fn[1]);
    const span = /S_BACK\s*=\s*([0-9.]+)\s*,\s*S_FRONT\s*=\s*([0-9.]+)/.exec(fn[1]);
    if (!ease || !span) {
      throw new Error(`depthToScreen in ${path.basename(file)} is not the ease/scale form this clearance check knows`);
    }
    const a = Number(ease[1]);
    const b = Number(ease[2]);
    const sBack = Number(span[1]);
    const sFront = Number(span[2]);
    return (d) => {
      const dd = Math.max(0, Math.min(1, d));
      const e = dd * dd * (a - b * dd);
      return +(sBack + (sFront - sBack) * e).toFixed(3);
    };
  }
  throw new Error('addCourtyardObjects uses depthToScreen, but web/render-svg.js does not define that ease/scale function');
}

function extractFunction(src, name) {
  const at = src.indexOf(`function ${name}`);
  if (at < 0) throw new Error(`missing function ${name} in web/render-garden.js`);
  const open = src.indexOf('{', at);
  return src.slice(open + 1, matchBrace(src, open));
}

function blockBody(src, marker) {
  const at = src.indexOf(marker);
  if (at < 0) throw new Error(`addCourtyardObjects is missing \`${marker}\``);
  const open = src.indexOf('{', at);
  return src.slice(open + 1, matchBrace(src, open));
}

function addSpriteObjects(src) {
  const objects = [];
  for (let i = 0; i < src.length; i++) {
    const next = skipTrivia(src, i);
    if (next !== i) {
      i = next - 1;
      continue;
    }
    if (src.startsWith('addSprite(', i)) {
      const open = i + 'addSprite'.length;
      const args = src.slice(open + 1, matchParen(src, open));
      objects.push(optionsObject(args));
      i = i + 'addSprite'.length + args.length + 1;
    }
  }
  return objects;
}

function optionsObject(args) {
  let paren = 0;
  let brace = 0;
  let bracket = 0;
  for (let i = 0; i < args.length; i++) {
    const next = skipTrivia(args, i);
    if (next !== i) {
      i = next - 1;
      continue;
    }
    const c = args[i];
    if (c === '(') paren++;
    else if (c === ')') paren--;
    else if (c === '[') bracket++;
    else if (c === ']') bracket--;
    else if (c === '{') {
      if (paren === 0 && brace === 0 && bracket === 0) {
        return args.slice(i + 1, matchBrace(args, i));
      }
      brace++;
    } else if (c === '}') brace--;
  }
  throw new Error('addSprite call has no options object');
}

function fieldExpr(objectSrc, field) {
  let paren = 0;
  let brace = 0;
  let bracket = 0;
  for (let i = 0; i < objectSrc.length; i++) {
    const next = skipTrivia(objectSrc, i);
    if (next !== i) {
      i = next - 1;
      continue;
    }
    if (paren === 0 && brace === 0 && bracket === 0 && identAt(objectSrc, i, field)) {
      let j = i + field.length;
      while (objectSrc[j] === ' ' || objectSrc[j] === '\n' || objectSrc[j] === '\t') j++;
      if (objectSrc[j] === ':') {
        j++;
        const start = j;
        let p = 0;
        let b = 0;
        let k = 0;
        for (let t = j; t < objectSrc.length; t++) {
          const sk = skipTrivia(objectSrc, t);
          if (sk !== t) {
            t = sk - 1;
            continue;
          }
          const c = objectSrc[t];
          if (c === '(') p++;
          else if (c === ')') p--;
          else if (c === '[') k++;
          else if (c === ']') k--;
          else if (c === '{') b++;
          else if (c === '}') {
            if (p === 0 && b === 0 && k === 0) return objectSrc.slice(start, t).trim();
            b--;
          } else if (c === ',' && p === 0 && b === 0 && k === 0) {
            return objectSrc.slice(start, t).trim();
          }
        }
        return objectSrc.slice(start).trim();
      }
    }
    const c = objectSrc[i];
    if (c === '(') paren++;
    else if (c === ')') paren--;
    else if (c === '{') brace++;
    else if (c === '}') brace--;
    else if (c === '[') bracket++;
    else if (c === ']') bracket--;
  }
  throw new Error(`addSprite options missing \`${field}:\``);
}

function evalWidth(expr, env) {
  const s = stripParens(expr);
  const rounded = stripCall(s, 'Math.round');
  if (rounded != null) return Math.round(evalWidth(rounded, env));
  const scaled = splitScale(s);
  if (scaled) {
    const base = evalBase(scaled.base, env);
    const scale = scaled.depth != null ? env.scale(scaled.depth) : env.scales[scaled.scaleName];
    if (!Number.isFinite(scale)) {
      throw new Error(`missing depth scale for \`${s}\` in addCourtyardObjects`);
    }
    return base * scale;
  }
  return evalBase(s, env);
}

function evalBase(expr, env) {
  const s = stripParens(expr.trim());
  if (/^-?(?:\d+\.\d+|\d+)$/.test(s)) return Number(s);
  if (s === 'CONFIG.pavilionAnchor.cx_pct') return env.cx;
  if (/^pavilionWidth\(/.test(s)) return env.pavilionFull;
  const tern = splitTernary(s);
  if (tern) return Math.max(evalBase(tern.a, env), evalBase(tern.b, env));
  if (/^[A-Za-z_]\w*$/.test(s)) {
    if (!Object.prototype.hasOwnProperty.call(env.named, s)) {
      throw new Error(`unknown width \`${s}\` in addCourtyardObjects`);
    }
    return env.named[s];
  }
  throw new Error(`cannot read footprint expression \`${s}\` in addCourtyardObjects`);
}

function splitScale(s) {
  const depth = /^(.*)\*\s*depthToScreen\(\s*([0-9.]+)\s*\)\.scale\s*$/s.exec(s);
  if (depth) return { base: depth[1], depth: Number(depth[2]) };
  const named = /^(.*)\*\s*([A-Za-z_]\w*)\.scale\s*$/s.exec(s);
  if (named) return { base: named[1], scaleName: named[2] };
  return null;
}

function splitTernary(s) {
  let q = -1;
  let paren = 0;
  let brace = 0;
  let bracket = 0;
  for (let i = 0; i < s.length; i++) {
    const next = skipTrivia(s, i);
    if (next !== i) {
      i = next - 1;
      continue;
    }
    const c = s[i];
    if (c === '(') paren++;
    else if (c === ')') paren--;
    else if (c === '{') brace++;
    else if (c === '}') brace--;
    else if (c === '[') bracket++;
    else if (c === ']') bracket--;
    else if (c === '?' && paren === 0 && brace === 0 && bracket === 0) {
      q = i;
      break;
    }
  }
  if (q < 0) return null;
  paren = 0;
  brace = 0;
  bracket = 0;
  for (let i = q + 1; i < s.length; i++) {
    const next = skipTrivia(s, i);
    if (next !== i) {
      i = next - 1;
      continue;
    }
    const c = s[i];
    if (c === '(') paren++;
    else if (c === ')') paren--;
    else if (c === '{') brace++;
    else if (c === '}') brace--;
    else if (c === '[') bracket++;
    else if (c === ']') bracket--;
    else if (c === ':' && paren === 0 && brace === 0 && bracket === 0) {
      return { a: s.slice(q + 1, i), b: s.slice(i + 1) };
    }
  }
  throw new Error(`ternary is missing ':' in \`${s}\``);
}

function stripCall(s, name) {
  if (!s.startsWith(name)) return null;
  let i = name.length;
  while (s[i] === ' ' || s[i] === '\n' || s[i] === '\t') i++;
  if (s[i] !== '(') return null;
  if (matchParen(s, i) !== s.length - 1) return null;
  return s.slice(i + 1, s.length - 1);
}

function stripParens(s) {
  let out = s.trim();
  while (out.startsWith('(')) {
    const end = matchParen(out, 0);
    if (end !== out.length - 1) break;
    out = out.slice(1, -1).trim();
  }
  return out;
}

function rectOf(x, widthUnits, sceneUnits) {
  const half = (widthUnits / sceneUnits) * 50;
  return { left: x - half, right: x + half, x, widthUnits };
}

function gap(a, b) {
  if (a.right <= b.left) return b.left - a.right;
  if (b.right <= a.left) return a.left - b.right;
  return -(Math.min(a.right, b.right) - Math.max(a.left, b.left));
}

function identAt(src, i, name) {
  if (!src.startsWith(name, i)) return false;
  const before = i > 0 ? src[i - 1] : '';
  const after = src[i + name.length] || '';
  return !/[A-Za-z0-9_$]/.test(before) && !/[A-Za-z0-9_$]/.test(after);
}

function matchBrace(src, openIdx) {
  return matchDelim(src, openIdx, '{', '}');
}

function matchParen(src, openIdx) {
  return matchDelim(src, openIdx, '(', ')');
}

function matchDelim(src, openIdx, open, close) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const next = skipTrivia(src, i);
    if (next !== i) {
      i = next - 1;
      continue;
    }
    if (src[i] === open) depth++;
    else if (src[i] === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error(`unbalanced ${open}${close} while reading addCourtyardObjects`);
}

function skipTrivia(src, i) {
  if (src.startsWith('//', i)) {
    const n = src.indexOf('\n', i);
    return n < 0 ? src.length : n + 1;
  }
  if (src.startsWith('/*', i)) {
    const n = src.indexOf('*/', i);
    return n < 0 ? src.length : n + 2;
  }
  const q = src[i];
  if (q === "'" || q === '"' || q === '`') {
    let j = i + 1;
    while (j < src.length && src[j] !== q) {
      if (src[j] === '\\') j += 2;
      else j++;
    }
    return j + 1;
  }
  return i;
}

function stripComments(src) {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    if (src.startsWith('//', i)) {
      const n = src.indexOf('\n', i);
      const end = n < 0 ? src.length : n;
      out += ' '.repeat(end - i);
      i = end - 1;
      continue;
    }
    if (src.startsWith('/*', i)) {
      const n = src.indexOf('*/', i);
      const end = n < 0 ? src.length : n + 2;
      out += src.slice(i, end).replace(/[^\n]/g, ' ');
      i = end - 1;
      continue;
    }
    out += src[i];
  }
  return out;
}
