import { escapeHtml } from './render-helpers.js';

// Shared adapter for the scene info card. The classic and isometric renderers
// still own their project-specific card logic; overlays such as Agent Nursery
// use this small surface so they do not duplicate the DOM wiring.

export function setInfoCard({ label, name, total, stage, fillPercent, detailHtml = '', sparkHtml = '' }) {
  setText('garden-info-label', label);
  setText('garden-info-name', name);
  setText('garden-info-total', total);
  setText('garden-info-stage', stage);
  const fill = document.getElementById('garden-info-fill');
  if (fill) fill.style.width = Math.max(0, Math.min(100, Number(fillPercent || 0))) + '%';
  const detail = document.getElementById('garden-info-detail');
  if (detail) detail.innerHTML = detailHtml || '';
  const spark = document.getElementById('garden-info-spark');
  if (spark) spark.innerHTML = sparkHtml || '';
}

export function infoMetaRow(label, value) {
  return (
    '<div class="pg6-info-meta">' +
    '<span class="pg6-info-meta-k">' + escapeHtml(label) + '</span>' +
    '<span class="pg6-info-meta-v">' + escapeHtml(value) + '</span>' +
    '</div>'
  );
}

export function showInfoCard({ scene, event, anchor } = {}) {
  const card = document.querySelector('.pg6-info');
  if (!card) return;
  if (scene && event && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
    positionInfoCardFromPointer(scene, event);
  } else if (scene && anchor) {
    positionInfoCardFromElement(scene, anchor);
  }
  card.classList.add('is-visible');
}

export function hideInfoCard() {
  const card = document.querySelector('.pg6-info');
  if (card) card.classList.remove('is-visible');
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value || '';
}

function positionInfoCardFromPointer(scene, event) {
  const card = document.querySelector('.pg6-info');
  if (!card || !scene) return;
  const sceneRect = scene.getBoundingClientRect();
  const cardW = card.offsetWidth || 220;
  const cardH = card.offsetHeight || 112;
  const gap = 14;
  const pad = 10;
  let x = event.clientX - sceneRect.left + gap;
  let y = event.clientY - sceneRect.top - cardH / 2;

  if (x + cardW > sceneRect.width - pad) {
    x = event.clientX - sceneRect.left - cardW - gap;
  }
  x = clamp(x, pad, sceneRect.width - cardW - pad);
  y = clamp(y, pad, sceneRect.height - cardH - pad);
  setCardPosition(card, x, y);
}

function positionInfoCardFromElement(scene, anchor) {
  const card = document.querySelector('.pg6-info');
  if (!card || !scene || !anchor) return;
  const sceneRect = scene.getBoundingClientRect();
  const anchorRect = anchor.getBoundingClientRect();
  const cardW = card.offsetWidth || 220;
  const cardH = card.offsetHeight || 112;
  const gap = 14;
  const pad = 10;
  const anchorCenterX = anchorRect.left + anchorRect.width / 2 - sceneRect.left;
  let x = anchorCenterX < sceneRect.width / 2
    ? (anchorRect.right - sceneRect.left) + gap
    : (anchorRect.left - sceneRect.left) - cardW - gap;
  x = clamp(x, pad, sceneRect.width - cardW - pad);

  const anchorTop = anchorRect.top - sceneRect.top;
  const anchorBottom = anchorRect.bottom - sceneRect.top;
  const y = clamp((anchorTop + anchorBottom) / 2 - cardH / 2, pad, sceneRect.height - cardH - pad);
  setCardPosition(card, x, y);
}

function setCardPosition(card, x, y) {
  card.style.setProperty('--info-x', x + 'px');
  card.style.setProperty('--info-y', y + 'px');
  card.style.setProperty('--info-bottom', 'auto');
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
