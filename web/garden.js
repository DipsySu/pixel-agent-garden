import { loadSummary, subscribeGardenUpdates, logGardenError } from './data-source.js';
import { groupSprites } from './render-helpers.js';
import { createGardenRenderer } from './render-garden.js';
import { renderBaseScene } from './render-svg.js';

const scene = document.getElementById('pg6-scene');
const assetRoot = window.__TAURI__ ? './assets' : '../assets';
const spriteRoot = assetRoot + '/sprites/';
const manifestUrl = spriteRoot + 'ivy_courtyard_manifest.json';
const dataUrl = './data/garden-summary.json';

renderBaseScene(scene, assetRoot);

Promise.all([
  fetch(manifestUrl).then((response) => response.json()),
  loadSummary({ dataUrl })
]).then(([manifest, summary]) => {
  const groups = groupSprites(manifest.sprites || []);
  const renderer = createGardenRenderer({ scene, spriteRoot });
  renderer.renderEverything(groups, summary);
  subscribeGardenUpdates((summary) => renderer.renderEverything(groups, summary));
}).catch((err) => logGardenError('garden bootstrap failed', err));
