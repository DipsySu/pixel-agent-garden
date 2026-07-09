// Weekly recap card (PRD 2.0 §P3-1) — "last week in the garden" as a share
// artifact. Two halves, deliberately separable:
//
//   1. Pure week math + stats (previousIsoWeek / weeklyStats / the offer
//      gate): no DOM, node-testable (web/tests/weekly-card.test.mjs). The
//      §P3-1 boundary contract lives here: the OFFER trigger uses LOCAL time
//      (Monday is a human ritual), while the STATISTICS window is the
//      previous ISO week's seven UTC day keys matched verbatim against
//      `daily_tokens` — zero timezone conversion, zero double counting.
//      Accepted cost (spelled out in the PRD): activity near local midnight
//      can land one UTC day over, so the card prints its date range with a
//      `UTC` note instead of pretending to be exact.
//
//   2. Canvas render + save flow following the §5.4-E card DNA (3:4 portrait
//      960×1280, paper/ink, Silkscreen title bar, pixel visual block, VT323
//      number line, fixed product watermark) and reusing the postcard save
//      path end to end (savePostcard via data-source: native dialog on the
//      desktop, <a download> fallback in the browser).

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
  pad2,
  sumWindow,
  utcDayKey
} from './card-canvas.js';
import { escapeHtml, fmtLocal } from './render-helpers.js';
import { ringEventTitle } from './rings-panel.js';
import { t } from './i18n.js';

// --- pure week math (node-testable, no DOM) ---------------------------------

/**
 * The ISO week BEFORE the one containing the given calendar day (ISO 8601:
 * weeks run Monday–Sunday). Anchored on the LOCAL calendar on purpose — "last
 * week" is the user's ritual calendar (契约: trigger local), so a UTC+8
 * Monday at 07:00 already means the week that just ended locally; a pure-UTC
 * anchor served the week BEFORE last until 08:00. The arithmetic itself runs
 * in timezone-free UTC-ms space, and the seven returned keys are plain
 * calendar dates that index the UTC-keyed `daily_tokens` — the ≤1-evening
 * attribution skew at the window edges is the documented, accepted trade.
 * Week NUMBERS are never materialized, so the year boundary needs no special
 * case.
 */
export function previousIsoWeek(anchor = localCalendarDay()) {
  const todayUtc = Date.UTC(anchor.year, anchor.month - 1, anchor.day);
  // getUTCDay(): Sunday=0 … Saturday=6 → ISO offset Monday=0 … Sunday=6.
  const isoDow = (new Date(todayUtc).getUTCDay() + 6) % 7;
  const previousMonday = todayUtc - (isoDow + 7) * DAY_MS;
  const days = [];
  for (let i = 0; i < 7; i += 1) days.push(utcDayKey(previousMonday + i * DAY_MS));
  return { start: days[0], end: days[6], days };
}

/**
 * Roll `summary` up over one week window. The total comes from the
 * summary-level `daily_tokens` rollup; the top-3 ranking uses each project's
 * OWN per-day `daily_tokens` (ProjectGrowth carries it since summary schema
 * v2), so the ranking reflects THE WEEK, not lifetime totals. Names are
 * `display_name` only — never `project_key`, which is typically an absolute
 * local path and must not leak into a shareable image (same rule as the
 * postcard's topProject).
 */
export function weeklyStats(summary, week) {
  const days = Array.isArray(week?.days) ? week.days : [];
  let totalTokens = 0;
  let activeDays = 0;
  for (const value of dailyTotals(summary, days)) {
    totalTokens += value;
    if (value > 0) activeDays += 1;
  }
  const projects = Array.isArray(summary?.projects) ? summary.projects : [];
  const topProjects = projects
    .map((project) => ({
      name: project?.display_name || '',
      tokens: sumWindow(project?.daily_tokens, days)
    }))
    .filter((entry) => entry.name && entry.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 3);
  return { totalTokens, topProjects, activeDays };
}


// --- Monday offer gate (local-time trigger half of the contract) ------------

/**
 * Local-midnight Monday of the week containing `now` — the ritual edge.
 * LOCAL on purpose (契约: trigger local, statistics UTC): Monday morning is
 * when a human opens the garden, whatever their timezone.
 */
export function mostRecentLocalMonday(now = new Date()) {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday;
}

const OFFERED_KEY = 'pg6.weekly.offered';

