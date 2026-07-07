// Guards the rings journal's display contract: fixtures use the REAL wire
// shape only (core serializes RingEvent.event_type as JSON `type`, see
// #[serde(rename)] in crates/core/src/rings.rs — no alternate spellings), and
// titles must never leak raw internal tokens ('pavilion', 'full', enum names)
// into either locale. Assertions compare against t() output rather than
// hardcoding copy, so editing i18n strings does not break this file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ringDate, ringEventTitle } from '../rings-panel.js';
import { t } from '../i18n.js';

test('first-seen rows carry the project name', () => {
  assert.equal(
    ringEventTitle({ type: 'first_seen_project', label: 'pay-module' }),
    t('rings.event.firstSeen', { name: 'pay-module' })
  );
});

test('tier transitions reuse the unlock-banner copy, never the raw template', () => {
  const title = ringEventTitle({ type: 'tier_up', entity: 'pavilion', to: 'full' });
  assert.equal(title, t('banner.pavilion.full'));
  // The generic '{entity} grew to {to}' line is the fallback for unknown
  // transitions only — a known transition must not degrade to it.
  assert.notEqual(title, t('rings.event.tierUp', { entity: 'pavilion', to: 'full' }));
});

test('unknown tier transitions fall back to the localized generic line', () => {
  assert.equal(
    ringEventTitle({ type: 'tier_up', entity: 'pagoda', to: 'giant' }),
    t('rings.event.tierUp', { entity: 'pagoda', to: 'giant' })
  );
});

test('trinket rows resolve the trinket display name', () => {
  assert.equal(
    ringEventTitle({ type: 'trinket_unlocked', entity: 'tea_set' }),
    t('rings.event.trinket', { name: t('trinket.tea_set.name') })
  );
});

test('PRD-defined future types are titled, not raw enums', () => {
  assert.equal(ringEventTitle({ type: 'busiest_day_record' }), t('rings.event.busiestDay'));
  assert.equal(ringEventTitle({ type: 'season_change' }), t('rings.event.seasonChange'));
});

test('ring dates format the UTC day key without shifting a day', () => {
  const label = ringDate('2026-07-07');
  assert.ok(label.includes('7'), 'day-of-month must survive UTC formatting: ' + label);
  assert.notEqual(label, '2026-07-07', 'raw ISO strings must not reach the UI');
  assert.equal(ringDate(''), '—');
});
