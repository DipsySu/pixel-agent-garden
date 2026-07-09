// Contract tests for the weekly recap card's pure half (PRD 2.0 §P3-1
// 边界契约): ISO-week math on the UTC calendar, the daily_tokens window
// rollup, and the once-per-week offer gate. No DOM — runs under plain
// `node --test`. Instants are constructed via Date.UTC and chosen mid-week
// where local-time helpers are involved, so the suite passes in every
// timezone; the local-Monday helper itself is asserted through invariants
// (it is local by contract). Fixture project names are demo-* only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWeeklyCanvas,
  mostRecentLocalMonday,
  mountWeeklyCardContent,
  previousIsoWeek,
  recordWeeklyOffer,
  shouldOfferWeeklyRecap,
  weeklyStats
} from '../weekly-card.js';
import { t } from '../i18n.js';

// ---- previousIsoWeek --------------------------------------------------------

test('previousIsoWeek crosses the year boundary on ISO rules', () => {
  // 2026-01-01 is the Thursday that makes Mon 2025-12-29 the start of ISO
  // week 2026-W01; the week before runs 2025-12-22 – 2025-12-28.
  const week = previousIsoWeek({ year: 2026, month: 1, day: 1 });
  assert.equal(week.start, '2025-12-22');
  assert.equal(week.end, '2025-12-28');
  assert.deepEqual(week.days, [
    '2025-12-22', '2025-12-23', '2025-12-24', '2025-12-25',
    '2025-12-26', '2025-12-27', '2025-12-28'
  ]);
});

test('on a Monday the previous FULL week is returned, not a partial one', () => {
  // 2026-07-06 is a Monday: the new week has only just begun, so the card
  // covers Mon 06-29 … Sun 07-05 — the PRD's own example range.
  const week = previousIsoWeek({ year: 2026, month: 7, day: 6 });
  assert.equal(week.start, '2026-06-29');
  assert.equal(week.end, '2026-07-05');
  assert.equal(week.days.length, 7);
});

test('every day of one ISO week maps to the same previous week', () => {
  const fromMonday = previousIsoWeek({ year: 2026, month: 7, day: 6 });
  const fromWednesday = previousIsoWeek({ year: 2026, month: 7, day: 8 });
  const fromSunday = previousIsoWeek({ year: 2026, month: 7, day: 12 });
  assert.deepEqual(fromWednesday, fromMonday);
  assert.deepEqual(fromSunday, fromMonday);
});

// ---- weeklyStats ------------------------------------------------------------

// Window under test: 2026-06-29 … 2026-07-05. The fixture plants tokens on
// both neighbors of the window so leakage in either direction fails loudly.
const WEEK = previousIsoWeek({ year: 2026, month: 7, day: 6 });

function craftedSummary() {
  return {
    daily_tokens: {
      '2026-06-28': 999_999, // Sunday BEFORE the window — must be excluded
      '2026-06-29': 1_000,
      '2026-07-01': 4_000,
      '2026-07-05': 5_000,
      '2026-07-06': 777_777 // Monday AFTER the window — must be excluded
    },
    projects: [
      { display_name: 'demo-a', daily_tokens: { '2026-06-29': 600, '2026-07-05': 100 } },
      { display_name: 'demo-b', daily_tokens: { '2026-07-01': 4_000 } },
      { display_name: 'demo-c', daily_tokens: { '2026-07-05': 2_000 } },
      { display_name: 'demo-d', daily_tokens: { '2026-07-05': 1_500 } },
      { display_name: 'demo-idle', daily_tokens: { '2026-06-01': 123_456 } }
    ]
  };
}

test('weeklyStats sums exactly the seven window keys, zero-filled', () => {
  const stats = weeklyStats(craftedSummary(), WEEK);
  assert.equal(stats.totalTokens, 10_000); // 1k + 4k + 5k; neighbors excluded
  assert.equal(stats.activeDays, 3); // zero-filled days do not count
});

test('weeklyStats ranks top-3 projects by the WEEK, not lifetime', () => {
  const stats = weeklyStats(craftedSummary(), WEEK);
  assert.deepEqual(stats.topProjects, [
    { name: 'demo-b', tokens: 4000 },
    { name: 'demo-c', tokens: 2000 },
    { name: 'demo-d', tokens: 1500 }
  ]); // demo-a (700) is 4th; demo-idle has nothing inside the window
});