/**
 * Decide whether to offer last week's card. Returns the local Monday date
 * key to record when the answer is yes, null otherwise. One offer per week
 * (the stored Monday key is the dedupe token) and never for an empty week —
 * a zero-token card is noise, not a ritual. Callers record the returned key
 * via recordWeeklyOffer once the banner is actually shown; a zero-week skip
 * records nothing, so history arriving later the same week can still offer.
 */
export function shouldOfferWeeklyRecap({ summary, now = new Date(), storage }) {
  const mondayKey = localDateKey(mostRecentLocalMonday(now));
  if (readOffered(storage) === mondayKey) return null;
  const stats = weeklyStats(summary, previousIsoWeek(localCalendarDay(now)));
  if (stats.totalTokens <= 0) return null;
  return mondayKey;
}

export function recordWeeklyOffer(mondayKey, storage) {
  try {
    storage?.setItem(OFFERED_KEY, mondayKey);
  } catch (_) {
    // Blocked storage just means the offer may show again next launch.
  }
}

function readOffered(storage) {
  try {
    return storage?.getItem(OFFERED_KEY) ?? null;
  } catch (_) {
    return null;
  }
}

function localDateKey(date) {
  return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
}

// --- card render (§5.4-E DNA) ------------------------------------------------

/** Suggested export filename, anchored on the week's Monday (UTC key). */
export function suggestedWeeklyName(week) {
  return 'garden-weekly-' + (week?.start || 'unknown') + '.png';
}

/**
 * Render the recap card for the ISO week before `now`. Pure drawing from the
 * summary — unlike the garden postcard this card is data-born, no scene DOM
 * involved. Returns the canvas plus the week/stats it rendered so callers
 * can name the file without recomputing.
 */
export async function buildWeeklyCanvas({ summary, rings = null, now = new Date() }) {
  const week = previousIsoWeek(localCalendarDay(now));
  const stats = weeklyStats(summary, week);
  // `rings` is the (possibly null) RingBook from loadRings(); it feeds only the
  // "new growth" narrative and degrades to a quiet fallback when null (demo and
  // browser fallback pass null — loadRings is demo/Tauri-gated).
  const growth = weekGrowthEvents(rings, week);
  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2D context unavailable');
  ctx.imageSmoothingEnabled = false;
  await ensureCardFonts();
  drawCard(ctx, week, stats, dailyTotals(summary, week.days), growth);
  return { canvas, week, stats };
}

// Ring events whose UTC day-key falls inside the week window. Milestone types
// float first so the single "new growth" line surfaces the most meaningful
// moments when several land in one week; ties break by date. Kept module-level
// (not inside buildWeeklyCanvas) so the week-window matching is node-testable.
const WEEKLY_MILESTONE_TYPES = new Set(['tier_up', 'trinket_unlocked', 'busiest_day_record']);

function weekGrowthEvents(book, week) {
  const daySet = new Set(Array.isArray(week?.days) ? week.days : []);
  const events = (Array.isArray(book?.events) ? book.events : [])
    .filter((event) => daySet.has(event?.utc_date));
  const rank = (event) => (WEEKLY_MILESTONE_TYPES.has(event?.type) ? 0 : 1);
  return events.sort((a, b) =>
    rank(a) - rank(b) || String(a?.utc_date || '').localeCompare(String(b?.utc_date || '')));
}

// "多了一盏灯" (PRD §P3-1 closing example): a tier-up or trinket this week means
// the garden gained something permanent, so the closing swaps to the
// celebratory line; otherwise it keeps the quiet default.
function weekGainedLight(growth) {
  return growth.some((event) => event?.type === 'tier_up' || event?.type === 'trinket_unlocked');
}

