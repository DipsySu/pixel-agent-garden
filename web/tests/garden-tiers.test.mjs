// Regression guard for the today-key timezone contract (see garden-tiers.js):
// daily_activity keys come from core's aggregate.rs formatting DateTime<Utc>,
// so the frontend lookup MUST slice the UTC date, never the local one.
// Runs under plain `node --test` — no npm, no browser globals.
import test from 'node:test';
import assert from 'node:assert/strict';
import { unlockTier } from '../garden-tiers.js';

// A fixed instant where UTC and east-of-UTC local dates disagree:
// 2026-01-01T23:30:00Z is already 2026-01-02 in UTC+8 (Asia/Shanghai).
// Assertions below are deterministic regardless of the machine timezone,
// because the implementation must slice the ISO (UTC) date.
const now = new Date('2026-01-01T23:30:00Z');

function projectWith(dailyActivity) {
  return [{
    total_tokens: 10,
    sessions: 1,
    stage: 1,
    recent_activity: 0,
    daily_activity: dailyActivity
  }];
}

test('todayActivity matches the UTC day key emitted by aggregate.rs', () => {
  const tiers = unlockTier(null, projectWith({ '2026-01-01': 5 }), now);
  assert.equal(tiers.todayActivity, 5);
  assert.equal(tiers.lamp, 'lit');
});

test('local-date keys do not count as today (local/UTC divergence regression)', () => {
  // '2026-01-02' is "today" for a UTC+8 wall clock at this instant; the old
  // local-date lookup would wrongly light the lamp from this key.
  const tiers = unlockTier(null, projectWith({ '2026-01-02': 5 }), now);
  assert.equal(tiers.todayActivity, 0);
  assert.equal(tiers.lamp, 'unlit');
});

test('now defaults to the real clock without throwing', () => {
  const tiers = unlockTier(null, projectWith({}));
  assert.equal(tiers.lamp, 'unlit');
});

test('summary.tiers from core wins over frontend fallback derivation', () => {
  const tiers = unlockTier({
    total_tokens: 1,
    tiers: {
      total_tokens: 999,
      max_project_tokens: 888,
      total_sessions: 7,
      recent_activity: 6,
      today_activity: 5,
      pavilion: 'full',
      cherry: 'petal',
      willow: 'mature',
      stone_cat: 'full',
      lamp: 'lit',
      stool: 'visible',
      cushion: 'visible',
      pavilion_trinkets: ['scroll', 'tea_set']
    }
  }, projectWith({}), now);

  assert.equal(tiers.totalTokens, 999);
  assert.equal(tiers.maxProjectTokens, 888);
  assert.equal(tiers.pavilion, 'full');
  assert.equal(tiers.cherry, 'petal');
  assert.deepEqual(tiers.pavilionTrinkets, ['scroll', 'tea_set']);
});
