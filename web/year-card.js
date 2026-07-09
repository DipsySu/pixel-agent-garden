// Year Review cards (PRD 2.0 §P3-3) — a five-card share artifact for the
// current local calendar year, computed only from GardenSummary. The share
// drawer can open it manually, while the scene banner offers it during the
// first local week of December when the year has enough activity.

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
import { escapeHtml, fmtLocal, sourceLabel } from './render-helpers.js';
import { ringDate, ringEventTitle } from './rings-panel.js';
import { t } from './i18n.js';

export const YEAR_CARD_TYPES = ['cover', 'growth', 'peak', 'partners', 'seed'];
const OFFERED_KEY = 'pg6.year.offered';

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
  const totals = dailyTotals(summary, days);
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
    monthTotals[monthIndex(day)] += totals[index];
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
    monthTotals,
    sourceRows: yearSourceRows(summary)
  };
}

export function suggestedYearName(range) {
  return 'garden-year-' + (range?.year || 'unknown') + '.png';
}

export function suggestedYearDeckName(range) {
  return 'garden-year-' + (range?.year || 'unknown') + '-set.png';
}

export function yearOfferKey(range) {
  return range?.year ? String(range.year) : null;
}

export function shouldOfferYearReview({ summary, now = new Date(), storage } = {}) {
  const anchor = localCalendarDay(now);
  // The annual ritual unlocks in the first local week of December. The card
  // itself is year-to-date and remains manually available all year.
  if (anchor.month !== 12 || anchor.day > 7) return null;
  const range = yearToDateWindow(anchor);
  const stats = yearStats(summary, range);
  if (stats.totalTokens <= 0) return null;
  const key = yearOfferKey(range);
  if (!key || readOffered(storage) === key) return null;
  return { key, range, stats };
}

export function recordYearOffer(key, storage) {
  if (!key) return;
  try {
    storage?.setItem(OFFERED_KEY, key);
  } catch (_) {
    // Blocked storage only means the annual banner can show again next launch.
  }
}

