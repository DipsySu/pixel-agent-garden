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

export function renderFlowerbed(scene, flowerSprites, summary, options = {}) {
  const sprites = Array.isArray(flowerSprites) ? flowerSprites : [];
  if (!scene || !sprites.length) return;

  const spriteRoot = options.spriteRoot || '';
  const days = flowerbedDays(summary, options.now);
  if (!days.length) return;

  const tooltip = ensureTooltip(scene);
  const byName = new Map(sprites.map((sprite) => [sprite.name, sprite]));

  days.slice(0, DAYS).forEach((day, index) => {
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

    const img = document.createElement('img');
    img.className = `pg6-flower level-${level}`;
    img.src = spriteRoot + sprite.file;
    img.alt = '';
    img.decoding = 'async';
    img.loading = 'lazy';
    img.title = title;
    img.tabIndex = 0;
    img.dataset.date = day.date;
    img.dataset.activity = String(day.activity || 0);
    img.dataset.level = String(level);
    img.style.left = pct(x, SCENE_W);
    img.style.top = pct(y, SCENE_H);
    img.style.width = pct(width, SCENE_W);
    img.style.zIndex = String(16 + row);
    img.style.setProperty('--flower-transform', 'translate(-50%, -100%)');
    img.addEventListener('mouseenter', () => showTooltip(tooltip, title, x, y));
    img.addEventListener('focus', () => showTooltip(tooltip, title, x, y));
    img.addEventListener('mouseleave', () => hideTooltip(tooltip));
    img.addEventListener('blur', () => hideTooltip(tooltip));
    scene.append(img);
  });
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

function showTooltip(tooltip, text, x, y) {
  tooltip.innerHTML = escapeHtml(text);
  tooltip.style.left = pct(Math.min(SCENE_W - 78, Math.max(78, x)), SCENE_W);
  tooltip.style.top = pct(Math.max(352, y - 26), SCENE_H);
  tooltip.hidden = false;
}

function hideTooltip(tooltip) {
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
