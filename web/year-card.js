// Year Review card (PRD 2.0 §P3-3 prototype) — a share artifact for the
// current local calendar year, computed only from GardenSummary. It deliberately
// does not auto-offer itself: annual rituals are calendar-locked later, while
// this v1.8 flow gives the share drawer a manually requested year-to-date card.

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
  PAPER_EDGE,
  canvasToPngBlob,
  drawPaperFrame,
  ensureCardFonts,
  fitOneLine
} from './card-canvas.js';
import { escapeHtml, fmtLocal } from './render-helpers.js';
import { t } from './i18n.js';

export function localCalendarDay(now = new Date()) {
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

export function yearToDateWindow(anchor = localCalendarDay()) {
  const year = Number(anchor?.year) || new Date().getFullYear();
  const month = clampInt(anchor?.month, 1, 12);
  const day = clampInt(anchor?.day, 1, daysInMonth(year, month));
  const startMs = Date.UTC(year, 0, 1);
  const endMs = Date.UTC(year, month - 1, day);
  const days = [];
  for (let ms = startMs; ms <= endMs; ms += DAY_MS) days.push(utcDayKey(ms));
  return { year, start: days[0], end: days[days.length - 1], days };
}

export function yearStats(summary, range) {
  const days = Array.isArray(range?.days) ? range.days : [];
  const totals = yearDailyTotals(summary, days);
  const totalTokens = totals.reduce((sum, value) => sum + value, 0);
  const activeDays = totals.filter((value) => value > 0).length;
  let busiestDay = null;
  totals.forEach((tokens, index) => {
    if (tokens > 0 && (!busiestDay || tokens > busiestDay.tokens)) {
      busiestDay = { day: days[index], tokens };
    }
  });

  const monthTotals = new Array(12).fill(0);
  days.forEach((day, index) => {
    monthTotals[monthIndex(day)] += totals[index] || 0;
  });

  const projects = Array.isArray(summary?.projects) ? summary.projects : [];
  const projectTotals = projects
    .map((project) => ({
      name: project?.display_name || '',
      tokens: sumWindow(project?.daily_tokens, days)
    }))
    .filter((entry) => entry.name && entry.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens);

  return {
    year: range?.year,
    totalTokens,
    activeDays,
    activeProjects: projectTotals.length,
    topProjects: projectTotals.slice(0, 5),
    busiestDay,
    monthTotals
  };
}

function yearDailyTotals(summary, days) {
  const rollup = summary?.daily_tokens;
  if (rollup && typeof rollup === 'object') {
    return days.map((day) => toCount(rollup[day]));
  }
  const projects = Array.isArray(summary?.projects) ? summary.projects : [];
  return days.map((day) =>
    projects.reduce((sum, project) => sum + toCount(project?.daily_tokens?.[day]), 0)
  );
}

function sumWindow(map, days) {
  if (!map || typeof map !== 'object') return 0;
  let sum = 0;
  for (const day of days) sum += toCount(map[day]);
  return sum;
}

function toCount(value) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function suggestedYearName(range) {
  return 'garden-year-' + (range?.year || 'unknown') + '.png';
}

export async function buildYearCanvas({ summary, now = new Date() }) {
  const range = yearToDateWindow(localCalendarDay(now));
  const stats = yearStats(summary, range);
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

  ctx.fillStyle = INK;
  ctx.fillRect(40, 40, CARD_W - 80, 92);
  ctx.fillStyle = PAPER_EDGE;
  ctx.fillRect(48, 48, 18, 76);
  ctx.fillStyle = '#f4ecd8';
  ctx.font = '700 43px ' + FONT_PIXEL;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(fitOneLine(ctx, t('share.year.title'), CARD_W - 150), 78, 88);

  ctx.fillStyle = MUTED;
  ctx.font = '34px ' + FONT_NUM;
  ctx.textAlign = 'right';
  ctx.fillText(range.start + ' – ' + range.end + ' · UTC', CARD_W - 66, 176);

  drawMonthBlocks(ctx, stats.monthTotals, { x: 66, y: 216, w: CARD_W - 132, h: 398 });

  ctx.fillStyle = INK;
  ctx.font = '86px ' + FONT_NUM;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(
    fitOneLine(ctx, t('postcard.tokens', { total: fmtLocal(stats.totalTokens) }), CARD_W - 132),
    66,
    704
  );

  const detailLine =
    t('share.year.activeDays', { count: stats.activeDays }) +
    ' · ' +
    t('share.year.activeProjects', { count: stats.activeProjects });
  ctx.fillStyle = MUTED;
  ctx.font = '34px ' + FONT_STACK;
  ctx.fillText(fitOneLine(ctx, detailLine, CARD_W - 132), 66, 758);

  drawBusiestDay(ctx, stats, { x: 66, y: 800, w: CARD_W - 132 });
  drawTopProjects(ctx, stats, { x: 66, y: 902, w: CARD_W - 132 });

  ctx.fillStyle = MUTED;
  ctx.font = '34px ' + FONT_STACK;
  ctx.textAlign = 'left';
  ctx.fillText(fitOneLine(ctx, t('share.year.closing'), CARD_W - 132), 66, 1130);

  ctx.fillStyle = MUTED;
  ctx.font = '24px ' + FONT_PIXEL;
  ctx.textAlign = 'center';
  ctx.fillText('pixel-agent-garden', CARD_W / 2, 1218);
}

function drawMonthBlocks(ctx, monthTotals, box) {
  ctx.fillStyle = CREAM;
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4;
  ctx.strokeRect(box.x + 2, box.y + 2, box.w - 4, box.h - 4);

  const labels = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
  const cols = 4;
  const rows = 3;
  const gap = 18;
  const cellW = (box.w - gap * (cols + 1)) / cols;
  const cellH = (box.h - gap * (rows + 1)) / rows;
  const max = Math.max(...monthTotals, 1);
  for (let i = 0; i < 12; i += 1) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = box.x + gap + col * (cellW + gap);
    const y = box.y + gap + row * (cellH + gap);
    const active = monthTotals[i] > 0;
    ctx.fillStyle = active ? '#e8d7ad' : '#efe4c8';
    ctx.fillRect(x, y, cellW, cellH);
    ctx.strokeStyle = active ? INK : PAPER_EDGE;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, cellW - 2, cellH - 2);
    const fillH = active ? Math.max(8, Math.round((monthTotals[i] / max) * (cellH - 42) / 8) * 8) : 0;
    ctx.fillStyle = active ? GREEN : PAPER_EDGE;
    if (fillH > 0) ctx.fillRect(x + 12, y + cellH - 24 - fillH, cellW - 24, fillH);
    ctx.fillStyle = MUTED;
    ctx.font = '30px ' + FONT_NUM;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(labels[i], x + 12, y + cellH - 10);
  }
}

