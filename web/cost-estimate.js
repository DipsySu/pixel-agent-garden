// Display/token helpers for the data drawer's Cost + Composition tabs.
//
// The cost MATH lives in one place — core::prices (Rust), surfaced via the
// `cost_estimate` command. This module used to mirror that math in JS; it no
// longer does. What remains is presentation-only: `formatUsd` renders a USD
// figure, `modelTotalTokens` reads a token total off a usage record. Neither
// prices anything.

export function modelTotalTokens(usage) {
  const u = usage && typeof usage === 'object' ? usage : {};
  const input = uint(u.input_tokens);
  const output = uint(u.output_tokens);
  const cacheRead = uint(u.cache_read_tokens);
  const cacheWrite = uint(u.cache_write_tokens);
  // Prefer the reported total; fall back to the split sum when a source only
  // populated the components (matches core's TokenUsage semantics).
  return uint(u.total_tokens) || input + output + cacheRead + cacheWrite;
}

export function formatUsd(value) {
  const n = Number(value || 0);
  // Locale pinned to 'en' like the repo's other number formatters: with the
  // browser default, de/nl/es grouping renders $1,235 as "$1.235" — a 1000x
  // misread on a money figure (review finding).
  if (n >= 1000) return '$' + n.toLocaleString('en', { maximumFractionDigits: 0 });
  if (n >= 100) return '$' + n.toFixed(1);
  return '$' + n.toFixed(2);
}

function uint(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
