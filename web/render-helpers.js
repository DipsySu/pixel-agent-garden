export function groupSprites(sprites) {
    const groups = {};
    for (const sprite of sprites) {
      if (!groups[sprite.group]) groups[sprite.group] = [];
      groups[sprite.group].push(sprite);
    }
    return groups;
  }

export function fmtLocal(value) {
    // Scale then round, and let a value that rounds up to 1000.0 of its unit
    // roll into the next unit (999,950,000 reads as '1.0B', not '1000.0M').
    const scaled = (value, unit) => {
      const n = value / unit;
      return n >= 999.95 ? null : n.toFixed(1);
    };
    if (value >= 1000000000) return (value / 1000000000).toFixed(1) + 'B';
    if (value >= 1000000) {
      const m = scaled(value, 1000000);
      return m === null ? '1.0B' : m + 'M';
    }
    if (value >= 1000) {
      const k = scaled(value, 1000);
      return k === null ? '1.0M' : k + 'k';
    }
    return String(value || 0);
  }

export function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    })[char]);
  }

export function pick(group, seed) {
    return group[Math.abs(seed) % group.length];
  }

export function pickByToken(group, level) {
    const index = Math.round((level - 1) / 4 * (group.length - 1));
    return group[Math.max(0, Math.min(group.length - 1, index))];
  }

export function namedSprite(group, name) {
    return group.find((sprite) => sprite.name === name);
  }

export function jitter(a, b) {
    const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
    return x - Math.floor(x);
  }

// The app-wide stillness rule (renderers own `data-motion` on the scene):
// shared so the banner, first-run reveal, and future overlays can never
// drift from the garden's own motion decision.
export function isMotionStill(host) {
    const mode = host?.dataset?.motion || 'system';
    const prefersReduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return mode === 'off' || mode === 'reduced' || prefersReduced;
  }

// Friendly display name for an adapter source id. Brand names stay as-is
// across locales; only the generic manual source is translated — the same
// rule render-garden's info card uses, shared so the composition tab and any
// future surface can't drift from it.
export function sourceLabel(id, translate) {
    const pretty = { 'claude-code': 'Claude Code', 'claude-cowork': 'Cowork', codex: 'Codex' };
    if (pretty[id]) return pretty[id];
    if (id === 'manual-jsonl' && typeof translate === 'function') return translate('source.manual');
    return id;
  }

// Shared KPI card markup (Overview / Cost / Rings tabs). One template so the
// card structure cannot drift between tabs.
export function kpiCard(label, value, sub) {
    return (
      '<div class="pg6-dashboard-kpi">' +
      '<div class="pg6-dashboard-kpi-label">' + escapeHtml(label) + '</div>' +
      '<div class="pg6-dashboard-kpi-value">' + escapeHtml(value) + '</div>' +
      (sub ? '<div class="pg6-dashboard-kpi-sub">' + escapeHtml(sub) + '</div>' : '') +
      '</div>'
    );
  }

// Shared close button for drawer tab heads (and future paper panels).
export function closeButton(label) {
    return (
      '<button class="pg6-insight-close" type="button" aria-label="' + escapeHtml(label) + '">' +
      '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
      '<path d="M6 6 18 18 M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
      '</svg></button>'
    );
  }
