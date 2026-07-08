// Seasonal Moment card (PRD 2.0 §P3-2) — a local-calendar share artifact for
// the garden's current season. No weather API, no lunar lookup, no network:
// four deterministic seasonal modes are derived from the user's local date and
// rendered through the same portrait card DNA as weekly/year cards.

import { savePostcard } from './data-source.js';
import {
  CARD_H,
  CARD_W,
  CREAM,
  DAY_MS,
  FONT_NUM,
  FONT_PIXEL,
  FONT_STACK,
  GREEN,
  INK,
  MUTED,
  PAPER,
  PAPER_EDGE,
  canvasToPngBlob,
  dailyTotals,
  drawPaperFrame,
  ensureCardFonts,
  fitOneLine,
  localCalendarDay,
  sumWindow,
  utcDayKey
} from './card-canvas.js';
import { escapeHtml, fmtLocal } from './render-helpers.js';
import { t } from './i18n.js';

const MOMENTS = {
  cherry: { id: 'cherry', season: 'spring', color: '#e989b2' },
  koi: { id: 'koi', season: 'summer', color: '#d87938' },
  moon: { id: 'moon', season: 'autumn', color: '#d8b460' },
  snow: { id: 'snow', season: 'winter', color: '#b9d2dc' },
};

export function seasonalMoment(anchor = localCalendarDay()) {
  const month = clampInt(anchor?.month, 1, 12);
  if (month >= 3 && month <= 5) return MOMENTS.cherry;
  if (month >= 6 && month <= 8) return MOMENTS.koi;
  if (month >= 9 && month <= 11) return MOMENTS.moon;
  return MOMENTS.snow;
}

export function seasonalWindow(anchor = localCalendarDay()) {
  const year = Number(anchor?.year) || new Date().getFullYear();
  const month = clampInt(anchor?.month, 1, 12);
  const day = clampInt(anchor?.day, 1, daysInMonth(year, month));
  const moment = seasonalMoment({ year, month, day });
  let startYear = year;
  let startMonth = 1;
  if (moment.id === 'cherry') startMonth = 3;
  else if (moment.id === 'koi') startMonth = 6;
  else if (moment.id === 'moon') startMonth = 9;
  else {
    startMonth = 12;
    if (month <= 2) startYear = year - 1;
  }
  const startMs = Date.UTC(startYear, startMonth - 1, 1);
  const endMs = Date.UTC(year, month - 1, day);
  const days = [];
  for (let ms = startMs; ms <= endMs; ms += DAY_MS) days.push(utcDayKey(ms));
  return { moment, start: days[0], end: days[days.length - 1], days };
}

export function seasonalStats(summary, range) {
  const days = Array.isArray(range?.days) ? range.days : [];
  const totals = dailyTotals(summary, days);
  const totalTokens = totals.reduce((sum, value) => sum + value, 0);
  const activeDays = totals.filter((value) => value > 0).length;
  const projects = Array.isArray(summary?.projects) ? summary.projects : [];
  const topProjects = projects
    .map((project) => ({
      name: project?.display_name || '',
      tokens: sumWindow(project?.daily_tokens, days)
    }))
    .filter((entry) => entry.name && entry.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 3);
  return { totalTokens, activeDays, topProjects };
}

export function suggestedSeasonalName(range) {
  const id = range?.moment?.id || 'season';
  return 'garden-seasonal-' + id + '-' + (range?.end || 'unknown') + '.png';
}

export async function buildSeasonalCanvas({ summary, now = new Date(), anchor = localCalendarDay(now) }) {
  const range = seasonalWindow(anchor);
  const stats = seasonalStats(summary, range);
  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2D context unavailable');
  ctx.imageSmoothingEnabled = false;
  await ensureCardFonts();
  drawCard(ctx, range, stats);
  return { canvas, range, stats };
}

function drawCard(ctx, range, stats) {
  drawPaperFrame(ctx);
  const moment = range.moment || MOMENTS.cherry;

  ctx.fillStyle = INK;
  ctx.fillRect(40, 40, CARD_W - 80, 92);
  ctx.fillStyle = moment.color;
  ctx.fillRect(48, 48, 18, 76);
  ctx.fillStyle = PAPER;
  ctx.font = '700 43px ' + FONT_PIXEL;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(fitOneLine(ctx, t('share.seasonal.title'), CARD_W - 150), 78, 88);

  ctx.fillStyle = MUTED;
  ctx.font = '34px ' + FONT_NUM;
  ctx.textAlign = 'right';
  ctx.fillText(range.start + ' – ' + range.end + ' · UTC', CARD_W - 66, 176);

  drawSeasonVisual(ctx, moment, { x: 66, y: 216, w: CARD_W - 132, h: 500 });

  ctx.fillStyle = INK;
  ctx.font = '84px ' + FONT_NUM;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(
    fitOneLine(ctx, t('postcard.tokens', { total: fmtLocal(stats.totalTokens) }), CARD_W - 132),
    66,
    810
  );

  ctx.fillStyle = MUTED;
  ctx.font = '34px ' + FONT_STACK;
  ctx.fillText(
    fitOneLine(ctx, seasonalSubtitle(moment, stats), CARD_W - 132),
    66,
    868
  );

  drawTopProjects(ctx, stats, { x: 66, y: 940, w: CARD_W - 132 });

  ctx.fillStyle = MUTED;
  ctx.font = '34px ' + FONT_STACK;
  ctx.textAlign = 'left';
  ctx.fillText(fitOneLine(ctx, t('share.seasonal.closing'), CARD_W - 132), 66, 1130);

  ctx.fillStyle = MUTED;
  ctx.font = '24px ' + FONT_PIXEL;
  ctx.textAlign = 'center';
  ctx.fillText('pixel-agent-garden', CARD_W / 2, 1218);
}