function drawBusiestDay(ctx, stats, box) {
  ctx.fillStyle = CREAM;
  ctx.fillRect(box.x, box.y, box.w, 62);
  ctx.strokeStyle = PAPER_EDGE;
  ctx.lineWidth = 2;
  ctx.strokeRect(box.x + 1, box.y + 1, box.w - 2, 60);
  ctx.fillStyle = MUTED;
  ctx.font = '32px ' + FONT_STACK;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const line = stats.busiestDay
    ? t('share.year.busiest', {
      day: stats.busiestDay.day,
      tokens: fmtLocal(stats.busiestDay.tokens)
    })
    : t('share.year.noActivity');
  ctx.fillText(fitOneLine(ctx, line, box.w - 28), box.x + 14, box.y + 32);
}

function drawTopProjects(ctx, stats, box) {
  ctx.textBaseline = 'middle';
  if (!stats.topProjects.length) {
    ctx.fillStyle = MUTED;
    ctx.font = '34px ' + FONT_STACK;
    ctx.textAlign = 'left';
    ctx.fillText(fitOneLine(ctx, t('share.year.noActivity'), box.w), box.x, box.y + 18);
    return;
  }
  stats.topProjects.slice(0, 5).forEach((entry, index) => {
    const y = box.y + index * 54 + 18;
    ctx.fillStyle = index === 0 ? GREEN : PAPER_EDGE;
    ctx.fillRect(box.x, y - 10, 20, 20);
    const tokens = fmtLocal(entry.tokens);
    ctx.font = '40px ' + FONT_NUM;
    const tokensW = ctx.measureText(tokens).width;
    ctx.fillStyle = INK;
    ctx.textAlign = 'right';
    ctx.fillText(tokens, box.x + box.w, y);
    ctx.textAlign = 'left';
    ctx.font = '600 30px ' + FONT_STACK;
    ctx.fillText(fitOneLine(ctx, entry.name, box.w - 44 - tokensW - 24), box.x + 44, y);
  });
}

export function mountYearCardContent({ host, getSummary, onError, onRequestClose }) {
  host.innerHTML =
    '<div class="pg6-postcard-title">' + escapeHtml(t('share.year.name')) + '</div>' +
    '<canvas class="pg6-year-preview" width="960" height="1280" aria-hidden="true"></canvas>' +
    '<div class="pg6-postcard-actions">' +
    '<button class="pg6-postcard-export" type="button">' + escapeHtml(t('postcard.export')) + '</button>' +
    '<span class="pg6-postcard-status" aria-live="polite"></span>' +
    '</div>';
  const preview = host.querySelector('.pg6-year-preview');
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
      const saved = await savePostcard(blob, suggestedYearName(lastRange));
      setStatus(saved ? t('postcard.saved') : t('postcard.cancelled'));
      if (saved) onRequestClose?.();
    } catch (err) {
      setStatus(t('postcard.error'));
      if (typeof onError === 'function') onError('year card export failed', err);
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
      const { canvas, range } = await buildYearCanvas({
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
      if (typeof onError === 'function') onError('year card preview failed', err);
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
      renderPreview();
      exportButton.focus();
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

function monthIndex(day) {
  return Math.max(0, Math.min(11, Number(String(day).slice(5, 7)) - 1));
}

function utcDayKey(ms) {
  const d = new Date(ms);
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
}

function pad2(n) {
  return String(n).padStart(2, '0');
}
