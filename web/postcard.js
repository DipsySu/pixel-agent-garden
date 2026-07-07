import { savePostcard } from './data-source.js';
import { escapeHtml, fmtLocal } from './render-helpers.js';
import { t } from './i18n.js';

const EXPORT_WIDTH = 1360;
const EXPORT_HEIGHT = 880;
const SVG_NS = 'http://www.w3.org/2000/svg';
// Shared font stack with CJK fallbacks (system fonts only — no web fonts, which
// are unreliable across the mac/win/linux Tauri webviews).
const FONT_STACK = 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';

export async function buildPostcardCanvas({ scene, assetRoot, summary, anonymize }) {
  if (!scene) throw new Error('scene is required');

  const canvas = document.createElement('canvas');
  canvas.width = EXPORT_WIDTH;
  canvas.height = EXPORT_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2D context unavailable');
  ctx.imageSmoothingEnabled = false;

  await drawBaseSvg(ctx, scene, assetRoot);
  drawWallEdgeCover(ctx, scene);
  await drawSprites(ctx, scene);
  // The live cat (a CSS sprite-sheet <span>) and the ambient season particles
  // are NOT `.pg6-sprite` elements, so drawSprites never sees them — without
  // this the postcard silently dropped the cat and all the season ambiance.
  await drawGardenCat(ctx, scene);
  drawParticles(ctx, scene);
  drawCaption(ctx, scene, summary, anonymize);
  // P1 postcard treatment: a season "stamp" top-right, a circular postmark
  // stamped over it, and a pixel border framing the whole card.
  drawStamp(ctx, scene);
  drawPostmark(ctx);
  drawFrame(ctx);

  return canvas;
}

export async function buildPostcardBlob(options) {
  return canvasToPngBlob(await buildPostcardCanvas(options));
}

export async function saveGardenPostcard({ scene, assetRoot, summary, anonymize, canvas }) {
  // Reuse a preview canvas when one is supplied (so Save doesn't re-render);
  // otherwise build a fresh one.
  const blob = await canvasToPngBlob(
    canvas || await buildPostcardCanvas({ scene, assetRoot, summary, anonymize })
  );
  return savePostcard(blob, suggestedPostcardName(scene));
}

export function suggestedPostcardName(scene, date = new Date()) {
  const season = sanitizeFilePart(scene?.dataset?.season || 'garden');
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return 'garden-' + season + '-' + yyyy + mm + dd + '.png';
}

/**
 * Postcard flow — the share drawer's "Garden postcard" artifact (PRD 2.0
 * §5.3: the old standalone footer Postcard button became a row in the share
 * drawer). Content-provider shape, exactly like insight/dashboard became
 * data-drawer providers: this renders the export UI INTO the host the drawer
 * hands it and returns `{ activate }`; the shell (footer button, paper panel,
 * Escape, popover-group membership) lives in web/share-drawer.js. The
 * render + save pipeline above/below this mount is untouched.
 *
 * @param {{
 *   host: HTMLElement,
 *   scene: HTMLElement,
 *   assetRoot: string,
 *   getSummary: () => object | null,
 *   onError?: (message: string, err: unknown) => void,
 *   onRequestClose?: () => void,
 * }} opts
 * @returns {{ activate: () => void }}
 */
