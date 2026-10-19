import test from 'node:test';
import assert from 'node:assert/strict';
import { renderHeatmap, renderHourOfWeek } from '../render-heatmap.js';

function svgElement(tag) {
  return {
    tag, attrs: {}, children: [], dataset: {},
    setAttribute(name, value) { this.attrs[name] = value; },
    appendChild(child) { this.children.push(child); },
    addEventListener() {},
  };
}

test('heatmap handles an empty window and uses surface colors and shared token units', (context) => {
  const previous = globalThis.document;
  globalThis.document = { createElementNS: (_ns, tag) => svgElement(tag) };
  context.after(() => {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  });
  const host = svgElement('div');
  const empty = renderHeatmap(host, [], { mode: 'mini' });
  assert.ok(Number(empty.svg.attrs.width) > 0);

  const { svg } = renderHeatmap(host, [{ date: '2026-06-18', value: 2_400_000_000, level: 4 }]);
  const cell = svg.children.find((child) => child.tag === 'rect');
  assert.equal(cell.attrs.fill, 'var(--heatmap-4)');
  assert.match(cell.children[0].textContent, /2\.4B tokens/);

  const punchcard = svgElement('div');
  renderHourOfWeek(punchcard, []);
  const quietCell = punchcard.children[0].children.find((child) => child.tag === 'rect');
  assert.equal(quietCell.attrs.fill, 'var(--heatmap-0)');
});
