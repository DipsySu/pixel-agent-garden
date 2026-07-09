// Contract tests for the Year Review card's pure half. No DOM: the canvas
// renderer stays behind buildYearCanvas, while these tests lock the date window
// and summary math that make the share artifact trustworthy.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildYearDeckCanvas,
  buildYearDeckCanvases,
  buildYearCanvas,
  curateGrowthMoments,
  recordYearOffer,
  suggestedYearDeckName,
  suggestedYearName,
  shouldOfferYearReview,
  YEAR_CARD_TYPES,
  yearOfferKey,
  yearStats,
  yearToDateWindow
} from '../year-card.js';
import { t } from '../i18n.js';

test('yearToDateWindow returns local year-to-date UTC day keys', () => {
  const window = yearToDateWindow({ year: 2026, month: 7, day: 8 });
  assert.equal(window.year, 2026);
  assert.equal(window.start, '2026-01-01');
  assert.equal(window.end, '2026-07-08');
  assert.equal(window.days[0], '2026-01-01');
  assert.equal(window.days.at(-1), '2026-07-08');
  assert.equal(window.days.length, 189);
});

function craftedSummary() {
  return {
    daily_tokens: {
      '2025-12-31': 999_999,
      '2026-01-01': 1_000,
      '2026-03-12': 7_000,
      '2026-07-08': 2_000,
      '2026-07-09': 777_777
    },
    projects: [
      { display_name: 'demo-alpha', daily_tokens: { '2026-01-01': 800, '2026-07-08': 200 } },
      { display_name: 'demo-beta', daily_tokens: { '2026-03-12': 7_000 } },
      { display_name: 'demo-gamma', daily_tokens: { '2026-07-08': 1_200 } },
      { display_name: 'demo-old', daily_tokens: { '2025-12-31': 50_000 } },
      { display_name: 'demo-future', daily_tokens: { '2026-07-09': 50_000 } }
    ],
    source_tokens: {
      'claude-code': { total_tokens: 8_000 },
      codex: { input_tokens: 500, output_tokens: 500 }
    }
  };
}

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    }
  };
}

test('yearStats sums only the current year-to-date window', () => {
  const window = yearToDateWindow({ year: 2026, month: 7, day: 8 });
  const stats = yearStats(craftedSummary(), window);
  assert.equal(stats.totalTokens, 10_000);
  assert.equal(stats.activeDays, 3);
  assert.deepEqual(stats.busiestDay, { day: '2026-03-12', tokens: 7000 });
  assert.equal(stats.monthTotals[0], 1_000);
  assert.equal(stats.monthTotals[2], 7_000);
  assert.equal(stats.monthTotals[6], 2_000);
  assert.deepEqual(stats.sourceRows.map((row) => row.value), [8_000, 1_000]);
});

test('yearStats ranks projects by year-to-date tokens and never by lifetime', () => {
  const window = yearToDateWindow({ year: 2026, month: 7, day: 8 });
  const stats = yearStats(craftedSummary(), window);
  assert.deepEqual(stats.topProjects, [
    { name: 'demo-beta', tokens: 7000 },
    { name: 'demo-gamma', tokens: 1200 },
    { name: 'demo-alpha', tokens: 1000 }
  ]);
  assert.equal(stats.activeProjects, 3);
});

test('yearStats falls back to per-project maps when the summary rollup is absent', () => {
  const summary = craftedSummary();
  delete summary.daily_tokens;
  const window = yearToDateWindow({ year: 2026, month: 7, day: 8 });
  const stats = yearStats(summary, window);
  assert.equal(stats.totalTokens, 9_200);
  assert.equal(stats.activeDays, 3);
  assert.deepEqual(stats.busiestDay, { day: '2026-03-12', tokens: 7000 });
});

test('suggestedYearName is stable and does not include project names', () => {
  assert.equal(suggestedYearName({ year: 2026 }), 'garden-year-2026.png');
  assert.equal(suggestedYearName(null), 'garden-year-unknown.png');
  assert.equal(suggestedYearDeckName({ year: 2026 }), 'garden-year-2026-set.png');
});

test('year review offer unlocks once during the first local week of December', () => {
  const storage = memoryStorage();
  assert.equal(shouldOfferYearReview({
    summary: craftedSummary(),
    now: new Date(Date.UTC(2026, 10, 30, 12, 0, 0)),
    storage
  }), null);

  const offer = shouldOfferYearReview({
    summary: craftedSummary(),
    now: new Date(Date.UTC(2026, 11, 3, 12, 0, 0)),
    storage
  });
  assert.equal(offer.key, '2026');
  assert.equal(yearOfferKey(offer.range), '2026');
  recordYearOffer(offer.key, storage);
  assert.equal(shouldOfferYearReview({
    summary: craftedSummary(),
    now: new Date(Date.UTC(2026, 11, 4, 12, 0, 0)),
    storage
  }), null);
});

test('year review offer stays silent after the first week and for quiet years', () => {
  assert.equal(shouldOfferYearReview({
    summary: craftedSummary(),
    now: new Date(Date.UTC(2026, 11, 8, 12, 0, 0)),
    storage: memoryStorage()
  }), null);
  assert.equal(shouldOfferYearReview({
    summary: { daily_tokens: { '2025-12-31': 1_000 }, projects: [] },
    now: new Date(Date.UTC(2026, 11, 3, 12, 0, 0)),
    storage: memoryStorage()
  }), null);
});

