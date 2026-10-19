import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ISO_CAT_HABITAT, WALL_CAT_HABITAT, catTravelProgress, catWalkKeyframes,
  nextCatNode, planCatLeg, sampleCatLeg,
} from '../cat-motion.js';
import { isoToScreen } from '../renderers/isometric-base.js';

const project = ({ x, y }) => ({ x, y, scale: 1, z: 64 });
const isoProject = ({ x, y }) => isoToScreen(x, y);

test('travel starts/stops with zero speed and has an even cruise', () => {
  assert.equal(catTravelProgress(0), 0);
  assert.equal(catTravelProgress(1), 1);
  assert.ok(catTravelProgress(0.001) < 0.000001);
  assert.ok(1 - catTravelProgress(0.999) < 0.000001);
  const speed = (t) => catTravelProgress(t + 0.001) - catTravelProgress(t);
  assert.ok(Math.abs(speed(0.3) - speed(0.6)) < 1e-12);
  let last = 0;
  for (let i = 0; i <= 1000; i++) {
    const position = catTravelProgress(i / 1000);
    assert.ok(position >= last && position <= 1);
    last = position;
  }
});

test('gait follows arc distance, keeps one facing, and never visits empty sheet cells', () => {
  const leg = planCatLeg({ x: 10, y: 20 }, { x: 100, y: 32 }, project, { bend: 0.06 });
  assert.deepEqual(sampleCatLeg(leg, 0).point, { x: 10, y: 20 });
  assert.deepEqual(sampleCatLeg(leg, 1).point, { x: 100, y: 32 });
  assert.equal(leg.facing, 'right');
  for (let i = 0; i <= 1000; i++) {
    const frame = sampleCatLeg(leg, i / 1000);
    assert.ok(frame.frame >= 0 && frame.frame < 8);
    assert.ok(Number.isFinite(frame.screen.x));
  }
  const css = catWalkKeyframes(leg);
  assert.ok(!css.position.includes('NaN'));
  assert.ok(!css.frames.includes('88.889%'));
});

test('depth-only travel does not flip on tiny horizontal differences', () => {
  const leg = planCatLeg({ x: 10, y: 20 }, { x: 12, y: 60 }, project, { facing: 'left' });
  assert.equal(leg.facing, 'left');
  const still = planCatLeg({ x: 10, y: 20 }, { x: 10, y: 20 }, project);
  assert.deepEqual(sampleCatLeg(still, 1).point, { x: 10, y: 20 });
});

test('patrol picks only connected neighbours, including dead-end reversals', () => {
  for (const habitat of [WALL_CAT_HABITAT, ISO_CAT_HABITAT]) {
    for (let node = 0; node < habitat.nodes.length; node++) {
      for (const value of [0, 0.5, 0.99]) {
        const next = nextCatNode(habitat, node, node - 1, () => value);
        assert.ok(habitat.edges.some(([a, b]) => a === node && b === next || b === node && a === next));
      }
    }
  }
  assert.equal(nextCatNode(WALL_CAT_HABITAT, 0, 1, () => 0), 1);
});

test('all curved iso lanes stay on land, outside the pond and prop footprints', () => {
  const obstacles = [
    { x: 0.33, y: 0.75, radius: 0.16 },
    { x: 0.41, y: 0.54, radius: 0.12 },
    { x: 0.77, y: 0.48, radius: 0.24 },
    { x: 0.80, y: 0.61, radius: 0.10 },
  ];
  for (const [a, b] of ISO_CAT_HABITAT.edges) {
    for (const bend of [-0.06, 0, 0.06]) {
      const leg = planCatLeg(ISO_CAT_HABITAT.nodes[a], ISO_CAT_HABITAT.nodes[b], isoProject, { bend });
      for (let i = 0; i <= 100; i++) {
        const { point } = sampleCatLeg(leg, i / 100);
        assert.ok(point.x > 0.1 && point.x < 0.9 && point.y > 0.6 && point.y <= 0.96);
        for (const obstacle of obstacles) {
          assert.ok(Math.hypot(point.x - obstacle.x, point.y - obstacle.y) >= obstacle.radius,
            `edge ${a}-${b} intersects obstacle at ${obstacle.x},${obstacle.y}`);
        }
      }
    }
  }
});

test('interrupt/resume preserves the exact current ground anchor', () => {
  const leg = planCatLeg({ x: 10, y: 20 }, { x: 100, y: 32 }, project, { bend: -0.06 });
  const paused = sampleCatLeg(leg, 0.42);
  const resumed = planCatLeg(paused.point, { x: 100, y: 32 }, project);
  assert.deepEqual(sampleCatLeg(resumed, 0).point, paused.point);
});
