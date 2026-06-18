// GitHub-contribution-style calendar heatmap.
//
// Two render modes share the same data shape (`heatmap_year` from
// GardenSummary — see crates/core/src/aggregate.rs):
//
//   - 'mini' :: ~318×42 strip, fits under the header. Decorative + ambient.
//   - 'full' :: ~742×120 chart with month labels + legend, lives in the
//                dashboard panel.
//
// The 5-step quantization (`level` 0..=4) is computed server-side, so the
// client just maps level → color. Color palette is chosen to harmonize with
// the existing pixel-garden tones (warm-brown frame, dark sky) — slightly
// desaturated GitHub-dark greens with a transparent level-0 that lets the
// underlying frame texture show through.

const PALETTE_DARK = [
  'rgba(255, 255, 255, 0.06)', // level 0 — empty day, faint placeholder
  '#1f4a26',                    // level 1
  '#2f7036',                    // level 2
  '#46a347',                    // level 3
  '#7ad36a',                    // level 4 — peak
];

const WEEKDAY_INITIAL = ['M', '', 'W', '', 'F', '', ''];

/**
 * @param {HTMLElement} container — element to render INTO (will be cleared)
 * @param {Array<{date:string, value:number, level:number}>} entries — oldest first, 365 long
 * @param {object} options
 * @param {'mini'|'full'} options.mode
 * @param {function(entry: object, event: MouseEvent): void} [options.onCellClick]
 * @param {function(): void} [options.onClickAny] — fires for ANY cell click; used by mini-strip to open dashboard
 */
export function renderHeatmap(container, entries, options = {}) {
  if (!container) return;
  const mode = options.mode || 'full';
  const isFull = mode === 'full';
  const cell = isFull ? 12 : 5;
  const gap = isFull ? 2 : 1;
  const cellStep = cell + gap;
  const showMonthLabels = isFull;
  const showWeekdayLabels = isFull;
  const safeEntries = Array.isArray(entries) ? entries : [];

  // Pack entries into 7-row columns Sunday-aligned, GitHub-style.
  // The first column gets a partial fill at the top if entries[0]'s weekday
  // isn't Sunday — pad with nulls so columns stay 7-tall.
  const columns = buildColumns(safeEntries);

  const labelLeft = showWeekdayLabels ? 14 : 0;
  const labelTop = showMonthLabels ? 14 : 0;
  const gridW = columns.length * cellStep - gap;
  const gridH = 7 * cellStep - gap;
  const svgW = labelLeft + gridW;
  const svgH = labelTop + gridH;

  const svg = createSvg('svg');
  svg.setAttribute('viewBox', `0 0 ${svgW} ${svgH}`);
  svg.setAttribute('width', String(svgW));
  svg.setAttribute('height', String(svgH));
  svg.setAttribute('class', 'pg6-heatmap-svg pg6-heatmap--' + mode);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label',
    'Activity heatmap — ' + describeWindow(safeEntries) + ', ' +
    nonZeroCount(safeEntries) + ' active days');

  // Month labels along the top edge (full mode only).
  if (showMonthLabels) {
    appendMonthLabels(svg, columns, labelLeft, cellStep);
  }

  // Weekday labels along the left edge (full mode only).
  if (showWeekdayLabels) {
    appendWeekdayLabels(svg, labelTop, cellStep);
  }

  // The grid itself.
  for (let c = 0; c < columns.length; c++) {
    for (let r = 0; r < 7; r++) {
      const entry = columns[c][r];
      if (!entry) continue;
      const x = labelLeft + c * cellStep;
      const y = labelTop + r * cellStep;
      const rect = createSvg('rect');
      rect.setAttribute('x', String(x));
      rect.setAttribute('y', String(y));
      rect.setAttribute('width', String(cell));
      rect.setAttribute('height', String(cell));
      rect.setAttribute('rx', isFull ? '2' : '1');
      rect.setAttribute('fill', PALETTE_DARK[entry.level] || PALETTE_DARK[0]);
      rect.setAttribute('class', 'pg6-heatmap-cell');
      rect.dataset.date = entry.date;
      rect.dataset.value = String(entry.value);
      rect.dataset.level = String(entry.level);
      const title = createSvg('title');
      title.textContent = `${entry.date} · ${formatTokens(entry.value)} tokens`;
      rect.appendChild(title);
      svg.appendChild(rect);
    }
  }

  container.innerHTML = '';
  container.appendChild(svg);

  // Single delegated listener — simpler than per-rect bindings, and the
  // strip mode just needs "any click → open dashboard" semantics.
  svg.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (typeof options.onClickAny === 'function') {
      options.onClickAny();
    }
    if (target.classList.contains('pg6-heatmap-cell') && typeof options.onCellClick === 'function') {
      const entry = {
        date: target.dataset.date,
        value: Number(target.dataset.value) || 0,
        level: Number(target.dataset.level) || 0,
      };
      options.onCellClick(entry, event);
    }
  });

  return { svg, columnCount: columns.length };
}

/**
 * Build a 7×N column-major grid from a flat oldest-first entries array.
 * Pad the FIRST column at the top so that day-of-week alignment lines up
 * with weekday rows (Monday = row 0). Pad the LAST column at the bottom
 * for the same reason.
 */
