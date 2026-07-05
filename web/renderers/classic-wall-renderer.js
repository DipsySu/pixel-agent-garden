import { createGardenRenderer } from '../render-garden.js';
import { renderBaseScene } from '../render-svg.js';

export function createClassicWallRenderer(options) {
  const dynamic = createGardenRenderer({
    scene: options.scene,
    spriteRoot: options.spriteRoot,
    isFlowerbedEnabled: options.isFlowerbedEnabled,
  });

  function renderBase(settings) {
    renderBaseScene(options.scene, options.assetRoot, {
      settings,
      flowerbedEnabled: options.isFlowerbedEnabled?.() || false,
    });
  }

  function renderDynamic(groups, summary) {
    dynamic.renderEverything(groups, summary);
  }

  function paint(groups, summary, settings) {
    renderBase(settings);
    renderDynamic(groups, summary);
  }

  return {
    mode: 'classic',
    renderBase,
    renderDynamic,
    paint,
    repaintData: renderDynamic,
    showScanning: dynamic.showScanning,
    showCached: dynamic.showCached,
    selectProjectByKey: dynamic.selectProjectByKey,
    destroy: dynamic.destroy,
  };
}