export async function buildYearCanvas({ summary, now = new Date(), anchor = localCalendarDay(now) }) {
  const range = yearToDateWindow(anchor);
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

// `rings` is the (possibly null) RingBook from loadRings(); only the growth
// card reads it, and it degrades to a quiet empty state when null — demo and
// browser fallback pass null here (loadRings is demo/Tauri-gated).
export async function buildYearDeckCanvases({ summary, rings = null, now = new Date(), anchor = localCalendarDay(now) } = {}) {
  const range = yearToDateWindow(anchor);
  const stats = yearStats(summary, range);
  await ensureCardFonts();
  const cards = YEAR_CARD_TYPES.map((type) => {
    const canvas = document.createElement('canvas');
    canvas.width = CARD_W;
    canvas.height = CARD_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2D context unavailable');
    ctx.imageSmoothingEnabled = false;
    drawYearDeckCard(ctx, type, range, stats, rings);
    return { type, title: t('share.year.card.' + type), canvas };
  });
  return { cards, range, stats };
}

export async function buildYearDeckCanvas(options = {}) {
  const deck = await buildYearDeckCanvases(options);
  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H * deck.cards.length;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2D context unavailable');
  ctx.imageSmoothingEnabled = false;
  deck.cards.forEach((card, index) => {
    ctx.drawImage(card.canvas, 0, index * CARD_H);
  });
  return { ...deck, canvas };
}

function drawCard(ctx, range, stats) {
  drawPaperFrame(ctx);

  ctx.fillStyle = INK;
  ctx.fillRect(40, 40, CARD_W - 80, 92);
  ctx.fillStyle = PAPER_EDGE;
  ctx.fillRect(48, 48, 18, 76);
  ctx.fillStyle = PAPER;
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
  // Closing line sits below whatever the top-projects block actually drew
  // (0..5 rows), so a 5-project card no longer overprints it — the y-rhythm
  // is derived, not a fixed weekly-3-row assumption.
  const projectsBottom = drawTopProjects(ctx, stats, { x: 66, y: 902, w: CARD_W - 132 });

  ctx.fillStyle = MUTED;
  ctx.font = '34px ' + FONT_STACK;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(fitOneLine(ctx, t('share.year.closing'), CARD_W - 132), 66, projectsBottom + 44);

  ctx.fillStyle = MUTED;
  ctx.font = '24px ' + FONT_PIXEL;
  ctx.textAlign = 'center';
  ctx.fillText('pixel-agent-garden', CARD_W / 2, 1218);
}

function drawYearDeckCard(ctx, type, range, stats, rings) {
  if (type === 'cover') return drawCoverCard(ctx, range, stats);
  if (type === 'growth') return drawGrowthCard(ctx, range, rings);
  if (type === 'peak') return drawPeakCard(ctx, range, stats);
  if (type === 'partners') return drawPartnersCard(ctx, range, stats);
  if (type === 'seed') return drawSeedCard(ctx, range, stats);
  return drawCard(ctx, range, stats);
}

// Milestone types float to the top when curating: a year with dozens of
// first-seen rows should still surface the tier-ups and unlocks that matter.
const GROWTH_MILESTONE_TYPES = new Set(['tier_up', 'trinket_unlocked', 'busiest_day_record']);
const GROWTH_MAX_MOMENTS = 5;

// Ring events whose UTC day falls in the card's calendar year. Matching on the
// year (not the year-to-date day list) keeps this cheap and independent of the
// anchor; the book is append-only so this is already chronological-ish but we
// sort defensively below.
function yearRingEvents(book, range) {
  const events = Array.isArray(book?.events) ? book.events : [];
  const year = String(range?.year ?? '');
  if (!year) return [];
  return events.filter((event) => String(event?.utc_date || '').slice(0, 4) === year);
}

function compareRingDate(a, b) {
  const da = String(a?.utc_date || '');
  const db = String(b?.utc_date || '');
  return da < db ? -1 : da > db ? 1 : 0;
}

// The growth card's "年轮精选 5 时刻" (PRD §P3-3 item 2): up to five curated
// ring moments for the year, chronological top→bottom. ≤5 shows them all in
// date order; >5 prefers milestone types and the earliest first-seen, then
// fills by date. Exported so the curation rule is unit-testable without a
// canvas. A null/empty book yields [] and the card draws its quiet fallback.
export function curateGrowthMoments(book, range) {
  const chronological = yearRingEvents(book, range).slice().sort(compareRingDate);
  if (chronological.length <= GROWTH_MAX_MOMENTS) return chronological;

  const picked = [];
  const seen = new Set();
  const take = (event) => {
    if (picked.length >= GROWTH_MAX_MOMENTS || !event || seen.has(event)) return;
    seen.add(event);
    picked.push(event);
  };
  for (const event of chronological) {
    if (GROWTH_MILESTONE_TYPES.has(event?.type)) take(event);
  }
  take(chronological.find((event) => event?.type === 'first_seen_project'));
  for (const event of chronological) take(event);
  return picked.sort(compareRingDate);
}

function drawGrowthCard(ctx, range, rings) {
  drawDeckHeader(ctx, range, 'growth', GREEN);
  const moments = curateGrowthMoments(rings, range);
  if (!moments.length) {
    // No book (demo/browser), or a year with no recorded moments: one calm
    // centered line rather than a blank card or a crash.
    ctx.fillStyle = MUTED;
    ctx.font = '38px ' + FONT_STACK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(fitOneLine(ctx, t('share.year.growth.empty'), CARD_W - 180), CARD_W / 2, CARD_H / 2);
    drawWatermark(ctx);
    return;
  }
  drawGrowthTimeline(ctx, moments, { x: 66, y: 196, w: CARD_W - 132, h: 954 });
  drawWatermark(ctx);
}

// A vertical timeline on a cream panel: a paper-edge spine bar (drawn as a
// filled rect, never a stroked path — keeps the pixel look and needs no
// beginPath from the injected test ctx), a node per moment, and a two-line
// entry (UTC date + localized title) to its right. Rows are distributed evenly
// so 1..5 moments always read as a balanced column. Titles come from
// ringEventTitle — name/label-based and localized, so no raw project path or
// internal key can leak onto a shareable card (privacy契约).
function drawGrowthTimeline(ctx, moments, box) {
  ctx.fillStyle = CREAM;
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4;
  ctx.strokeRect(box.x + 2, box.y + 2, box.w - 4, box.h - 4);

  const spineX = box.x + 78;
  const count = moments.length;
  const pad = 108;
  const pitch = count > 1 ? (box.h - pad * 2) / (count - 1) : 0;
  const firstY = count > 1 ? box.y + pad : box.y + box.h / 2;
  const lastY = firstY + pitch * (count - 1);

  ctx.fillStyle = PAPER_EDGE;
  ctx.fillRect(spineX - 3, firstY, 6, Math.max(0, lastY - firstY));

  const textX = spineX + 52;
  const textW = box.x + box.w - textX - 28;
  moments.forEach((event, index) => {
    const y = firstY + pitch * index;
    // First moment gets the action green; the rest the muted tile used across
    // the deck's month blocks, so the column reads as one material.
    ctx.fillStyle = index === 0 ? GREEN : '#e8d7ad';
    ctx.fillRect(spineX - 15, y - 15, 30, 30);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.strokeRect(spineX - 15, y - 15, 30, 30);

    ctx.fillStyle = MUTED;
    ctx.font = '30px ' + FONT_NUM;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(fitOneLine(ctx, ringDate(event.utc_date), textW), textX, y - 8);

    ctx.fillStyle = INK;
    ctx.font = '600 38px ' + FONT_STACK;
    ctx.textBaseline = 'top';
    ctx.fillText(fitOneLine(ctx, ringEventTitle(event), textW), textX, y + 4);
  });
}

function drawDeckHeader(ctx, range, type, accent = PAPER_EDGE) {
  drawPaperFrame(ctx);
  ctx.fillStyle = INK;
  ctx.fillRect(40, 40, CARD_W - 80, 92);
  ctx.fillStyle = accent;
  ctx.fillRect(48, 48, 18, 76);
  ctx.fillStyle = PAPER;
  ctx.font = '700 40px ' + FONT_PIXEL;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(fitOneLine(ctx, t('share.year.card.' + type), CARD_W - 150), 78, 88);
  ctx.fillStyle = MUTED;
  ctx.font = '30px ' + FONT_NUM;
  ctx.textAlign = 'right';
  ctx.fillText(String(range?.year || '----'), CARD_W - 66, 88);
}

function drawWatermark(ctx) {
  ctx.fillStyle = MUTED;
  ctx.font = '24px ' + FONT_PIXEL;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('pixel-agent-garden', CARD_W / 2, 1218);
}

function drawCoverCard(ctx, range, stats) {
  drawDeckHeader(ctx, range, 'cover', GREEN);
  ctx.fillStyle = CREAM;
  ctx.fillRect(66, 196, CARD_W - 132, 500);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4;
  ctx.strokeRect(68, 198, CARD_W - 136, 496);

  ctx.fillStyle = INK;
  ctx.font = '170px ' + FONT_NUM;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(range.year), CARD_W / 2, 360);
  ctx.font = '44px ' + FONT_PIXEL;
  ctx.fillText(fitOneLine(ctx, t('share.year.deckTitle'), CARD_W - 180), CARD_W / 2, 502);

  ctx.fillStyle = GREEN;
  pixelSeed(ctx, CARD_W / 2, 620, 104);

  ctx.fillStyle = INK;
  ctx.font = '90px ' + FONT_NUM;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(
    fitOneLine(ctx, t('postcard.tokens', { total: fmtLocal(stats.totalTokens) }), CARD_W - 132),
    66,
    830
  );
  ctx.fillStyle = MUTED;
  ctx.font = '34px ' + FONT_STACK;
  const line =
    t('share.year.activeDays', { count: stats.activeDays }) +
    ' · ' +
    t('share.year.activeProjects', { count: stats.activeProjects });
  ctx.fillText(fitOneLine(ctx, line, CARD_W - 132), 66, 890);
  drawWatermark(ctx);
}

