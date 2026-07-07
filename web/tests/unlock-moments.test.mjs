// Contract tests for unlock-moments (PRD 2.0 §P1-2, I6). Pure-diff behavior
// only — no DOM, no localStorage (node has neither; the mount's storage
// helpers are guarded, which the mount test below exercises implicitly).
// The version-skew suppression mirrors crates/core/src/rings.rs
// derive_tier_events: unknown tier values on EITHER side yield no moment.
// Runs under plain `node --test` — no npm, no browser globals.
import test from 'node:test';
import assert from 'node:assert/strict';
import { diffTiers, tierFrame, mountUnlockMoments } from '../unlock-moments.js';

// Fully-locked baseline frame; tests override single fields so each case
// asserts exactly one kind of change.
function frame(overrides = {}) {
  return {
    lamp: 'unlit',
    pavilion: 'small',
    willow: 'young',
    stone_cat: 'hidden',
    stool: 'hidden',
    cushion: 'hidden',
    pavilionTrinkets: [],
    ...overrides
  };
}

test('lamp unlit→lit yields a lamp moment', () => {
  const moments = diffTiers(frame(), frame({ lamp: 'lit' }));
  assert.deepEqual(moments, [
    { kind: 'lamp_lit', entity: 'lamp', from: 'unlit', to: 'lit' }
  ]);
});

test('one tier-up yields one tier_up moment', () => {
  const moments = diffTiers(frame(), frame({ pavilion: 'mid' }));
  assert.deepEqual(moments, [
    { kind: 'tier_up', entity: 'pavilion', from: 'small', to: 'mid' }
  ]);
});

test('a newly added trinket yields a trinket_unlocked moment', () => {
  const moments = diffTiers(
    frame({ pavilionTrinkets: ['scroll'] }),
    frame({ pavilionTrinkets: ['scroll', 'tea_set'] })
  );
  assert.deepEqual(moments, [
    { kind: 'trinket_unlocked', entity: 'tea_set', from: null, to: 'unlocked' }
  ]);
});

test('a burst celebrates lamp first, then tiers, then trinkets', () => {
  const moments = diffTiers(
    frame(),
    frame({ lamp: 'lit', stone_cat: 'small', pavilionTrinkets: ['scroll'] })
  );
  assert.deepEqual(moments.map((m) => m.kind), ['lamp_lit', 'tier_up', 'trinket_unlocked']);
});

test('no previous frame (first run) yields no moments', () => {
  assert.deepEqual(diffTiers(null, frame({ lamp: 'lit' })), []);
  assert.deepEqual(diffTiers(undefined, frame({ pavilion: 'full' })), []);
  // Symmetric guard: an unreadable next frame is equally uncelebratable.
  assert.deepEqual(diffTiers(frame(), null), []);
});

test('unknown tier values on either side are suppressed (version skew)', () => {
  // A NEWER build wrote a tier this build cannot rank — never celebrate
  // "grand→full" as if it were growth, and never celebrate INTO a tier we
  // cannot place on the ladder either.
  assert.deepEqual(diffTiers(frame({ pavilion: 'grand' }), frame({ pavilion: 'full' })), []);
  assert.deepEqual(diffTiers(frame(), frame({ pavilion: 'grand' })), []);
});

test('tier regressions are never celebrated', () => {
  assert.deepEqual(diffTiers(frame({ pavilion: 'full' }), frame({ pavilion: 'small' })), []);
  assert.deepEqual(diffTiers(frame({ lamp: 'lit' }), frame()), []);
});

test('multi-level jump yields ONE moment for the final tier', () => {
  const pavilion = diffTiers(frame(), frame({ pavilion: 'full' }));
  assert.deepEqual(pavilion, [
    { kind: 'tier_up', entity: 'pavilion', from: 'small', to: 'full' }
  ]);
  const cat = diffTiers(frame(), frame({ stone_cat: 'full' }));
  assert.deepEqual(cat, [
    { kind: 'tier_up', entity: 'stone_cat', from: 'hidden', to: 'full' }
  ]);
});

test('non-array trinket state on either side is suppressed', () => {
  const corrupt = frame();
  corrupt.pavilionTrinkets = 'not-an-array';
  assert.deepEqual(diffTiers(corrupt, frame({ pavilionTrinkets: ['scroll'] })), []);
  assert.deepEqual(diffTiers(frame({ pavilionTrinkets: ['scroll'] }), corrupt), []);
});

test('tierFrame plucks only celebrated fields and copies the trinket list', () => {
  const trinkets = ['scroll'];
  const plucked = tierFrame({
    totalTokens: 12345,
    lamp: 'lit',
    pavilion: 'mid',
    willow: 'young',
    stone_cat: 'small',
    stool: 'visible',
    cushion: 'hidden',
    pavilionTrinkets: trinkets
  });
  assert.deepEqual(plucked, {
    lamp: 'lit',
    pavilion: 'mid',
    willow: 'young',
    stone_cat: 'small',
    stool: 'visible',
    cushion: 'hidden',
    pavilionTrinkets: ['scroll']
  });
  assert.equal('totalTokens' in plucked, false, 'volatile numbers must not persist');
  assert.notEqual(plucked.pavilionTrinkets, trinkets, 'must be a defensive copy');
  assert.equal(tierFrame(null), null);
});

test('mount seeds silently on first frame, celebrates the next, dedupes repeats', () => {
  // node has no window: the mount falls back to its in-memory frame, which is
  // exactly the degradation path we want covered. All collaborators injected.
  const pushed = [];
  const focused = [];
  let emit = null;
  mountUnlockMoments({
    banner: { push: (entry) => pushed.push(entry) },
    getTiers: (summary) => summary.tiers,
    subscribe: (onSummary) => { emit = onSummary; },
    onFocus: (moment) => focused.push(moment)
  });

  emit({ tiers: frame() }); // first ever frame → seed, no banner storm
  assert.equal(pushed.length, 0);

  emit({ tiers: frame({ lamp: 'lit' }) }); // growth → exactly one banner
  assert.equal(pushed.length, 1);
  assert.ok(pushed[0].text.length > 0, 'banner copy must be localized non-empty text');

  emit({ tiers: frame({ lamp: 'lit' }) }); // same frame again → no repeat
  assert.equal(pushed.length, 1);

  pushed[0].onActivate(); // click-through reaches onFocus with the moment
  assert.deepEqual(focused, [
    { kind: 'lamp_lit', entity: 'lamp', from: 'unlit', to: 'lit' }
  ]);
});