function seasonalSubtitle(moment, stats) {
  return t('share.seasonal.' + moment.id + '.subtitle', {
    tokens: fmtLocal(stats.totalTokens),
    days: stats.activeDays
  });
}

function drawSeasonVisual(ctx, moment, box) {
  ctx.fillStyle = CREAM;
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4;
  ctx.strokeRect(box.x + 2, box.y + 2, box.w - 4, box.h - 4);
  if (moment.id === 'cherry') return drawCherry(ctx, box);
  if (moment.id === 'koi') return drawKoi(ctx, box);
  if (moment.id === 'moon') return drawMoon(ctx, box);
  return drawSnow(ctx, box);
}

function drawCherry(ctx, box) {
  drawPixelTrunk(ctx, box.x + box.w * 0.50, box.y + 300, 42, 108);
  const blossoms = [
    [0.42, 0.30, 92], [0.52, 0.24, 104], [0.61, 0.34, 86],
    [0.36, 0.45, 76], [0.55, 0.48, 82]
  ];
  for (const [x, y, size] of blossoms) {
    ctx.fillStyle = '#e989b2';
    pixelBlock(ctx, box.x + box.w * x, box.y + box.h * y, size, size * 0.62);
    ctx.fillStyle = '#ffd3df';
    pixelBlock(ctx, box.x + box.w * x - size * 0.18, box.y + box.h * y - size * 0.14, size * 0.34, size * 0.22);
  }
  ctx.fillStyle = '#d66d9b';
  for (let i = 0; i < 20; i += 1) {
    ctx.fillRect(box.x + 70 + i * 36, box.y + 360 + (i % 5) * 18, 10, 8);
  }
}

function drawKoi(ctx, box) {
  ctx.fillStyle = '#7fa7a0';
  ctx.fillRect(box.x + 76, box.y + 84, box.w - 152, box.h - 168);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4;
  ctx.strokeRect(box.x + 78, box.y + 86, box.w - 156, box.h - 172);
  drawFish(ctx, box.x + box.w * 0.42, box.y + box.h * 0.48, '#d87938', false);
  drawFish(ctx, box.x + box.w * 0.60, box.y + box.h * 0.58, '#f4ecd8', true);
  ctx.fillStyle = '#6f9c3f';
  for (let i = 0; i < 12; i += 1) ctx.fillRect(box.x + 110 + i * 58, box.y + 120 + (i % 3) * 48, 16, 8);
}

function drawMoon(ctx, box) {
  ctx.fillStyle = '#31405a';
  ctx.fillRect(box.x + 58, box.y + 60, box.w - 116, box.h - 120);
  drawPixelMoon(ctx, box.x + box.w * 0.66, box.y + box.h * 0.30);
  ctx.fillStyle = '#d8b460';
  for (let i = 0; i < 16; i += 1) {
    ctx.fillRect(box.x + 110 + i * 42, box.y + 128 + (i % 4) * 54, 8, 8);
  }
  ctx.fillStyle = '#8e5e2d';
  pixelBlock(ctx, box.x + box.w * 0.34, box.y + box.h * 0.62, 190, 24);
  ctx.fillStyle = '#b56d39';
  pixelBlock(ctx, box.x + box.w * 0.30, box.y + box.h * 0.68, 34, 76);
  pixelBlock(ctx, box.x + box.w * 0.48, box.y + box.h * 0.68, 34, 76);
}

function drawSnow(ctx, box) {
  ctx.fillStyle = '#dbe6e7';
  ctx.fillRect(box.x + 58, box.y + 54, box.w - 116, box.h - 108);
  ctx.fillStyle = '#f8fbf8';
  for (let i = 0; i < 40; i += 1) {
    const x = box.x + 84 + ((i * 67) % Math.round(box.w - 168));
    const y = box.y + 78 + ((i * 41) % Math.round(box.h - 160));
    ctx.fillRect(x, y, i % 3 === 0 ? 10 : 7, i % 3 === 0 ? 10 : 7);
  }
  ctx.fillStyle = '#8b7a62';
  drawPixelTrunk(ctx, box.x + box.w * 0.50, box.y + 310, 34, 94);
  ctx.fillStyle = '#f8fbf8';
  pixelBlock(ctx, box.x + box.w * 0.50, box.y + 252, 180, 54);
  pixelBlock(ctx, box.x + box.w * 0.50, box.y + 308, 132, 44);
}