function drawPeakCard(ctx, range, stats) {
  drawDeckHeader(ctx, range, 'peak', '#d8b460');
  ctx.fillStyle = CREAM;
  ctx.fillRect(66, 200, CARD_W - 132, 232);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4;
  ctx.strokeRect(68, 202, CARD_W - 136, 228);
  ctx.fillStyle = MUTED;
  ctx.font = '34px ' + FONT_STACK;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(fitOneLine(ctx, t('share.year.peakIntro'), CARD_W - 170), 96, 270);
  ctx.fillStyle = INK;
  ctx.font = '72px ' + FONT_NUM;
  const peakLine = stats.busiestDay
    ? stats.busiestDay.day + ' · ' + fmtLocal(stats.busiestDay.tokens)
    : t('share.year.noActivity');
  ctx.fillText(fitOneLine(ctx, peakLine, CARD_W - 190), 96, 360);

  const bottom = drawLargeProjectRows(ctx, stats.topProjects.slice(0, 5), { x: 66, y: 520, w: CARD_W - 132 });
  ctx.fillStyle = MUTED;
  ctx.font = '34px ' + FONT_STACK;
  ctx.fillText(fitOneLine(ctx, t('share.year.peakClosing'), CARD_W - 132), 66, bottom + 62);
  drawWatermark(ctx);
}