export function mountPostcardContent({ host, scene, assetRoot, getSummary, onError, onRequestClose }) {
  // Same anatomy the static #postcard-export-panel markup used to carry in
  // index.html (title / preview / anonymize toggle / actions), now owned by
  // the provider so the drawer stays ignorant of flow internals.
  host.innerHTML =
    '<div class="pg6-postcard-title">' + escapeHtml(t('postcard.panelTitle')) + '</div>' +
    '<canvas id="postcard-preview" class="pg6-postcard-preview" width="1360" height="880" aria-hidden="true"></canvas>' +
    '<label class="pg6-postcard-toggle">' +
    '<input id="postcard-include-busiest" type="checkbox">' +
    '<span>' + escapeHtml(t('postcard.includeBusiest')) + '</span>' +
    '</label>' +
    '<div class="pg6-postcard-actions">' +
    '<button id="postcard-export-button" class="pg6-postcard-export" type="button">' + escapeHtml(t('postcard.export')) + '</button>' +
    '<span id="postcard-status" class="pg6-postcard-status" aria-live="polite"></span>' +
    '</div>';
  const include = host.querySelector('#postcard-include-busiest');
  const exportButton = host.querySelector('#postcard-export-button');
  const status = host.querySelector('#postcard-status');
  const preview = host.querySelector('#postcard-preview');
  let lastCanvas = null;   // the live preview canvas, reused on Save (no re-render)
  let rendering = false;

  // The "include project name" toggle changes the caption — re-render so the
  // preview always reflects exactly what will be saved (and the user can verify
  // anonymization before committing).
  include.addEventListener('change', () => { renderPreview(); });

  exportButton.addEventListener('click', async () => {
    if (rendering) return;
    if (!lastCanvas) await renderPreview();
    if (!lastCanvas) return;
    exportButton.disabled = true;
    setStatus(t('postcard.exporting'));
    try {
      const saved = await saveGardenPostcard({ scene, canvas: lastCanvas });
      setStatus(saved ? t('postcard.saved') : t('postcard.cancelled'));
      if (saved) onRequestClose?.();
    } catch (err) {
      setStatus(t('postcard.error'));
      if (typeof onError === 'function') onError('postcard export failed', err);
    } finally {
      exportButton.disabled = false;
    }
  });

  async function renderPreview() {
    if (rendering) return;
    rendering = true;
    lastCanvas = null;
    exportButton.disabled = true;
    setStatus(t('postcard.rendering'));
    try {
      const canvas = await buildPostcardCanvas({
        scene,
        assetRoot,
        summary: typeof getSummary === 'function' ? getSummary() : null,
        anonymize: !include.checked
      });
      lastCanvas = canvas;
      if (preview instanceof HTMLCanvasElement) {
        preview.width = canvas.width;
        preview.height = canvas.height;
        const pctx = preview.getContext('2d');
        if (pctx) { pctx.imageSmoothingEnabled = false; pctx.drawImage(canvas, 0, 0); }
      }
      setStatus('');
    } catch (err) {
      setStatus(t('postcard.error'));
      if (typeof onError === 'function') onError('postcard preview failed', err);
    } finally {
      rendering = false;
      exportButton.disabled = false;
    }
  }

  function setStatus(value) {
    if (status) status.textContent = value || '';
  }

  return {
    // Drawer flow activation = what opening the old standalone panel did:
    // render the preview and land focus on the anonymization toggle.
    activate: () => {
      renderPreview();
      include.focus();
    }
  };
}

async function drawBaseSvg(ctx, scene, assetRoot) {
  void assetRoot;
  const svg = scene.querySelector(':scope > svg');
  if (!(svg instanceof SVGSVGElement)) throw new Error('base SVG not found');
  const clone = svg.cloneNode(true);
  clone.setAttribute('xmlns', SVG_NS);
  clone.setAttribute('width', String(EXPORT_WIDTH));
  clone.setAttribute('height', String(EXPORT_HEIGHT));
  await inlineSvgImages(clone);

  const serialized = new XMLSerializer().serializeToString(clone);
  const image = await loadImage('data:image/svg+xml;base64,' + base64Utf8(serialized));
  ctx.drawImage(image, 0, 0, EXPORT_WIDTH, EXPORT_HEIGHT);
}

async function inlineSvgImages(svg) {
  const images = Array.from(svg.querySelectorAll('image'));
  await Promise.all(images.map(async (image) => {
    const href = image.getAttribute('href') || image.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
    if (!href || href.startsWith('data:')) return;
    const url = new URL(href, document.baseURI);
    const dataUri = await imageUrlToDataUri(url.href);
    image.setAttribute('href', dataUri);
    image.removeAttributeNS('http://www.w3.org/1999/xlink', 'href');
  }));
}

async function imageUrlToDataUri(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('failed to fetch export image: ' + response.status);
  const contentType = response.headers.get('content-type') || 'image/png';
  const buffer = await response.arrayBuffer();
  return 'data:' + contentType + ';base64,' + base64Bytes(new Uint8Array(buffer));
}