function drawCard(ctx, week, stats, totals, growth = []) {
  drawPaperFrame(ctx);

  // Silkscreen title bar: ink band, paper text (§5.4-E anatomy, row 1).
  ctx.fillStyle = INK;
  ctx.fillRect(40, 40, CARD_W - 80, 92);
  ctx.fillStyle = PAPER;
  ctx.font = '700 46px ' + FONT_PIXEL;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(fitOneLine(ctx, t('share.weekly.title'), CARD_W - 132), 66, 88);

  // Date-range corner note with the honest UTC marker (§P3-1 边界契约:
  // the window is UTC day keys; say so on the card).
  ctx.fillStyle = MUTED;
  ctx.font = '34px ' + FONT_NUM;
  ctx.textAlign = 'right';
  ctx.fillText(week.start + ' – ' + week.end + ' · UTC', CARD_W - 66, 176);

  // Pixel visual block: the week as seven chunky bars. Trimmed a touch from
  // the original height to make vertical room for the new-growth line below.
  drawWeekBars(ctx, totals, week.days, { x: 66, y: 216, w: CARD_W - 132, h: 430 });

  // VT323 number line (§5.4-E anatomy, row 3) — digits render in VT323,
  // CJK unit words fall through to the system stack.
  const numberLine =
    t('postcard.tokens', { total: fmtLocal(stats.totalTokens) }) +
    ' · ' +
    t('share.weekly.activeDays', { count: stats.activeDays });
  ctx.fillStyle = INK;
  ctx.font = '92px ' + FONT_NUM;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(fitOneLine(ctx, numberLine, CARD_W - 132), 66, 762);

  // Top-3 project lines (or the quiet empty-week line).
  drawTopProjects(ctx, stats, { x: 66, y: 852, w: CARD_W - 132 });

  // "新长出的东西" line (PRD §P3-1): what the garden's memory recorded this
  // week — reusing the same ring events the private Rings tab shows, but
  // path-free for a shareable card.
  drawNewGrowth(ctx, growth, { x: 66, y: 1088, w: CARD_W - 132 });

  // Closing line — the ritual's soft landing. A week that gained a tier/trinket
  // gets the "多了一盏灯" line; otherwise the quiet default.
  ctx.fillStyle = MUTED;
  ctx.font = '34px ' + FONT_STACK;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const closingKey = weekGainedLight(growth) ? 'share.weekly.closing.lamp' : 'share.weekly.closing';
  ctx.fillText(fitOneLine(ctx, t(closingKey), CARD_W - 132), 66, 1150);

  // Product watermark (§5.4-E anatomy, row 4) — fixed latin string, never
  // localized: it is the card's propagation signature.
  ctx.fillStyle = MUTED;
  ctx.font = '24px ' + FONT_PIXEL;
  ctx.textAlign = 'center';
  ctx.fillText('pixel-agent-garden', CARD_W / 2, 1218);
}

// "庭院里新长出的东西" (PRD §P3-1): one line naming up to three ring moments
// that landed inside the week, localized via ringEventTitle so no raw project
// path leaks onto the shareable card. A bookless/quiet week gets a calm
// fallback in the same muted tone as the empty-week project line.
function drawNewGrowth(ctx, growth, box) {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  if (!growth.length) {
    ctx.fillStyle = MUTED;
    ctx.font = '32px ' + FONT_STACK;
    ctx.fillText(fitOneLine(ctx, t('share.weekly.growth.quiet'), box.w), box.x, box.y);
    return;
  }
  // A small green sprout bullet ties the line to the garden-growth metaphor.
  ctx.fillStyle = GREEN;
  ctx.fillRect(box.x, box.y - 10, 20, 20);
  const items = growth.slice(0, 3).map((event) => ringEventTitle(event)).join(' · ');
  ctx.fillStyle = INK;
  ctx.font = '32px ' + FONT_STACK;
  ctx.fillText(fitOneLine(ctx, t('share.weekly.growth.label', { items }), box.w - 44), box.x + 44, box.y);
}

// Seven bars on a cream panel, heights snapped to an 8px grid so the
// silhouette reads as pixels, not as an anti-aliased chart. Zero days show a
// paper-edge stub — an honest gap, still part of the week's shape.
function drawWeekBars(ctx, totals, days, box) {
  ctx.fillStyle = CREAM;
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4;
  ctx.strokeRect(box.x + 2, box.y + 2, box.w - 4, box.h - 4);

  const innerPad = 36;
  const labelBand = 64;
  const baseline = box.y + box.h - labelBand;
  const maxBarH = box.h - labelBand - innerPad - 24;
  const slot = (box.w - innerPad * 2) / 7;
  const barW = Math.round(slot * 0.56);
  const max = Math.max(...totals, 1);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  for (let i = 0; i < 7; i += 1) {
    const cx = box.x + innerPad + slot * i + slot / 2;
    const active = totals[i] > 0;
    // Snap to the 8px grid; any nonzero day keeps at least one block.
    const h = active ? Math.max(8, Math.round((totals[i] / max) * maxBarH / 8) * 8) : 8;
    ctx.fillStyle = active ? GREEN : PAPER_EDGE;
    ctx.fillRect(Math.round(cx - barW / 2), baseline - h, barW, h);
    // Day-of-month labels: digits only, so the canvas needs no locale fork.
    ctx.fillStyle = MUTED;
    ctx.font = '30px ' + FONT_NUM;
    ctx.fillText(days[i].slice(8), cx, baseline + 44);
  }
}

