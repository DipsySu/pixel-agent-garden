// Shared canvas primitives for share artifacts (weekly recap / year review).
// The garden postcard still owns its DOM-screenshot pipeline; data-born cards
// use this module so card DNA stays aligned without coupling each flow.

export const DAY_MS = 24 * 60 * 60 * 1000;

// PRD 2.0 §5.4-E: one portrait card DNA for recap/share artifacts.
export const CARD_W = 960;
export const CARD_H = 1280;

// Palette hardcoded from web/index.html `:root` (a raw canvas 2D context
// cannot resolve CSS custom properties).
export const PAPER = '#f4ecd8';
export const INK = '#2c2316';
export const PAPER_EDGE = '#c9b790';
export const GREEN = '#6f9c3f';
export const MUTED = '#8a7656';
export const CREAM = '#fffaf0';

// Shared font stack with CJK fallbacks. Silkscreen / VT323 are self-hosted in
// index.html; CJK glyphs fall through to system fonts per glyph.
export const FONT_STACK = 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
export const FONT_PIXEL = '"Silkscreen", ' + FONT_STACK;
export const FONT_NUM = '"VT323", ui-monospace, monospace';

export async function ensureCardFonts() {
  try {
    if (document.fonts?.load) {
      await Promise.all([
        document.fonts.load('700 46px Silkscreen'),
        document.fonts.load('96px VT323')
      ]);
    }
  } catch (_) {
    // Fall back to the system stack.
  }
}

export function drawPaperFrame(ctx) {
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, CARD_W - 8, CARD_H - 8);
  ctx.lineWidth = 2;
  ctx.strokeRect(18, 18, CARD_W - 36, CARD_H - 36);
}

export function fitOneLine(ctx, text, maxWidth) {
  const value = String(text || '');
  if (ctx.measureText(value).width <= maxWidth) return value;
  let lo = 0;
  let hi = value.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(value.slice(0, mid) + '...').width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return value.slice(0, lo).trimEnd() + '...';
}

export function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('canvas export failed'));
    }, 'image/png');
  });
}