function drawWallEdgeCover(ctx, scene) {
  const edge = scene.querySelector('.pg6-wall-edge-cover');
  if (!(edge instanceof HTMLElement)) return;
  const style = getComputedStyle(edge);
  if (style.display === 'none' || style.visibility === 'hidden') return;

  const rect = edge.getBoundingClientRect();
  const sceneRect = scene.getBoundingClientRect();
  const box = scaledBox(rect, sceneRect);
  if (!box) return;

  ctx.save();
  ctx.globalAlpha = parseCssAlpha(style.opacity);
  ctx.fillStyle = style.backgroundColor || '#48382a';
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.restore();
}

async function drawSprites(ctx, scene) {
  const sceneRect = scene.getBoundingClientRect();
  const sprites = Array.from(scene.querySelectorAll('.pg6-sprite'));
  const supportsFilter = 'filter' in ctx;

  for (const sprite of sprites) {
    if (!(sprite instanceof HTMLImageElement)) continue;
    if (sprite.matches('.pg6-info, .pg6-petal, .pg6-season-particle')) continue;
    const style = getComputedStyle(sprite);
    if (style.display === 'none' || style.visibility === 'hidden') continue;

    const rect = sprite.getBoundingClientRect();
    const box = scaledBox(rect, sceneRect);
    const alpha = parseCssAlpha(style.opacity);
    if (!box || alpha <= 0) continue;
    await ensureDecoded(sprite);
    if (!sprite.naturalWidth || !sprite.naturalHeight) continue;

    ctx.save();
    ctx.globalAlpha = alpha;
    if (supportsFilter) {
      try {
        ctx.filter = style.filter && style.filter !== 'none' ? style.filter : 'none';
      } catch (_) {
        ctx.filter = 'none';
      }
    }
    ctx.drawImage(sprite, box.x, box.y, box.w, box.h);
    ctx.restore();
  }
}

