import { escapeHtml, jitter } from './render-helpers.js';

const SCENE_W = 680;
const SCENE_H = 440;
const COLS = 61;
const ROWS = 6;
const DAYS = COLS * ROWS;
const START_X = 5;
// Lifted from 386 → 358. The frame's bottom vignette (`.pg6-frame::after`,
// 84 px tall after the companion CSS tweak) was covering most of the bed
// at the old position. With 6 rows × 7.8 height ≈ 47 px, the bed now
// occupies SVG y ≈ 358..405 — comfortably above the vignette range and
// sitting just above the dirt strip rather than dropping into it.
const START_Y = 358;
const CELL_W = 670 / COLS;
const CELL_H = 7.8;
const VARIANTS = ['rose', 'daisy', 'tulip', 'wildflower'];
const WIDTH_BY_LEVEL = [4.8, 6.4, 7.8, 9.4, 12.8];
const ALPHA_BY_LEVEL = [0.58, 0.78, 0.9, 1, 1];
const imageCache = new Map();
const canvasStates = new WeakMap();

export function renderFlowerbed(scene, flowerSprites, summary, options = {}) {
  const sprites = Array.isArray(flowerSprites) ? flowerSprites : [];
  if (!scene || !sprites.length) return;

  const spriteRoot = options.spriteRoot || '';
  const days = flowerbedDays(summary, options.now);
  if (!days.length) return;

  const canvas = ensureCanvas(scene);
  const tooltip = ensureTooltip(scene);
  const state = canvasStates.get(canvas);
  state.placements = flowerbedPlacements(days, sprites, spriteRoot);
  state.tooltip = tooltip;
  state.hovered = -1;
  drawFlowerbed(canvas, state);
  requestImages(canvas, state);
}

export function clearFlowerbed(scene) {
  if (!scene) return;
  scene.querySelector('.pg6-flowerbed-canvas')?.remove();
  scene.querySelector('.pg6-flower-tooltip')?.remove();
}

export function flowerbedPlacements(days, flowerSprites, spriteRoot = '') {
  const sprites = Array.isArray(flowerSprites) ? flowerSprites : [];
  const byName = new Map(sprites.map((sprite) => [sprite.name, sprite]));
  const placements = [];

  (days || []).slice(0, DAYS).forEach((day, index) => {
    const row = Math.floor(index / COLS);
    const col = index % COLS;
    const level = clampLevel(day.level);
    const variant = VARIANTS[Math.floor(jitter(index, level + 19) * VARIANTS.length)] || VARIANTS[0];
    const sprite = byName.get(`flower_l${level}_${variant}`)
      || byName.get(`flower_l${level}_${VARIANTS[index % VARIANTS.length]}`)
      || sprites.find((candidate) => candidate.level === level)
      || sprites[0];
    if (!sprite?.file) return;

    const depth = row / (ROWS - 1);
    const x = START_X + col * CELL_W + CELL_W * 0.5 + (jitter(index, 31) - 0.5) * 1.8;
    const y = START_Y + row * CELL_H + CELL_H + (jitter(index, 43) - 0.5) * 2.2;
    const width = WIDTH_BY_LEVEL[level] * (0.9 + depth * 0.18);
    const title = `${day.date} · activity ${day.activity || 0} · level ${level}`;

    placements.push({
      activity: Number(day.activity || 0),
      date: String(day.date || ''),
      level,
      row,
      source: spriteRoot + sprite.file,
      title,
      width,
      x,
      y
    });
  });

  return placements;
}

export function flowerbedDays(summary, now = new Date()) {
  if (Array.isArray(summary?.flowerbed_year) && summary.flowerbed_year.length) {
    return summary.flowerbed_year.map((day) => ({
      date: String(day.date || ''),
      activity: Number(day.activity || 0),
      level: clampLevel(day.level)
    }));
  }

  const daily = aggregateDailyActivity(summary?.projects || []);
  const dates = lastUtcDates(DAYS, now);
  const max = dates.reduce((best, date) => Math.max(best, daily[date] || 0), 0);
  return dates.map((date) => {
    const activity = daily[date] || 0;
    return { date, activity, level: levelForActivity(activity, max) };
  });
}

function aggregateDailyActivity(projects) {
  const daily = {};
  for (const project of projects || []) {
    const entries = project?.daily_activity || {};
    Object.keys(entries).forEach((date) => {
      const value = Number(entries[date] || 0);
      daily[date] = (daily[date] || 0) + value;
    });
  }
  return daily;
}

function lastUtcDates(count, now) {
  const base = now instanceof Date ? now : new Date(now);
  const today = Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate());
  const out = [];
  for (let offset = count - 1; offset >= 0; offset--) {
    const d = new Date(today - offset * 86_400_000);
    out.push([
      d.getUTCFullYear(),
      String(d.getUTCMonth() + 1).padStart(2, '0'),
      String(d.getUTCDate()).padStart(2, '0')
    ].join('-'));
  }
  return out;
}

function levelForActivity(activity, maxActivity) {
  if (!activity || !maxActivity) return 0;
  const minLog = Math.log10(2);
  const maxLog = Math.max(minLog + 1, Math.log10(maxActivity + 1));
  const ratio = (Math.log10(activity + 1) - minLog) / (maxLog - minLog);
  return Math.max(1, Math.min(4, Math.ceil(ratio * 4)));
}

