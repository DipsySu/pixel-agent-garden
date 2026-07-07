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
  mostRecentLocalMonday,
  previousIsoWeek,
  recordWeeklyOffer,
  shouldOfferWeeklyRecap,
  weeklyStats
} from '../weekly-card.js';

// ---- previousIsoWeek --------------------------------------------------------

test('previousIsoWeek crosses the year boundary on ISO rules', () => {
  // 2026-01-01 is the Thursday that makes Mon 2025-12-29 the start of ISO
  // week 2026-W01; the week before runs 2025-12-22 – 2025-12-28.
  const week = previousIsoWeek(new Date(Date.UTC(2026, 0, 1, 12, 0, 0)));
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
  const week = previousIsoWeek(new Date(Date.UTC(2026, 6, 6, 0, 0, 0)));
  assert.equal(week.start, '2026-06-29');
  assert.equal(week.end, '2026-07-05');
  assert.equal(week.days.length, 7);
});

test('every day of one ISO week maps to the same previous week', () => {
  const fromMonday = previousIsoWeek(new Date(Date.UTC(2026, 6, 6)));
  const fromWednesday = previousIsoWeek(new Date(Date.UTC(2026, 6, 8, 23, 59, 59)));
  const fromSunday = previousIsoWeek(new Date(Date.UTC(2026, 6, 12, 23, 59, 59)));
  assert.deepEqual(fromWednesday, fromMonday);
  assert.deepEqual(fromSunday, fromMonday);
});

// ---- weeklyStats ------------------------------------------------------------

// Window under test: 2026-06-29 … 2026-07-05. The fixture plants tokens on
// both neighbors of the window so leakage in either direction fails loudly.
const WEEK = previousIsoWeek(new Date(Date.UTC(2026, 6, 6)));

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