test('weeklyStats tolerates a summary without the schema-v2 rollup map', () => {
  const summary = craftedSummary();
  delete summary.daily_tokens;
  const stats = weeklyStats(summary, WEEK);
  // Falls back to summing the per-project maps: 700 + 4000 + 2000 + 1500.
  assert.equal(stats.totalTokens, 8_200);
  assert.equal(stats.activeDays, 3); // 06-29 (600), 07-01 (4000), 07-05 (3600)
});

// ---- zero-week detection + offer gate ---------------------------------------

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    }
  };
}

test('a zero-token week is detected and never offered', () => {
  const summary = { daily_tokens: { '2026-06-28': 5_000 }, projects: [] };
  const stats = weeklyStats(summary, WEEK);
  assert.equal(stats.totalTokens, 0);
  assert.equal(stats.activeDays, 0);
  assert.deepEqual(stats.topProjects, []);
  const offered = shouldOfferWeeklyRecap({
    summary,
    now: new Date(Date.UTC(2026, 6, 8, 12, 0, 0)),
    storage: memoryStorage()
  });
  assert.equal(offered, null);
});

test('one offer per week: the local Monday key is the dedupe token', () => {
  const summary = craftedSummary();
  const storage = memoryStorage();
  // Wednesday noon UTC: the same ISO week — and the same local Monday
  // (2026-07-06) — in every timezone from UTC-12 to UTC+14.
  const now = new Date(Date.UTC(2026, 6, 8, 12, 0, 0));
  const key = shouldOfferWeeklyRecap({ summary, now, storage });
  assert.equal(key, '2026-07-06');
  recordWeeklyOffer(key, storage);
  assert.equal(shouldOfferWeeklyRecap({ summary, now, storage }), null);
});

// ---- local Monday trigger edge ----------------------------------------------

test('mostRecentLocalMonday lands on a local Monday at or before now', () => {
  const now = new Date();
  const monday = mostRecentLocalMonday(now);
  assert.equal(monday.getDay(), 1); // local Monday
  assert.ok(monday.getTime() <= now.getTime());
  // Within one week (+1h slack for a DST fall-back inside the week).
  assert.ok(now.getTime() - monday.getTime() < 7 * 24 * 60 * 60 * 1000 + 3_600_000);
});