function ensureTooltip(scene) {
  let tooltip = scene.querySelector('.pg6-flower-tooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.className = 'pg6-flower-tooltip';
    tooltip.hidden = true;
    scene.append(tooltip);
  }
  return tooltip;
}

function ensureCanvas(scene) {
  let canvas = scene.querySelector('.pg6-flowerbed-canvas');
  if (canvas) return canvas;

  canvas = document.createElement('canvas');
  canvas.className = 'pg6-flowerbed-canvas';
  canvas.width = SCENE_W;
  canvas.height = SCENE_H;
  canvas.setAttribute('aria-hidden', 'true');
  const state = {
    hovered: -1,
    images: new Map(),
    pending: new Map(),
    placements: [],
    tooltip: null
  };
  canvasStates.set(canvas, state);
  canvas.addEventListener('mousemove', (event) => updateHover(canvas, state, event));
  canvas.addEventListener('mouseleave', () => {
    if (state.hovered < 0) return;
    state.hovered = -1;
    canvas.classList.remove('is-hovering');
    hideTooltip(state.tooltip);
    drawFlowerbed(canvas, state);
  });
  scene.append(canvas);
  return canvas;
}

function requestImages(canvas, state) {
  const sources = new Set(state.placements.map((placement) => placement.source));
  sources.forEach((source) => {
    if (state.images.has(source) || state.pending.has(source)) return;
    const pending = loadImage(source);
    state.pending.set(source, pending);
    pending.then((image) => {
      state.pending.delete(source);
      state.images.set(source, image);
      if (canvas.isConnected) drawFlowerbed(canvas, state);
    }).catch(() => {
      state.pending.delete(source);
    });
  });
}

function loadImage(source) {
  if (imageCache.has(source)) return imageCache.get(source);
  const pending = new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = source;
  });
  imageCache.set(source, pending);
  pending.catch(() => {
    if (imageCache.get(source) === pending) imageCache.delete(source);
  });
  return pending;
}

function drawFlowerbed(canvas, state) {
  const context = canvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, SCENE_W, SCENE_H);
  context.imageSmoothingEnabled = false;
  state.placements.forEach((placement, index) => {
    const image = state.images.get(placement.source);
    if (!image) return;
    drawFlower(context, image, placement, index === state.hovered);
  });
}

function drawFlower(context, image, placement, hovered) {
  const scale = hovered ? 1.35 : 1;
  const width = placement.width * scale;
  const height = width * (image.naturalHeight / Math.max(1, image.naturalWidth));
  const x = placement.x - width * 0.5;
  const y = placement.y - height - (hovered ? 2 : 0);

  context.save();
  context.globalAlpha = hovered ? 1 : ALPHA_BY_LEVEL[placement.level];
  context.filter = hovered
    ? 'saturate(1.12) brightness(1.1) contrast(1.05) drop-shadow(0 0 3px rgba(244,216,120,0.42))'
    : placement.level === 0
      ? 'saturate(0.58) brightness(0.78) contrast(1.05)'
      : 'saturate(0.92) brightness(0.95) contrast(1.04) drop-shadow(0 1px 0 rgba(30,18,8,0.35))';
  context.drawImage(image, x, y, width, height);
  if (hovered) {
    context.filter = 'none';
    context.globalAlpha = 0.74;
    context.strokeStyle = 'rgb(244, 216, 120)';
    context.lineWidth = 1;
    context.strokeRect(Math.floor(x) - 1, Math.floor(y) - 1, Math.ceil(width) + 2, Math.ceil(height) + 2);
  }
  context.restore();
}

function updateHover(canvas, state, event) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const x = (event.clientX - rect.left) * SCENE_W / rect.width;
  const y = (event.clientY - rect.top) * SCENE_H / rect.height;
  const hovered = findPlacement(state, x, y);
  if (hovered === state.hovered) return;
  state.hovered = hovered;
  canvas.classList.toggle('is-hovering', hovered >= 0);
  if (hovered >= 0) {
    const placement = state.placements[hovered];
    showTooltip(state.tooltip, placement.title, placement.x, placement.y);
  } else {
    hideTooltip(state.tooltip);
  }
  drawFlowerbed(canvas, state);
}

function findPlacement(state, x, y) {
  for (let index = state.placements.length - 1; index >= 0; index--) {
    const placement = state.placements[index];
    const image = state.images.get(placement.source);
    const ratio = image ? image.naturalHeight / Math.max(1, image.naturalWidth) : 4 / 3;
    const halfWidth = Math.max(3, placement.width * 0.7);
    const height = Math.max(5, placement.width * ratio);
    if (
      x >= placement.x - halfWidth &&
      x <= placement.x + halfWidth &&
      y >= placement.y - height &&
      y <= placement.y + 2
    ) return index;
  }
  return -1;
}

function showTooltip(tooltip, text, x, y) {
  if (!tooltip) return;
  tooltip.innerHTML = escapeHtml(text);
  tooltip.style.left = pct(Math.min(SCENE_W - 78, Math.max(78, x)), SCENE_W);
  tooltip.style.top = pct(Math.max(352, y - 26), SCENE_H);
  tooltip.hidden = false;
}

function hideTooltip(tooltip) {
  if (!tooltip) return;
  tooltip.hidden = true;
}

function pct(value, total) {
  return (value / total * 100).toFixed(4) + '%';
}

function clampLevel(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(4, Math.round(n)));
}
