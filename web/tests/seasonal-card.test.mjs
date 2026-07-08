// Contract tests for the PRD 2.0 P3-2 Seasonal Moment card. The feature is
// local-calendar driven only — no weather API, no lunar lookup, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSeasonalCanvas,
  seasonalMoment,
  seasonalStats,
  seasonalWindow,
  suggestedSeasonalName
} from '../seasonal-card.js';

test('seasonalMoment maps local calendar months to the four shipped moments', () => {
  assert.equal(seasonalMoment({ year: 2026, month: 3, day: 20 }).id, 'cherry');
  assert.equal(seasonalMoment({ year: 2026, month: 7, day: 8 }).id, 'koi');
  assert.equal(seasonalMoment({ year: 2026, month: 10, day: 1 }).id, 'moon');
  assert.equal(seasonalMoment({ year: 2026, month: 1, day: 8 }).id, 'snow');
});

test('seasonalWindow returns season-to-date UTC keys and crosses winter year boundary', () => {
  const summer = seasonalWindow({ year: 2026, month: 7, day: 8 });
  assert.equal(summer.moment.id, 'koi');
  assert.equal(summer.start, '2026-06-01');
  assert.equal(summer.end, '2026-07-08');
  assert.equal(summer.days.length, 38);

  const winter = seasonalWindow({ year: 2026, month: 1, day: 8 });
  assert.equal(winter.moment.id, 'snow');
  assert.equal(winter.start, '2025-12-01');
  assert.equal(winter.end, '2026-01-08');
});

function craftedSummary() {
  return {
    daily_tokens: {
      '2026-05-31': 999_999,
      '2026-06-01': 1_000,
      '2026-07-08': 4_000,
      '2026-09-01': 777_777
    },
    projects: [
      { display_name: 'demo-koi', daily_tokens: { '2026-06-01': 900, '2026-07-08': 2_000 } },
      { display_name: 'demo-pond', daily_tokens: { '2026-07-08': 1_500 } },
      { display_name: 'demo-old', daily_tokens: { '2026-05-31': 30_000 } },
      { display_name: 'demo-future', daily_tokens: { '2026-09-01': 30_000 } }
    ]
  };
}

test('seasonalStats sums only the current seasonal window and ranks current projects', () => {
  const range = seasonalWindow({ year: 2026, month: 7, day: 8 });
  const stats = seasonalStats(craftedSummary(), range);
  assert.equal(stats.totalTokens, 5_000);
  assert.equal(stats.activeDays, 2);
  assert.deepEqual(stats.topProjects, [
    { name: 'demo-koi', tokens: 2900 },
    { name: 'demo-pond', tokens: 1500 }
  ]);
});

test('suggestedSeasonalName is stable and pathless', () => {
  assert.equal(
    suggestedSeasonalName({ moment: { id: 'koi' }, end: '2026-07-08' }),
    'garden-seasonal-koi-2026-07-08.png'
  );
  assert.equal(suggestedSeasonalName(null), 'garden-seasonal-season-unknown.png');
});

test('buildSeasonalCanvas runs through the canvas path with an injected document', async () => {
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
    const result = await buildSeasonalCanvas({
      summary: craftedSummary(),
      anchor: { year: 2026, month: 7, day: 8 }
    });
    assert.equal(result.range.moment.id, 'koi');
    assert.equal(result.stats.totalTokens, 5_000);
    assert.ok(calls.some((call) => call[0] === 'fillText'));
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
