// Contract tests for the Year Review card's pure half. No DOM: the canvas
// renderer stays behind buildYearCanvas, while these tests lock the date window
// and summary math that make the share artifact trustworthy.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildYearCanvas,
  suggestedYearName,
  yearStats,
  yearToDateWindow
} from '../year-card.js';

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
    ]
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
      now: new Date(Date.UTC(2026, 6, 8, 12, 0, 0))
    });
    assert.equal(result.range.year, 2026);
    assert.equal(result.stats.totalTokens, 10_000);
    assert.ok(calls.some((call) => call[0] === 'fillText'));
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
