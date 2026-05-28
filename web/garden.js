import { loadSettings, loadSummary, subscribeGardenUpdates, logGardenError } from './data-source.js';
import { groupSprites } from './render-helpers.js';
import { createGardenRenderer } from './render-garden.js';
import { renderBaseScene } from './render-svg.js';

const scene = document.getElementById('pg6-scene');
const assetRoot = window.__TAURI__ ? './assets' : '../assets';
const spriteRoot = assetRoot + '/sprites/';
const manifestUrl = spriteRoot + 'ivy_courtyard_manifest.json';
const dataUrl = './data/garden-summary.json';

Promise.all([
  fetch(manifestUrl).then((response) => response.json()),
  loadSummary({ dataUrl }),
  loadSettings()
]).then(([manifest, summary, settings]) => {
  const groups = groupSprites(manifest.sprites || []);
  const renderer = createGardenRenderer({ scene, spriteRoot, settings });
  renderBaseScene(scene, assetRoot, { settings });
  renderer.renderEverything(groups, summary);
  if (settings.data.auto_rescan) {
    subscribeGardenUpdates((summary) => renderer.renderEverything(groups, summary));
  }
}).catch((err) => logGardenError('garden bootstrap failed', err));
