// Pure route/timing math. Coordinates belong to each renderer's ground plane;
// projection is injected so the same gait covers the wall and isometric views.
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const mix = (a, b, t) => a + (b - a) * t;

export const WALL_CAT_HABITAT = {
  home: 3,
  nodes: [
    { x: 32, y: 91 }, { x: 41, y: 89.5 }, { x: 49, y: 91 },
    { x: 57, y: 90 }, { x: 65, y: 89 }, { x: 70, y: 91.5 },
  ],
  edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5]],
};

export const ISO_CAT_HABITAT = {
  home: 3,
  nodes: [
    { x: 0.18, y: 0.94 }, { x: 0.34, y: 0.95 },
    { x: 0.50, y: 0.94 }, { x: 0.65, y: 0.88 },
    { x: 0.71, y: 0.78 }, { x: 0.64, y: 0.72 },
    { x: 0.53, y: 0.70 }, { x: 0.50, y: 0.80 },
  ],
  // Connected lanes around the pond, never a random shortcut across a prop.
  edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 2]],
};

export function nextCatNode(habitat, current, previous, random = Math.random) {
  const neighbours = habitat.edges.flatMap(([a, b]) => a === current ? [b] : b === current ? [a] : []);
  const forward = neighbours.filter((node) => node !== previous);
  const choices = forward.length && random() < 0.84 ? forward : neighbours;
  return choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))] ?? current;
}

// Cosine acceleration, constant-speed middle, cosine braking. Unlike a
// perpetual ease-in-out, most of a stroll has an even, unhurried cadence.
export function catTravelProgress(time) {
  const t = clamp(time, 0, 1);
  const ramp = 0.2;
  if (t > 1 - ramp) return 1 - catTravelProgress(1 - t);
  if (t < ramp) return (t - ramp / Math.PI * Math.sin(Math.PI * t / ramp)) / (2 * (1 - ramp));
  return (t - ramp / 2) / (1 - ramp);
}

export function catFrameBackground(column, row) {
  return `${(column * 100 / 9).toFixed(3)}% ${row * 50}%`;
}

export function planCatLeg(from, to, project, { facing = 'right', width = 58, bend = 0 } = {}) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const control = {
    x: clamp((from.x + to.x) / 2 - dy * bend, Math.min(from.x, to.x), Math.max(from.x, to.x)),
    y: (from.y + to.y) / 2 + dx * bend,
  };
  const samples = [];
  let distance = 0;
  for (let i = 0; i <= 64; i++) {
    const t = i / 64;
    const point = {
      x: (1 - t) ** 2 * from.x + 2 * (1 - t) * t * control.x + t * t * to.x,
      y: (1 - t) ** 2 * from.y + 2 * (1 - t) * t * control.y + t * t * to.y,
    };
    const screen = project(point);
    if (i) distance += Math.hypot(screen.x - samples[i - 1].screen.x, screen.y - samples[i - 1].screen.y);
    samples.push({ point, screen, distance });
  }
  const screenDx = samples.at(-1).screen.x - samples[0].screen.x;
  // Almost depth-only moves keep their heading, avoiding left/right flicker.
  const direction = Math.abs(screenDx) < 6 ? facing : screenDx > 0 ? 'right' : 'left';
  return {
    samples, distance, facing: direction,
    duration: Math.max(1600, distance / (width * 0.38) * 1000),
    stride: width * 0.055,
  };
}

export function sampleCatLeg(leg, time) {
  const distance = catTravelProgress(time) * leg.distance;
  const index = leg.samples.findIndex((sample) => sample.distance >= distance);
  const b = leg.samples[index < 0 ? leg.samples.length - 1 : index];
  const a = leg.samples[Math.max(0, index - 1)];
  const t = b.distance > a.distance ? (distance - a.distance) / (b.distance - a.distance) : 0;
  const interpolate = (key) => mix(a.screen[key], b.screen[key], t);
  return {
    point: { x: mix(a.point.x, b.point.x, t), y: mix(a.point.y, b.point.y, t) },
    screen: { x: interpolate('x'), y: interpolate('y'), scale: interpolate('scale'), z: interpolate('z') },
    frame: Math.floor(distance / leg.stride) % 8,
  };
}

export function chooseCatRest(random = Math.random) {
  const sit = random() > 0.8;
  return { sit, duration: sit ? 6500 + random() * 6500 : 1100 + random() * 2100 };
}

export function catTransform(screen) {
  return `translate3d(${(screen.x / 680 * 100).toFixed(5)}%, ${(screen.y / 440 * 100).toFixed(5)}%, 0) scale(${screen.scale.toFixed(5)})`;
}

export function catWalkKeyframes(leg) {
  const position = [];
  const frames = [];
  for (let i = 0; i <= 100; i++) {
    const sample = sampleCatLeg(leg, i / 100);
    position.push(`${i}% { transform: ${catTransform(sample.screen)}; z-index: ${Math.round(sample.screen.z)}; }`);
    frames.push(`${i}% { background-position: ${catFrameBackground(sample.frame, leg.facing === 'right' ? 0 : 1)}; }`);
  }
  return { position: position.join('\n'), frames: frames.join('\n') };
}