test('buildWeeklyCanvas runs through the canvas path with an injected document', async () => {
  const previousDocument = globalThis.document;
  const calls = [];
  const ctx = {
    set fillStyle(value) { calls.push(['fillStyle', value]); },
    set strokeStyle(value) { calls.push(['strokeStyle', value]); },
    set lineWidth(value) { calls.push(['lineWidth', value]); },
    set font(value) { calls.push(['font', value]); },
    set textAlign(value) { calls.push(['textAlign', value]); },
    set textBaseline(value) { calls.push(['textBaseline', value]); },
    fillRect: (...args) => calls.push(['fillRect', ...args]),
    strokeRect: (...args) => calls.push(['strokeRect', ...args]),
    fillText: (...args) => calls.push(['fillText', ...args]),
    measureText: (text) => ({ width: String(text).length * 10 })
  };
  globalThis.document = {
    createElement: (tag) => {
      assert.equal(tag, 'canvas');
      return {
        width: 0,
        height: 0,
        getContext: (kind) => {
          assert.equal(kind, '2d');
          return ctx;
        }
      };
    }
  };
  try {
    const result = await buildWeeklyCanvas({
      summary: craftedSummary(),
      now: new Date(Date.UTC(2026, 6, 8, 12, 0, 0))
    });
    assert.equal(result.week.start, '2026-06-29');
    assert.equal(result.stats.totalTokens, 10_000);
    assert.ok(calls.some((call) => call[0] === 'fillText'));
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

// ---- new growth line + dynamic closing (§P3-1 return-diff reuse) -------------

// Mid-week Wednesday: previousIsoWeek(local) resolves to WEEK in every timezone.
const WEDNESDAY = new Date(Date.UTC(2026, 6, 8, 12, 0, 0));

async function withCanvasCalls(fn) {
  const previousDocument = globalThis.document;
  const calls = [];
  const ctx = {
    set fillStyle(value) { calls.push(['fillStyle', value]); },
    set strokeStyle(value) { calls.push(['strokeStyle', value]); },
    set lineWidth(value) { calls.push(['lineWidth', value]); },
    set font(value) { calls.push(['font', value]); },
    set textAlign(value) { calls.push(['textAlign', value]); },
    set textBaseline(value) { calls.push(['textBaseline', value]); },
    fillRect: (...args) => calls.push(['fillRect', ...args]),
    strokeRect: (...args) => calls.push(['strokeRect', ...args]),
    fillText: (...args) => calls.push(['fillText', ...args]),
    measureText: (text) => ({ width: String(text).length * 10 })
  };
  globalThis.document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx })
  };
  try {
    await fn(calls);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
}

const fillTexts = (calls) => calls.filter((call) => call[0] === 'fillText').map((call) => String(call[1]));

test('a week-window ring moment surfaces in the new-growth line, path-free', async () => {
  await withCanvasCalls(async (calls) => {
    const book = {
      events: [
        { id: 'in', type: 'first_seen_project', entity: '/x', utc_date: '2026-07-01', label: 'newbie-proj', payload: { project_path: '/Users/secret/x' } },
        { id: 'out', type: 'first_seen_project', entity: '/y', utc_date: '2026-06-01', label: 'last-month-proj' }
      ]
    };
    await buildWeeklyCanvas({ summary: craftedSummary(), rings: book, now: WEDNESDAY });
    const texts = fillTexts(calls);
    assert.ok(texts.some((s) => s.includes('newbie-proj')), 'the in-window moment appears');
    assert.ok(!texts.some((s) => s.includes('last-month-proj')), 'the out-of-window moment is excluded');
    assert.ok(!texts.some((s) => s.includes('/Users/secret')), 'raw project path never renders');
  });
});

test('a tier gained in the week switches the closing to the lamp line', async () => {
  await withCanvasCalls(async (calls) => {
    const book = { events: [{ id: 't', type: 'tier_up', entity: 'pavilion', to: 'mid', utc_date: '2026-07-03' }] };
    await buildWeeklyCanvas({ summary: craftedSummary(), rings: book, now: WEDNESDAY });
    const texts = fillTexts(calls);
    assert.ok(texts.includes(t('share.weekly.closing.lamp')), 'the lamp closing is drawn');
    assert.ok(!texts.includes(t('share.weekly.closing')), 'the quiet closing is not drawn');
  });
});

test('a bookless week draws the quiet growth fallback and quiet closing', async () => {
  await withCanvasCalls(async (calls) => {
    await buildWeeklyCanvas({ summary: craftedSummary(), rings: null, now: WEDNESDAY });
    const texts = fillTexts(calls);
    assert.ok(texts.includes(t('share.weekly.growth.quiet')), 'the quiet growth fallback is drawn');
    assert.ok(texts.includes(t('share.weekly.closing')), 'the quiet closing is drawn');
    assert.ok(!texts.includes(t('share.weekly.closing.lamp')), 'the lamp closing is not drawn');
  });
});

// ---- provider re-fetches the rings book on each activation ------------------

test('the weekly provider re-loads the rings book on every activation', async () => {
  // Regression (post-2.0 review): the share drawer mounts each provider once
  // at startup, so a book cached for the provider's whole lifetime goes stale —
  // a moment recorded after the first open would never reach a later card.
  // activate() must invalidate the cache so each open re-reads (within one
  // activation the fetch is still shared by preview + export).
  const previousDocument = globalThis.document;
  const previousCanvasCtor = globalThis.HTMLCanvasElement;
  const ctx = {
    set fillStyle(_) {}, set strokeStyle(_) {}, set lineWidth(_) {},
    set font(_) {}, set textAlign(_) {}, set textBaseline(_) {},
    fillRect() {}, strokeRect() {}, fillText() {}, drawImage() {},
    measureText: (text) => ({ width: String(text).length * 10 })
  };
  const fakeCanvas = () => ({ width: 0, height: 0, getContext: () => ctx });
  globalThis.document = { createElement: () => fakeCanvas() };
  // Defined so renderPreview's `preview instanceof HTMLCanvasElement` guard is a
  // safe `false` under Node (no DOM) instead of a ReferenceError.
  globalThis.HTMLCanvasElement = class {};
  const host = {
    innerHTML: '',
    querySelector: (sel) => ({
      '.pg6-weekly-preview': fakeCanvas(),
      '.pg6-postcard-export': { addEventListener() {}, focus() {}, disabled: false },
      '.pg6-postcard-status': { textContent: '' }
    })[sel] || null
  };
  let loads = 0;
  const loadRings = async () => { loads += 1; return { events: [] }; };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  try {
    const provider = mountWeeklyCardContent({ host, getSummary: () => craftedSummary(), loadRings });
    provider.activate();
    await settle();
    assert.equal(loads, 1, 'first open loads the book once');
    provider.activate();
    await settle();
    assert.equal(loads, 2, 'a second open re-reads the book (cache invalidated per activation)');
  } finally {
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
    if (previousCanvasCtor === undefined) delete globalThis.HTMLCanvasElement; else globalThis.HTMLCanvasElement = previousCanvasCtor;
  }
});
