import {
  loadSettings,
  loadSummary,
  subscribeGardenScanning,
  subscribeGardenUpdates,
  subscribeGardenErrors,
  logGardenError,
  openInTerminal
} from './data-source.js';
import { mountErrorToast } from './error-toast.js';
import { mountInsightPanel } from './insight-panel.js';
import { mountSettingsPanel } from './settings-panel.js';
import { groupSprites } from './render-helpers.js';
import { createGardenRenderer } from './render-garden.js';
import { renderBaseScene } from './render-svg.js';

const scene = document.getElementById('pg6-scene');
const assetRoot = window.__TAURI__ ? './assets' : '../assets';
const spriteRoot = assetRoot + '/sprites/';
const manifestUrl = spriteRoot + 'ivy_courtyard_manifest.json';
const dataUrl = './data/garden-summary.json';

// Wire the toast layer + backend error stream before kicking off any IO,
// so an early failure (manifest fetch, settings invoke) still surfaces.
mountErrorToast();
subscribeGardenErrors();

Promise.all([
  fetch(manifestUrl).then((response) => response.json()),
  loadSummary({ dataUrl }),
  loadSettings()
]).then(([manifest, summary, settings]) => {
  const groups = groupSprites(manifest.sprites || []);
  // Hold the latest summary + settings so the watcher-driven re-render and the
  // settings panel both pick up whichever changed last.
  let currentSettings = settings;
  let lastSummary = summary;
  const renderer = createGardenRenderer({ scene, spriteRoot });
  renderBaseScene(scene, assetRoot, { settings: currentSettings });
  renderer.renderEverything(groups, lastSummary);

  // Settings panel — drives both live-apply (scene re-paint) and persistence.
  // Footer is the host; the panel inserts itself after the footer in the same
  // parent (the frame), so it sits flush with footer content.
  const footer = document.querySelector('.pg6-footer');
  let insightPanel = null;
  if (footer) {
    insightPanel = mountInsightPanel({
      hostFooter: footer,
      initialSummary: lastSummary,
      onProjectSelect: (projectKey) => renderer.selectProjectByKey(projectKey),
      onOpenTerminal: (path) => openInTerminal(path)
    });
    mountSettingsPanel({
      hostFooter: footer,
      initial: currentSettings,
      onChange: (next) => {
        currentSettings = next;
        // renderBaseScene replaces scene.innerHTML and updates scene.dataset;
        // renderEverything then rebuilds sprites from that dataset.
        renderBaseScene(scene, assetRoot, { settings: currentSettings });
        renderer.renderEverything(groups, lastSummary);
        insightPanel?.update(lastSummary);
      }
    });
  }

  // Watcher updates: always subscribe (cheap), gate re-render on auto_rescan
  // so the user can toggle it from the panel without restart ceremony.
  subscribeGardenScanning(() => {
    renderer.showScanning();
  });
  subscribeGardenUpdates((summary) => {
    lastSummary = summary;
    insightPanel?.update(lastSummary);
    if (currentSettings.data.auto_rescan) {
      renderer.renderEverything(groups, lastSummary);
    } else {
      renderer.showCached(lastSummary);
    }
  });
}).catch((err) => {
  // Bootstrap failed (manifest fetch error, etc.). Best-effort: still paint
  // the base scene with default settings so the page doesn't sit blank with
  // dash placeholders. Sprites won't render — but at least there's a sky.
  logGardenError('garden bootstrap failed', err);
  try {
    renderBaseScene(scene, assetRoot, { settings: null });
  } catch (renderErr) {
    logGardenError('fallback base scene render failed', renderErr);
  }
});
