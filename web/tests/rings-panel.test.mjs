import test from 'node:test';
import assert from 'node:assert/strict';
import { ringEventTitle } from '../rings-panel.js';

test('ringEventTitle reads Rust RingEvent JSON type field', () => {
  assert.equal(
    ringEventTitle({ type: 'first_seen_project', label: 'pay-module' }),
    'First saw pay-module'
  );
  assert.equal(
    ringEventTitle({ type: 'tier_up', entity: 'pavilion', to: 'full' }),
    'pavilion grew to full'
  );
});

test('ringEventTitle keeps legacy event_type fixtures readable', () => {
  assert.equal(
    ringEventTitle({ event_type: 'trinket_unlocked', entity: 'tea_set' }),
    'Tea set appeared'
  );
});