function drawTopProjects(ctx, stats, box) {
  const rows = stats.topProjects || [];
  if (!rows.length) {
    ctx.fillStyle = MUTED;
    ctx.font = '34px ' + FONT_STACK;
    ctx.textAlign = 'left';
    ctx.fillText(fitOneLine(ctx, t('share.seasonal.empty'), box.w), box.x, box.y + 18);
    return;
  }
  rows.forEach((entry, index) => {
    const y = box.y + index * 58 + 18;
    ctx.fillStyle = index === 0 ? GREEN : PAPER_EDGE;
    ctx.fillRect(box.x, y - 10, 20, 20);
    const tokens = fmtLocal(entry.tokens);
    ctx.font = '42px ' + FONT_NUM;
    const tokensW = ctx.measureText(tokens).width;
    ctx.fillStyle = INK;
    ctx.textAlign = 'right';
    ctx.fillText(tokens, box.x + box.w, y);
    ctx.textAlign = 'left';
    ctx.font = '600 30px ' + FONT_STACK;
    ctx.fillText(fitOneLine(ctx, entry.name, box.w - 44 - tokensW - 24), box.x + 44, y);
  });
}

function drawPixelTrunk(ctx, cx, y, w, h) {
  ctx.fillStyle = '#5b392a';
  pixelBlock(ctx, cx, y, w, h);
  ctx.fillStyle = '#7c4b32';
  pixelBlock(ctx, cx - w * 0.20, y - h * 0.06, w * 0.32, h * 0.88);
}

function drawFish(ctx, cx, cy, color, flip) {
  ctx.fillStyle = color;
  pixelBlock(ctx, cx, cy, 96, 36);
  ctx.fillStyle = '#2c2316';
  ctx.fillRect(cx + (flip ? -38 : 34), cy - 6, 8, 8);
  ctx.fillStyle = '#c95135';
  ctx.fillRect(cx + (flip ? 42 : -58), cy - 12, 30, 24);
}

function drawPixelMoon(ctx, cx, cy) {
  ctx.fillStyle = '#f0d98a';
  pixelBlock(ctx, cx, cy, 132, 132);
  ctx.fillStyle = '#31405a';
  pixelBlock(ctx, cx + 36, cy - 16, 72, 104);
}

function pixelBlock(ctx, cx, cy, w, h) {
  ctx.fillRect(Math.round(cx - w / 2), Math.round(cy - h / 2), Math.round(w), Math.round(h));
}

export function mountSeasonalCardContent({ host, getSummary, onError, onRequestClose }) {
  host.innerHTML =
    '<div class="pg6-postcard-title">' + escapeHtml(t('share.seasonal.name')) + '</div>' +
    '<canvas class="pg6-seasonal-preview" width="960" height="1280" aria-hidden="true"></canvas>' +
    '<div class="pg6-postcard-actions">' +
    '<button class="pg6-postcard-export" type="button">' + escapeHtml(t('postcard.export')) + '</button>' +
    '<span class="pg6-postcard-status" aria-live="polite"></span>' +
    '</div>';
  const preview = host.querySelector('.pg6-seasonal-preview');
  const exportButton = host.querySelector('.pg6-postcard-export');
  const status = host.querySelector('.pg6-postcard-status');
  let lastCanvas = null;
  let lastRange = null;
  let rendering = false;

  exportButton.addEventListener('click', async () => {
    if (rendering) return;
    if (!lastCanvas) await renderPreview();
    if (!lastCanvas) return;
    exportButton.disabled = true;
    setStatus(t('postcard.exporting'));
    try {
      const blob = await canvasToPngBlob(lastCanvas);
      const saved = await savePostcard(blob, suggestedSeasonalName(lastRange));
      setStatus(saved ? t('postcard.saved') : t('postcard.cancelled'));
      if (saved) onRequestClose?.();
    } catch (err) {
      setStatus(t('postcard.error'));
      if (typeof onError === 'function') onError('seasonal card export failed', err);
    } finally {
      exportButton.disabled = false;
    }
  });

  async function renderPreview() {
    if (rendering) return;
    rendering = true;
    lastCanvas = null;
    exportButton.disabled = true;
    setStatus(t('postcard.rendering'));
    try {
      const { canvas, range } = await buildSeasonalCanvas({
        summary: typeof getSummary === 'function' ? getSummary() : null
      });
      lastCanvas = canvas;
      lastRange = range;
      if (preview instanceof HTMLCanvasElement) {
        preview.width = canvas.width;
        preview.height = canvas.height;
        const pctx = preview.getContext('2d');
        if (pctx) { pctx.imageSmoothingEnabled = false; pctx.drawImage(canvas, 0, 0); }
      }
      setStatus('');
    } catch (err) {
      setStatus(t('postcard.error'));
      if (typeof onError === 'function') onError('seasonal card preview failed', err);
    } finally {
      rendering = false;
      exportButton.disabled = false;
    }
  }

  function setStatus(value) {
    if (status) status.textContent = value || '';
  }

  return {
    activate: () => {
      renderPreview().then(() => exportButton.focus());
    }
  };
}

function clampInt(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
