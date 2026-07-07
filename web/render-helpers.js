export function groupSprites(sprites) {
    const groups = {};
    for (const sprite of sprites) {
      if (!groups[sprite.group]) groups[sprite.group] = [];
      groups[sprite.group].push(sprite);
    }
    return groups;
  }

export function fmtLocal(value) {
    if (value >= 1000000) return (value / 1000000).toFixed(1) + 'M';
    if (value >= 1000) return (value / 1000).toFixed(1) + 'k';
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