test('buildYearCanvas runs through the canvas path with an injected document', async () => {
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
    const result = await buildYearCanvas({
      summary: craftedSummary(),
      // Inject the calendar-day anchor so the window is timezone-independent:
      // relying on now's LOCAL date failed in UTC+12..+14 (the '2026-07-09'
      // sentinel would enter the window).
      anchor: { year: 2026, month: 7, day: 8 }
    });
    assert.equal(result.range.year, 2026);
    assert.equal(result.stats.totalTokens, 10_000);
    assert.ok(calls.some((call) => call[0] === 'fillText'));
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('buildYearDeckCanvases renders the five-card year review set', async () => {
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
    drawImage: (...args) => calls.push(['drawImage', ...args]),
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
    const deck = await buildYearDeckCanvases({
      summary: craftedSummary(),
      anchor: { year: 2026, month: 7, day: 8 }
    });
    assert.deepEqual(deck.cards.map((card) => card.type), YEAR_CARD_TYPES);
    assert.equal(deck.cards.length, 5);
    assert.ok(deck.cards.every((card) => card.canvas.width === 960 && card.canvas.height === 1280));

    const strip = await buildYearDeckCanvas({
      summary: craftedSummary(),
      anchor: { year: 2026, month: 7, day: 8 }
    });
    assert.equal(strip.canvas.width, 960);
    assert.equal(strip.canvas.height, 1280 * 5);
    assert.equal(calls.filter((call) => call[0] === 'drawImage').length, 5);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

// ---- growth card (§P3-3 item 2: 年轮精选 5 时刻的竖版时间线) ------------------

// Run `fn(calls)` with a stubbed canvas document so a card render can be
// inspected through its ctx calls, then restore the previous global. Mirrors
// the inline mock the two deck tests above use.
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
    drawImage: (...args) => calls.push(['drawImage', ...args]),
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

test('curateGrowthMoments caps at five, prefers milestones, stays chronological', () => {
  const range = yearToDateWindow({ year: 2026, month: 12, day: 31 });
  const book = {
    events: [
      { id: 'a', type: 'first_seen_project', utc_date: '2026-01-05', label: 'p1' },
      { id: 'b', type: 'first_seen_project', utc_date: '2026-02-05', label: 'p2' },
      { id: 'c', type: 'first_seen_project', utc_date: '2026-03-05', label: 'p3' },
      { id: 'd', type: 'first_seen_project', utc_date: '2026-04-05', label: 'p4' },
      { id: 'e', type: 'first_seen_project', utc_date: '2026-05-05', label: 'p5' },
      { id: 'f', type: 'first_seen_project', utc_date: '2026-06-05', label: 'p6' },
      { id: 'g', type: 'tier_up', entity: 'pavilion', to: 'full', utc_date: '2026-11-20' }
    ]
  };
  const moments = curateGrowthMoments(book, range);
  assert.equal(moments.length, 5);
  const dates = moments.map((m) => m.utc_date);
  assert.deepEqual(dates, dates.slice().sort());
  // The late milestone survives even though six earlier first-seens compete.
  assert.ok(moments.some((m) => m.type === 'tier_up'));
});

test('curateGrowthMoments keeps all moments in date order when five or fewer', () => {
  const range = yearToDateWindow({ year: 2026, month: 12, day: 31 });
  const book = {
    events: [
      { id: 'b', type: 'first_seen_project', utc_date: '2026-03-01', label: 'p2' },
      { id: 'a', type: 'tier_up', entity: 'willow', to: 'mature', utc_date: '2026-01-01' }
    ]
  };
  assert.deepEqual(curateGrowthMoments(book, range).map((m) => m.id), ['a', 'b']);
});

test('curateGrowthMoments filters to the card year and tolerates a null book', () => {
  const range = yearToDateWindow({ year: 2026, month: 12, day: 31 });
  const book = {
    events: [
      { id: 'x', type: 'tier_up', utc_date: '2025-12-31' },
      { id: 'y', type: 'tier_up', utc_date: '2026-06-06' },
      { id: 'z', type: 'tier_up', utc_date: '2027-01-01' }
    ]
  };
  assert.deepEqual(curateGrowthMoments(book, range).map((m) => m.id), ['y']);
  assert.deepEqual(curateGrowthMoments(null, range), []);
});

test('buildYearDeckCanvases renders the growth timeline from a rings book', async () => {
  await withCanvasCalls(async (calls) => {
    const book = {
      events: [
        // A raw project path in the payload must NEVER reach the shareable card.
        { id: 'e1', type: 'first_seen_project', entity: '/Users/secret/x', utc_date: '2026-02-10', label: 'demo-alpha', payload: { project_path: '/Users/secret/x' } },
        { id: 'e2', type: 'tier_up', entity: 'pavilion', to: 'mid', utc_date: '2026-05-01' }
      ]
    };
    const deck = await buildYearDeckCanvases({
      summary: craftedSummary(),
      rings: book,
      anchor: { year: 2026, month: 7, day: 8 }
    });
    assert.equal(deck.cards.length, 5);
    const texts = fillTexts(calls);
    assert.ok(texts.some((s) => s.includes('demo-alpha')), 'the localized ring title renders in the timeline');
    assert.ok(!texts.some((s) => s.includes('/Users/secret')), 'raw project path never reaches the card');
  });
});

test('buildYearDeckCanvases renders the growth empty-state when the book is null', async () => {
  await withCanvasCalls(async (calls) => {
    const deck = await buildYearDeckCanvases({
      summary: craftedSummary(),
      rings: null,
      anchor: { year: 2026, month: 7, day: 8 }
    });
    assert.equal(deck.cards.length, 5);
    assert.ok(fillTexts(calls).includes(t('share.year.growth.empty')), 'a null book draws the calm empty line');
  });
});