function drawPartnersCard(ctx, range, stats) {
  drawDeckHeader(ctx, range, 'partners', '#7fa7a0');
  const rows = stats.sourceRows || [];
  ctx.fillStyle = CREAM;
  ctx.fillRect(66, 196, CARD_W - 132, 720);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4;
  ctx.strokeRect(68, 198, CARD_W - 136, 716);
  if (!rows.length) {
    ctx.fillStyle = MUTED;
    ctx.font = '38px ' + FONT_STACK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t('share.year.partnersEmpty'), CARD_W / 2, 530);
  } else {
    const total = rows.reduce((sum, row) => sum + row.value, 0);
    rows.slice(0, 5).forEach((row, index) => {
      const y = 260 + index * 118;
      const share = total > 0 ? row.value / total : 0;
      ctx.fillStyle = index === 0 ? GREEN : PAPER_EDGE;
      ctx.fillRect(104, y, Math.max(18, Math.round(620 * share)), 38);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.strokeRect(104, y, 620, 38);
      ctx.fillStyle = INK;
      ctx.font = '38px ' + FONT_STACK;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(fitOneLine(ctx, row.name, 420), 104, y - 18);
      ctx.textAlign = 'right';
      ctx.font = '38px ' + FONT_NUM;
      ctx.fillText(Math.round(share * 100) + '%', 790, y + 32);
    });
  }
  ctx.fillStyle = MUTED;
  ctx.font = '34px ' + FONT_STACK;
  ctx.textAlign = 'left';
  ctx.fillText(fitOneLine(ctx, t('share.year.partnersClosing'), CARD_W - 132), 66, 1008);
  drawWatermark(ctx);
}

