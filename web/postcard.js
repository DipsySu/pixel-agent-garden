import { savePostcard } from './data-source.js';
import { fmtLocal } from './render-helpers.js';
import { t } from './i18n.js';

const EXPORT_WIDTH = 1360;
const EXPORT_HEIGHT = 880;
const SVG_NS = 'http://www.w3.org/2000/svg';

export async function buildPostcardBlob({ scene, assetRoot, summary, anonymize }) {
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
  drawCaption(ctx, scene, summary, anonymize);

  return canvasToPngBlob(canvas);
}

export async function saveGardenPostcard({ scene, assetRoot, summary, anonymize }) {
  const blob = await buildPostcardBlob({ scene, assetRoot, summary, anonymize });
  return savePostcard(blob, suggestedPostcardName(scene));
}

export function suggestedPostcardName(scene, date = new Date()) {
  const season = sanitizeFilePart(scene?.dataset?.season || 'garden');
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return 'garden-' + season + '-' + yyyy + mm + dd + '.png';
}

export function mountPostcardExport({ scene, assetRoot, getSummary, onError }) {
  const button = document.getElementById('postcard-open-button');
  const panel = document.getElementById('postcard-export-panel');
  const include = document.getElementById('postcard-include-busiest');
  const exportButton = document.getElementById('postcard-export-button');
  const status = document.getElementById('postcard-status');
  if (!button || !panel || !include || !exportButton) return null;

  button.addEventListener('click', () => togglePanel());
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      togglePanel(false);
      button.focus();
    }
  });
  exportButton.addEventListener('click', async () => {
    exportButton.disabled = true;
    setStatus(t('postcard.exporting'));
    try {
      const saved = await saveGardenPostcard({
        scene,
        assetRoot,
        summary: typeof getSummary === 'function' ? getSummary() : null,
        anonymize: !include.checked
      });
      setStatus(saved ? t('postcard.saved') : t('postcard.cancelled'));
      if (saved) togglePanel(false);
    } catch (err) {
      setStatus(t('postcard.error'));
      if (typeof onError === 'function') onError('postcard export failed', err);
    } finally {
      exportButton.disabled = false;
    }
  });

  function togglePanel(force) {
    const open = typeof force === 'boolean' ? force : panel.hidden;
    panel.hidden = !open;
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    button.classList.toggle('is-active', open);
    if (open) {
      setStatus('');
      include.focus();
    }
  }

  function setStatus(value) {
    if (status) status.textContent = value || '';
  }

  return { close: () => togglePanel(false) };
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

function drawCaption(ctx, scene, summary, anonymize) {
  const stripHeight = 54;
  const season = scene?.dataset?.seasonLabel || t('season.spring');
  const projects = Array.isArray(summary?.projects) ? summary.projects : [];
  const total = summary?.total_tokens ?? projects.reduce((sum, item) => sum + (item.total_tokens || 0), 0);
  const parts = [
    season,
    t('postcard.vines', { count: projects.length || summary?.active_projects || 0 }),
    t('postcard.tokens', { total: fmtLocal(total) })
  ];
  if (!anonymize) {
    const top = topProject(projects);
    if (top) parts.push(t('postcard.busiest', { name: top }));
  }

  ctx.save();
  ctx.globalAlpha = 1;
  if ('filter' in ctx) ctx.filter = 'none';
  ctx.fillStyle = 'rgba(16, 20, 15, 0.84)';
  ctx.fillRect(0, EXPORT_HEIGHT - stripHeight, EXPORT_WIDTH, stripHeight);
  ctx.fillStyle = 'rgba(244, 234, 216, 0.94)';
  ctx.font = '22px ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(fitOneLine(ctx, parts.join(' · '), EXPORT_WIDTH - 64), 32, EXPORT_HEIGHT - stripHeight / 2 + 1);
  ctx.restore();
}

function topProject(projects) {
  if (!projects.length) return '';
  const top = [...projects].sort((a, b) => (b.total_tokens || 0) - (a.total_tokens || 0))[0];
  return top?.display_name || top?.project_key || '';
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