// The garden cat is a <span> backed by a 10×3 sprite sheet, animated over rAF.
// For the postcard we draw a FIXED sit frame (row 2, col 4) at the cat's current
// on-screen rect, so the export is deterministic — never a half-stride walk
// frame — no matter when Export is pressed.
async function drawGardenCat(ctx, scene) {
  const cat = scene.querySelector('.pg6-garden-cat');
  if (!(cat instanceof HTMLElement)) return;
  const style = getComputedStyle(cat);
  if (style.display === 'none' || style.visibility === 'hidden') return;
  const alpha = parseCssAlpha(style.opacity);
  if (alpha <= 0) return;
  const match = /url\(["']?(.*?)["']?\)/.exec(style.backgroundImage || '');
  if (!match || !match[1]) return;
  let sheet;
  try { sheet = await loadImage(new URL(match[1], document.baseURI).href); }
  catch (_) { return; }
  if (!sheet.naturalWidth || !sheet.naturalHeight) return;
  const box = scaledBox(cat.getBoundingClientRect(), scene.getBoundingClientRect());
  if (!box) return;
  const cols = 10, rows = 3;
  const fw = sheet.naturalWidth / cols, fh = sheet.naturalHeight / rows;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = false;
  if ('filter' in ctx) ctx.filter = 'none';
  ctx.drawImage(sheet, 4 * fw, 2 * fh, fw, fh, box.x, box.y, box.w, box.h);
  ctx.restore();
}

// Season particles (.pg6-petal + .pg6-season-particle): small CSS color blocks
// or sprite imgs, animated by CSS. Draw each at its current rect honoring its
// live opacity, so mid-fade-in particles stay faint exactly as on screen and
// fully-faded ones are skipped (keeps the export matching the moment).
function drawParticles(ctx, scene) {
  const sceneRect = scene.getBoundingClientRect();
  for (const el of scene.querySelectorAll('.pg6-petal, .pg6-season-particle')) {
    if (!(el instanceof HTMLElement)) continue;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    const alpha = parseCssAlpha(style.opacity);
    if (alpha <= 0.04) continue;
    const box = scaledBox(el.getBoundingClientRect(), sceneRect);
    if (!box) continue;
    ctx.save();
    ctx.globalAlpha = alpha;
    if ('filter' in ctx) ctx.filter = 'none';
    if (el instanceof HTMLImageElement && el.naturalWidth) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(el, box.x, box.y, box.w, box.h);
    } else {
      ctx.fillStyle = style.backgroundColor || 'rgba(255,255,255,0.9)';
      const radius = style.borderRadius || '';
      const round = radius.includes('50%') || parseFloat(radius) >= Math.min(box.w, box.h) / 2;
      if (round) {
        ctx.beginPath();
        ctx.ellipse(box.x + box.w / 2, box.y + box.h / 2, box.w / 2, box.h / 2, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(box.x, box.y, box.w, box.h);
      }
    }
    ctx.restore();
  }
}

function drawCaption(ctx, scene, summary, anonymize) {
  const stripHeight = 76;
  const seasonLabel = scene?.dataset?.seasonLabel || t('season.spring');
  const timeLabel = scene?.dataset?.timeLabel || t('time.day');
  const projects = Array.isArray(summary?.projects) ? summary.projects : [];
  const total = summary?.total_tokens ?? projects.reduce((sum, item) => sum + (item.total_tokens || 0), 0);

  // Line 1 (title): the garden's state — "<season> · <time of day>".
  const line1 = seasonLabel + ' · ' + timeLabel;
  // Line 2 (stats): vine count + total tokens, plus the busiest project name
  // ONLY when the user opted in — and never a filesystem path (see topProject).
  const stats = [
    t('postcard.vines', { count: projects.length || summary?.active_projects || 0 }),
    t('postcard.tokens', { total: fmtLocal(total) })
  ];
  if (!anonymize) {
    const top = topProject(projects);
    if (top) stats.push(t('postcard.busiest', { name: top }));
  }
  const line2 = stats.join(' · ');

  ctx.save();
  ctx.globalAlpha = 1;
  if ('filter' in ctx) ctx.filter = 'none';
  // Solid dark scrim: keeps text legible over any scene (bright day, white
  // winter, dark night) without per-scene contrast tuning.
  ctx.fillStyle = 'rgba(16, 20, 15, 0.86)';
  ctx.fillRect(0, EXPORT_HEIGHT - stripHeight, EXPORT_WIDTH, stripHeight);
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(246, 238, 222, 0.97)';
  ctx.font = '600 27px ' + FONT_STACK;
  ctx.fillText(fitOneLine(ctx, line1, EXPORT_WIDTH - 64), 32, EXPORT_HEIGHT - stripHeight + 27);
  ctx.fillStyle = 'rgba(214, 210, 196, 0.9)';
  ctx.font = '20px ' + FONT_STACK;
  ctx.fillText(fitOneLine(ctx, line2, EXPORT_WIDTH - 64), 32, EXPORT_HEIGHT - stripHeight + 54);
  ctx.restore();
}

function topProject(projects) {
  if (!projects.length) return '';
  const top = [...projects].sort((a, b) => (b.total_tokens || 0) - (a.total_tokens || 0))[0];
  // display_name is already a path basename (core strips it). NEVER fall back
  // to project_key — that's typically an absolute local path and would leak the
  // user's directory structure into a shared image.
  return top?.display_name || '';
}

// --- P1 postcard treatment ------------------------------------------------
// A pixel border + a season "stamp" + a postmark, all drawn on the canvas with
// system fonts only (no web fonts, no paper texture / handwriting — those are
// fragile across the Tauri webviews; the look stays crisp pixel-UI instead).

function drawFrame(ctx) {
  ctx.save();
  ctx.globalAlpha = 1;
  if ('filter' in ctx) ctx.filter = 'none';
  ctx.strokeStyle = 'rgba(26, 20, 14, 0.92)';   // thick dark outer band
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, EXPORT_WIDTH - 10, EXPORT_HEIGHT - 10);
  ctx.strokeStyle = 'rgba(246, 238, 222, 0.85)'; // thin cream inner keyline
  ctx.lineWidth = 2;
  ctx.strokeRect(15, 15, EXPORT_WIDTH - 30, EXPORT_HEIGHT - 30);
  ctx.restore();
}

// Season → a warm accent for the stamp's inner panel.
function seasonAccent(mode) {
  switch (mode) {
    case 'summer': return '#4f8030';
    case 'autumn': return '#b0682a';
    case 'winter': return '#8aa0b4';
    default:       return '#d98aa8'; // spring
  }
}

const STAMP = { w: 132, h: 156, mx: 46, my: 40 };

function drawStamp(ctx, scene) {
  const label = scene?.dataset?.seasonLabel || t('season.spring');
  const mode = scene?.dataset?.season || 'spring';
  const sx = EXPORT_WIDTH - STAMP.w - STAMP.mx, sy = STAMP.my;
  ctx.save();
  if ('filter' in ctx) ctx.filter = 'none';
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(245, 239, 227, 0.97)';            // stamp paper
  ctx.fillRect(sx, sy, STAMP.w, STAMP.h);
  ctx.strokeStyle = 'rgba(40, 32, 22, 0.5)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(sx + 0.75, sy + 0.75, STAMP.w - 1.5, STAMP.h - 1.5);
  const pad = 11;                                          // season-tinted panel
  ctx.fillStyle = seasonAccent(mode);
  ctx.fillRect(sx + pad, sy + pad, STAMP.w - 2 * pad, STAMP.h - 2 * pad);
  ctx.fillStyle = 'rgba(248, 244, 236, 0.98)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '600 30px ' + FONT_STACK;
  ctx.fillText(label, sx + STAMP.w / 2, sy + STAMP.h / 2 - 6);
  ctx.font = '12px ' + FONT_STACK;
  ctx.fillText('PIXEL GARDEN', sx + STAMP.w / 2, sy + STAMP.h - 24);
  ctx.restore();
}

function drawPostmark(ctx) {
  // Overlap the stamp's lower-left like a real cancellation mark.
  const cx = EXPORT_WIDTH - STAMP.w - STAMP.mx + 22;
  const cy = STAMP.my + STAMP.h - 22;
  const r = 58;
  ctx.save();
  if ('filter' in ctx) ctx.filter = 'none';
  ctx.globalAlpha = 0.8;
  ctx.strokeStyle = '#2c4664';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, r - 9, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#2c4664';
  drawArcText(ctx, 'LOCAL AGENT GARDEN', cx, cy, r - 4.5, -Math.PI / 2, 3.0);
  const d = new Date();
  const ds = d.getFullYear() + '.' + pad2(d.getMonth() + 1) + '.' + pad2(d.getDate());
  ctx.font = '700 19px ' + FONT_STACK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(ds, cx, cy + 2);
  ctx.restore();
}

function pad2(n) { return String(n).padStart(2, '0'); }

// Lay text along a circular arc centered on (cx,cy), centered at `midAngle`
// (radians; -PI/2 = top), spanning `arcSpan` radians total, letters upright.
function drawArcText(ctx, text, cx, cy, radius, midAngle, arcSpan) {
  const chars = [...text];
  ctx.font = '700 12px ' + FONT_STACK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const start = midAngle - arcSpan / 2;
  for (let i = 0; i < chars.length; i++) {
    const a = start + arcSpan * (chars.length === 1 ? 0.5 : i / (chars.length - 1));
    ctx.save();
    ctx.translate(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
    ctx.rotate(a + Math.PI / 2);
    ctx.fillText(chars[i], 0, 0);
    ctx.restore();
  }
}

function fitOneLine(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(text.slice(0, mid) + '...').width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo).trimEnd() + '...';
}

function scaledBox(rect, sceneRect) {
  if (!sceneRect.width || !sceneRect.height || rect.width <= 0 || rect.height <= 0) return null;
  return {
    x: (rect.left - sceneRect.left) / sceneRect.width * EXPORT_WIDTH,
    y: (rect.top - sceneRect.top) / sceneRect.height * EXPORT_HEIGHT,
    w: rect.width / sceneRect.width * EXPORT_WIDTH,
    h: rect.height / sceneRect.height * EXPORT_HEIGHT
  };
}

async function ensureDecoded(image) {
  if (!image.complete && image.decode) {
    await image.decode().catch(() => {});
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('failed to load export image'));
    image.src = src;
  });
}

function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('canvas export failed'));
    }, 'image/png');
  });
}

function base64Utf8(value) {
  return base64Bytes(new TextEncoder().encode(value));
}

function base64Bytes(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function parseCssAlpha(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1;
}

function sanitizeFilePart(value) {
  return String(value || 'garden').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'garden';
}