function buildColumns(entries) {
  const columns = [];
  if (!entries.length) return columns;
  // weekday(): JS getUTCDay() returns Sun=0..Sat=6. We use Mon=0..Sun=6
  // to match the Rust side (`num_days_from_monday`).
  const dowOf = (dateStr) => {
    const d = new Date(dateStr + 'T00:00:00Z');
    return (d.getUTCDay() + 6) % 7;
  };
  let col = new Array(7).fill(null);
  const firstDow = dowOf(entries[0].date);
  // The first entry sits at row=firstDow of column 0; cells above stay null.
  let row = firstDow;
  for (const entry of entries) {
    col[row] = entry;
    row += 1;
    if (row === 7) {
      columns.push(col);
      col = new Array(7).fill(null);
      row = 0;
    }
  }
  // Push the partial last column if it has any cells.
  if (col.some((c) => c !== null)) {
    columns.push(col);
  }
  return columns;
}

function appendMonthLabels(svg, columns, labelLeft, cellStep) {
  // Place a month label above the first column whose Mon-row falls in a new
  // month vs the previous column's first cell.
  let lastMonth = -1;
  for (let c = 0; c < columns.length; c++) {
    // Find the first non-null entry in this column to read its date.
    const firstEntry = columns[c].find((e) => e !== null);
    if (!firstEntry) continue;
    const d = new Date(firstEntry.date + 'T00:00:00Z');
    const m = d.getUTCMonth();
    if (m !== lastMonth) {
      lastMonth = m;
      // Skip the very first column's label if it's mid-month — labels look
      // cleaner when they only mark the START of a month boundary.
      if (c === 0 && d.getUTCDate() > 14) continue;
      const text = createSvg('text');
      text.setAttribute('x', String(labelLeft + c * cellStep));
      text.setAttribute('y', '10');
      text.setAttribute('class', 'pg6-heatmap-label');
      text.textContent = monthShort(m);
      svg.appendChild(text);
    }
  }
}

function appendWeekdayLabels(svg, labelTop, cellStep) {
  for (let r = 0; r < 7; r++) {
    const label = WEEKDAY_INITIAL[r];
    if (!label) continue;
    const text = createSvg('text');
    text.setAttribute('x', '0');
    text.setAttribute('y', String(labelTop + r * cellStep + cellStep * 0.75));
    text.setAttribute('class', 'pg6-heatmap-label');
    text.textContent = label;
    svg.appendChild(text);
  }
}

function monthShort(idx) {
  return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][idx] || '';
}

function describeWindow(entries) {
  if (!entries.length) return 'no data';
  return `${entries[0].date} → ${entries[entries.length - 1].date}`;
}

function nonZeroCount(entries) {
  return entries.filter((e) => e && e.value > 0).length;
}

function formatTokens(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n || 0);
}

function createSvg(tag) {
  return document.createElementNS('http://www.w3.org/2000/svg', tag);
}

// ---------------------------------------------------------------------------
// Hour-of-week punchcard (7 rows × 24 cols)
// ---------------------------------------------------------------------------

/**
 * @param {HTMLElement} container
 * @param {number[][]} grid — 7×24 event counts (Mon=0..Sun=6)
 */
export function renderHourOfWeek(container, grid) {
  if (!container) return;
  const safeGrid = Array.isArray(grid) && grid.length === 7 ? grid : empty7x24();

  const cell = 14;
  const gap = 2;
  const cellStep = cell + gap;
  const labelLeft = 22;
  const labelTop = 14;
  const w = labelLeft + 24 * cellStep - gap;
  const h = labelTop + 7 * cellStep - gap;

  // Max for client-side ratio quantization. AgentsView does this same way —
  // there's no server-side level for hour-of-week because the window is
  // user-configurable in spirit.
  let max = 0;
  for (const row of safeGrid) for (const v of row) if (v > max) max = v;

  const svg = createSvg('svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(h));
  svg.setAttribute('class', 'pg6-heatmap-svg pg6-heatmap--punchcard');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Hour-of-week activity, ${max ? max + ' max events' : 'no data'}`);

  // Hour labels along top (every 6 hours to avoid clutter).
  for (let h6 = 0; h6 < 24; h6 += 6) {
    const text = createSvg('text');
    text.setAttribute('x', String(labelLeft + h6 * cellStep));
    text.setAttribute('y', '10');
    text.setAttribute('class', 'pg6-heatmap-label');
    text.textContent = String(h6).padStart(2, '0');
    svg.appendChild(text);
  }

  // Weekday labels along left.
  const weekdayShort = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
  for (let d = 0; d < 7; d++) {
    const text = createSvg('text');
    text.setAttribute('x', '0');
    text.setAttribute('y', String(labelTop + d * cellStep + cellStep * 0.7));
    text.setAttribute('class', 'pg6-heatmap-label');
    text.textContent = weekdayShort[d];
    svg.appendChild(text);
  }

  for (let d = 0; d < 7; d++) {
    for (let h6 = 0; h6 < 24; h6++) {
      const value = safeGrid[d][h6] || 0;
      const level = clientLevel(value, max);
      const rect = createSvg('rect');
      rect.setAttribute('x', String(labelLeft + h6 * cellStep));
      rect.setAttribute('y', String(labelTop + d * cellStep));
      rect.setAttribute('width', String(cell));
      rect.setAttribute('height', String(cell));
      rect.setAttribute('rx', '2');
      rect.setAttribute('fill', PALETTE_DARK[level]);
      rect.setAttribute('class', 'pg6-heatmap-cell');
      const title = createSvg('title');
      title.textContent = `${weekdayShort[d]} ${String(h6).padStart(2, '0')}:00 · ${value} events`;
      rect.appendChild(title);
      svg.appendChild(rect);
    }
  }

  container.innerHTML = '';
  container.appendChild(svg);
}

function empty7x24() {
  return Array.from({ length: 7 }, () => new Array(24).fill(0));
}

function clientLevel(value, max) {
  if (!value || !max) return 0;
  const ratio = value / max;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}