function drawSeedCard(ctx, range, stats) {
  drawDeckHeader(ctx, range, 'seed', '#b9d2dc');
  ctx.fillStyle = CREAM;
  ctx.fillRect(66, 220, CARD_W - 132, 660);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4;
  ctx.strokeRect(68, 222, CARD_W - 136, 656);
  ctx.fillStyle = GREEN;
  pixelSeed(ctx, CARD_W / 2, 502, 180);
  ctx.fillStyle = INK;
  ctx.font = '52px ' + FONT_PIXEL;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(fitOneLine(ctx, t('share.year.seedQuestion'), CARD_W - 190), CARD_W / 2, 760);
  ctx.fillStyle = MUTED;
  ctx.font = '36px ' + FONT_STACK;
  const top = stats.topProjects[0]?.name || t('share.year.noActivity');
  ctx.fillText(fitOneLine(ctx, t('share.year.seedSub', { project: top }), CARD_W - 170), CARD_W / 2, 980);
  drawWatermark(ctx);
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

// Draws the top-project rows and returns the y just past the last one, so the
// caller can flow the closing line below. Empty is NOT handled here — the
// busiest-day line already carries the quiet-year message, so drawing it again
// here would double-print it (both fired on a zero-token year).
const PROJECT_ROW_PITCH = 44;

function drawTopProjects(ctx, stats, box) {
  const rows = stats.topProjects.slice(0, 5);
  if (!rows.length) return box.y;
  ctx.textBaseline = 'middle';
  rows.forEach((entry, index) => {
    const y = box.y + index * PROJECT_ROW_PITCH + 18;
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
  return box.y + rows.length * PROJECT_ROW_PITCH;
}

function drawLargeProjectRows(ctx, rows, box) {
  if (!rows.length) {
    ctx.fillStyle = MUTED;
    ctx.font = '38px ' + FONT_STACK;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(t('share.year.noActivity'), box.x, box.y + 34);
    return box.y + 70;
  }
  rows.forEach((entry, index) => {
    const y = box.y + index * 92;
    ctx.fillStyle = index === 0 ? GREEN : PAPER_EDGE;
    ctx.fillRect(box.x, y, 28, 28);
    const tokens = fmtLocal(entry.tokens);
    ctx.font = '50px ' + FONT_NUM;
    const tokensW = ctx.measureText(tokens).width;
    ctx.fillStyle = INK;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(tokens, box.x + box.w, y + 28);
    ctx.textAlign = 'left';
    ctx.font = '600 38px ' + FONT_STACK;
    ctx.fillText(fitOneLine(ctx, entry.name, box.w - 52 - tokensW - 30), box.x + 52, y + 28);
  });
  return box.y + rows.length * 92;
}

function pixelSeed(ctx, cx, cy, size) {
  const s = Math.round(size / 8);
  ctx.fillRect(cx - s * 2, cy - s * 5, s * 4, s * 10);
  ctx.fillRect(cx - s * 4, cy - s * 2, s * 8, s * 4);
  ctx.fillStyle = '#2f5f35';
  ctx.fillRect(cx - s, cy + s * 3, s * 2, s * 6);
  ctx.fillRect(cx - s * 5, cy + s * 6, s * 10, s * 2);
}

function yearSourceRows(summary) {
  const tokenMap =
    Object.keys(summary?.source_tokens || {}).length
      ? summary.source_tokens
      : (Object.keys(summary?.source_recent_tokens || {}).length ? summary.source_recent_tokens : null);
  const rows = tokenMap
    ? Object.entries(tokenMap).map(([name, usage]) => ({
      name: sourceLabel(name, t),
      value: usageTotal(usage)
    }))
    : Object.entries(summary?.sources || {}).map(([name, value]) => ({
      name: sourceLabel(name, t),
      value: Number(value || 0)
    }));
  return rows
    .filter((row) => row.name && row.value > 0)
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}

function usageTotal(usage) {
  if (typeof usage === 'number') return Number.isFinite(usage) ? usage : 0;
  if (!usage || typeof usage !== 'object') return 0;
  const explicit = Number(usage.total_tokens || 0);
  if (explicit > 0) return explicit;
  return ['input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens']
    .reduce((sum, key) => sum + Number(usage[key] || 0), 0);
}

function readOffered(storage) {
  try {
    return storage?.getItem(OFFERED_KEY) ?? null;
  } catch (_) {
    return null;
  }
}

export function mountYearCardContent({ host, getSummary, onError, onRequestClose, loadRings }) {
  host.innerHTML =
    '<div class="pg6-postcard-title">' + escapeHtml(t('share.year.name')) + '</div>' +
    '<canvas class="pg6-year-preview" width="960" height="1280" aria-hidden="true"></canvas>' +
    '<div class="pg6-year-deck-nav">' +
    '<button class="pg6-year-prev" type="button" aria-label="' + escapeHtml(t('share.year.prev')) + '">‹</button>' +
    '<span class="pg6-year-counter" aria-live="polite"></span>' +
    '<button class="pg6-year-next" type="button" aria-label="' + escapeHtml(t('share.year.next')) + '">›</button>' +
    '</div>' +
    '<div class="pg6-postcard-actions">' +
    '<button class="pg6-postcard-export" type="button">' + escapeHtml(t('share.year.exportSet')) + '</button>' +
    '<span class="pg6-postcard-status" aria-live="polite"></span>' +
    '</div>';
  const preview = host.querySelector('.pg6-year-preview');
  const exportButton = host.querySelector('.pg6-postcard-export');
  const prevButton = host.querySelector('.pg6-year-prev');
  const nextButton = host.querySelector('.pg6-year-next');
  const counter = host.querySelector('.pg6-year-counter');
  const status = host.querySelector('.pg6-postcard-status');
  let lastDeck = null;
  let lastRange = null;
  let currentIndex = 0;
  let rendering = false;
  // The rings book is fetched once per activation and cached: loadRings hits
  // the Tauri backend (and is null in demo/browser), so re-reading it on every
  // render/export would be wasteful. A throw degrades to a bookless deck.
  let ringsBook = null;
  let ringsLoaded = false;
  async function ensureRings() {
    if (ringsLoaded) return ringsBook;
    ringsLoaded = true;
    try {
      ringsBook = typeof loadRings === 'function' ? await loadRings() : null;
    } catch (_) {
      ringsBook = null;
    }
    return ringsBook;
  }

  exportButton.addEventListener('click', async () => {
    if (rendering) return;
    if (!lastDeck) await renderPreview();
    if (!lastDeck) return;
    exportButton.disabled = true;
    setStatus(t('postcard.exporting'));
    try {
      const { canvas } = await buildYearDeckCanvas({
        summary: typeof getSummary === 'function' ? getSummary() : null,
        rings: await ensureRings()
      });
      const blob = await canvasToPngBlob(canvas);
      const saved = await savePostcard(blob, suggestedYearDeckName(lastRange));
      setStatus(saved ? t('postcard.saved') : t('postcard.cancelled'));
      if (saved) onRequestClose?.();
    } catch (err) {
      setStatus(t('postcard.error'));
      if (typeof onError === 'function') onError('year deck export failed', err);
    } finally {
      exportButton.disabled = false;
    }
  });
  prevButton.addEventListener('click', () => {
    if (!lastDeck) return;
    currentIndex = Math.max(0, currentIndex - 1);
    paintPreview();
  });
  nextButton.addEventListener('click', () => {
    if (!lastDeck) return;
    currentIndex = Math.min(lastDeck.cards.length - 1, currentIndex + 1);
    paintPreview();
  });

  async function renderPreview() {
    if (rendering) return;
    rendering = true;
    lastDeck = null;
    exportButton.disabled = true;
    prevButton.disabled = true;
    nextButton.disabled = true;
    setStatus(t('postcard.rendering'));
    try {
      lastDeck = await buildYearDeckCanvases({
        summary: typeof getSummary === 'function' ? getSummary() : null,
        rings: await ensureRings()
      });
      lastRange = lastDeck.range;
      currentIndex = 0;
      paintPreview();
      setStatus('');
    } catch (err) {
      setStatus(t('postcard.error'));
      if (typeof onError === 'function') onError('year deck preview failed', err);
    } finally {
      rendering = false;
      exportButton.disabled = false;
      syncNav();
    }
  }

  function paintPreview() {
    const card = lastDeck?.cards?.[currentIndex];
    if (!card) return;
    if (preview instanceof HTMLCanvasElement) {
      preview.width = card.canvas.width;
      preview.height = card.canvas.height;
      const pctx = preview.getContext('2d');
      if (pctx) { pctx.imageSmoothingEnabled = false; pctx.drawImage(card.canvas, 0, 0); }
    }
    syncNav();
  }

  function syncNav() {
    const total = lastDeck?.cards?.length || YEAR_CARD_TYPES.length;
    const card = lastDeck?.cards?.[currentIndex] || null;
    prevButton.disabled = rendering || !lastDeck || currentIndex <= 0;
    nextButton.disabled = rendering || !lastDeck || currentIndex >= total - 1;
    if (counter) {
      counter.textContent = t('share.year.cardCounter', {
        index: currentIndex + 1,
        total,
        title: card?.title || t('share.year.card.cover')
      });
    }
  }

  function setStatus(value) {
    if (status) status.textContent = value || '';
  }

  return {
    // Focus AFTER the render resolves: renderPreview() disables the export
    // button synchronously before its first await, so focusing it inline
    // would no-op and drop focus to <body>.
    activate: () => {
      // Invalidate the cached book on each open so a moment recorded since the
      // last open reaches the card. It stays cached WITHIN one activation
      // (preview + export share a single fetch); this reset is what makes the
      // "once per activation" contract true. Mirrors the Cost/Projects tabs.
      ringsLoaded = false;
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

function monthIndex(day) {
  return Math.max(0, Math.min(11, Number(String(day).slice(5, 7)) - 1));
}
