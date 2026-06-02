import { fmtLocal } from './render-helpers.js';
import { insightPanelHTML } from './render-insight.js';

const DAYS = 14;
const LIMIT = 10;

export function mountInsightPanel({ hostFooter, initialSummary, onProjectSelect }) {
  let currentSummary = initialSummary || null;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pg6-footer-insight';
  button.setAttribute('aria-label', '打开 Token Insight');
  button.setAttribute('aria-expanded', 'false');
  button.innerHTML = insightSvg() + '<span>Insight</span>';

  const panel = document.createElement('div');
  panel.className = 'pg6-insight-panel';
  panel.id = 'token-insight-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Token Insight');
  panel.hidden = true;
  panel.innerHTML = insightPanelHTML(currentSummary, { days: DAYS, limit: LIMIT, format: fmtLocal });

  button.addEventListener('click', () => togglePanel());
  panel.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const close = target.closest('.pg6-insight-close');
    if (close) {
      togglePanel(false);
      button.focus();
      return;
    }
    const row = target.closest('.pg6-insight-row');
    if (!row) return;
    const key = row.dataset.projectKey;
    if (key && typeof onProjectSelect === 'function') {
      onProjectSelect(key);
      panel.querySelectorAll('.pg6-insight-row').forEach((item) => {
        item.classList.toggle('is-active', item === row);
      });
    }
  });
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      togglePanel(false);
      button.focus();
    }
  });

  hostFooter.appendChild(button);
  hostFooter.parentElement.appendChild(panel);

  function togglePanel(force) {
    const open = typeof force === 'boolean' ? force : panel.hidden;
    panel.hidden = !open;
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    button.classList.toggle('is-active', open);
    if (open) {
      (panel.querySelector('.pg6-insight-row') || panel.querySelector('.pg6-insight-close'))?.focus();
    }
  }

  return {
    update: (summary) => {
      currentSummary = summary || null;
      panel.innerHTML = insightPanelHTML(currentSummary, { days: DAYS, limit: LIMIT, format: fmtLocal });
    }
  };
}

function insightSvg() {
  return (
    '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
    '<path d="M4 17h16M6 14l3-5 4 3 5-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M6 19h12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
    '</svg>'
  );
}