function drawTopProjects(ctx, stats, box) {
  ctx.textBaseline = 'middle';
  if (!stats.topProjects.length) {
    ctx.fillStyle = MUTED;
    ctx.font = '34px ' + FONT_STACK;
    ctx.textAlign = 'left';
    ctx.fillText(fitOneLine(ctx, t('share.weekly.empty'), box.w), box.x, box.y + 18);
    return;
  }
  stats.topProjects.forEach((entry, index) => {
    const y = box.y + index * 72 + 18;
    // Pixel bullet in the action green — rank is reading order, no numerals.
    ctx.fillStyle = GREEN;
    ctx.fillRect(box.x, y - 10, 20, 20);
    const tokens = fmtLocal(entry.tokens);
    ctx.font = '46px ' + FONT_NUM;
    const tokensW = ctx.measureText(tokens).width;
    ctx.fillStyle = INK;
    ctx.textAlign = 'right';
    ctx.fillText(tokens, box.x + box.w, y);
    ctx.textAlign = 'left';
    ctx.font = '600 34px ' + FONT_STACK;
    ctx.fillText(fitOneLine(ctx, entry.name, box.w - 44 - tokensW - 24), box.x + 44, y);
  });
}

// --- share-drawer flow provider ----------------------------------------------

/**
 * Weekly recap flow — the share drawer's second artifact row. Same provider
 * shape as mountPostcardContent: content INTO the drawer's host, the shell
 * stays with the drawer. Save reuses the postcard pipeline end to end.
 *
 * @param {{
 *   host: HTMLElement,
 *   getSummary: () => object | null,
 *   onError?: (message: string, err: unknown) => void,
 *   onRequestClose?: () => void,
 *   loadRings?: () => Promise<object | null>,
 * }} opts
 * @returns {{ activate: () => void }}
 */
export function mountWeeklyCardContent({ host, getSummary, onError, onRequestClose, loadRings }) {
  host.innerHTML =
    '<div class="pg6-postcard-title">' + escapeHtml(t('share.weekly.name')) + '</div>' +
    '<canvas class="pg6-weekly-preview" width="960" height="1280" aria-hidden="true"></canvas>' +
    '<div class="pg6-postcard-actions">' +
    '<button class="pg6-postcard-export" type="button">' + escapeHtml(t('postcard.export')) + '</button>' +
    '<span class="pg6-postcard-status" aria-live="polite"></span>' +
    '</div>';
  const preview = host.querySelector('.pg6-weekly-preview');
  const exportButton = host.querySelector('.pg6-postcard-export');
  const status = host.querySelector('.pg6-postcard-status');
  let lastCanvas = null;  // the live preview canvas, reused on Save (no re-render)
  let lastWeek = null;
  let rendering = false;
  // Fetch the rings book once per activation and cache it: loadRings hits the
  // Tauri backend (and is null in demo/browser), and a throw degrades to a
  // bookless card (the quiet growth fallback).
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
    if (!lastCanvas) await renderPreview();
    if (!lastCanvas) return;
    exportButton.disabled = true;
    setStatus(t('postcard.exporting'));
    try {
      const blob = await canvasToPngBlob(lastCanvas);
      const saved = await savePostcard(blob, suggestedWeeklyName(lastWeek));
      setStatus(saved ? t('postcard.saved') : t('postcard.cancelled'));
      if (saved) onRequestClose?.();
    } catch (err) {
      setStatus(t('postcard.error'));
      if (typeof onError === 'function') onError('weekly card export failed', err);
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
      const { canvas, week } = await buildWeeklyCanvas({
        summary: typeof getSummary === 'function' ? getSummary() : null,
        rings: await ensureRings()
      });
      lastCanvas = canvas;
      lastWeek = week;
      if (preview instanceof HTMLCanvasElement) {
        preview.width = canvas.width;
        preview.height = canvas.height;
        const pctx = preview.getContext('2d');
        if (pctx) { pctx.imageSmoothingEnabled = false; pctx.drawImage(canvas, 0, 0); }
      }
      setStatus('');
    } catch (err) {
      setStatus(t('postcard.error'));
      if (typeof onError === 'function') onError('weekly card preview failed', err);
    } finally {
      rendering = false;
      exportButton.disabled = false;
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
