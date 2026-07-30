import assert from 'node:assert/strict';
import test from 'node:test';

import { flowerbedDays, flowerbedPlacements } from '../render-flowerbed.js';

const sprites = Array.from({ length: 5 }, (_, level) =>
  ['rose', 'daisy', 'tulip', 'wildflower'].map((variant) => ({
    file: `flowerbed/flower_l${level}_${variant}.png`,
    level,
    name: `flower_l${level}_${variant}`
  }))
).flat();

test('flowerbedPlacements keeps one year inside the six-row garden grid', () => {
  const days = Array.from({ length: 400 }, (_, index) => ({
    activity: index,
    date: `day-${index}`,
    level: index % 5
  }));

  const placements = flowerbedPlacements(days, sprites, '/sprites/');

  assert.equal(placements.length, 366);
  assert.equal(placements[0].row, 0);
  assert.equal(placements[365].row, 5);
  assert.ok(placements.every((item) => item.source.startsWith('/sprites/flowerbed/')));
  assert.ok(placements.every((item) => item.x >= 5 && item.x <= 675));
  assert.ok(placements.every((item) => item.y >= 358 && item.y <= 410));
});

test('flowerbedPlacements is deterministic and preserves activity metadata', () => {
  const days = [
    { activity: 0, date: '2026-01-01', level: 0 },
    { activity: 42, date: '2026-01-02', level: 4 }
  ];

  const first = flowerbedPlacements(days, sprites, '/sprites/');
  const second = flowerbedPlacements(days, sprites, '/sprites/');

  assert.deepEqual(first, second);
  assert.deepEqual(
    first.map(({ activity, date, level }) => ({ activity, date, level })),
    days
  );
  assert.ok(first[1].width > first[0].width);
});

test('flowerbedDays still supplies a complete quiet-year fallback', () => {
  const days = flowerbedDays(
    { projects: [] },
    new Date('2026-07-30T08:00:00Z')
  );

  assert.equal(days.length, 366);
  assert.equal(days.at(-1).date, '2026-07-30');
  assert.ok(days.every((day) => day.activity === 0 && day.level === 0));
});
