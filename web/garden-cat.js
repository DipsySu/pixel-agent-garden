import {
  catFrameBackground, catTransform, catWalkKeyframes, chooseCatRest,
  nextCatNode, planCatLeg, sampleCatLeg,
} from './cat-motion.js';

let nextId = 0;

// One persistent resident per renderer. JS chooses finite actions; CSS owns
// travel, gait, breathing and flips. No frame loop, layout polling or timers.
export function createGardenCat(scene, { sprite, habitat, project, width = 58, random = Math.random }) {
  const document = scene.ownerDocument;
  const window = document.defaultView;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const cat = document.createElement('span');
  cat.className = 'pg6-garden-cat';
  cat.setAttribute('data-scene-persistent', '');
  cat.setAttribute('role', 'img');
  cat.setAttribute('aria-label', '庭院猫');
  cat.style.setProperty('--cat-sprite', `url("${sprite}")`);
  cat.style.setProperty('--cat-width', `${width / 680 * 100}%`);
  cat.innerHTML = '<span class="pg6-cat-shadow"></span><span class="pg6-cat-pose"><span class="pg6-cat-sprite"></span></span>';
  const spriteElement = cat.querySelector('.pg6-cat-sprite');
  const style = document.createElement('style');
  style.setAttribute('data-scene-persistent', '');
  const prefix = `pg6-cat-${++nextId}`;
  scene.append(style, cat);

  let node = habitat.home;
  let previous = -1;
  let destination = null;
  let point = { ...habitat.nodes[node] };
  let facing = 'right';
  let phase = null;
  let mode = null;
  let serial = 0;
  let destroyed = false;

  function place() {
    const screen = project(point);
    cat.style.transform = catTransform(screen);
    cat.style.zIndex = String(Math.round(screen.z));
  }

  function showFrame(column = 0, row = facing === 'right' ? 0 : 1) {
    spriteElement.style.backgroundPosition = catFrameBackground(column, row);
  }

  function play(action, duration, { leg, sit = false } = {}) {
    const name = `${prefix}-${serial++ % 2}`;
    const walk = leg ? catWalkKeyframes(leg) : null;
    const still = `transform: ${catTransform(project(point))};`;
    style.textContent = `@keyframes ${name} { ${walk?.position || `from { ${still} } to { ${still} }`} }`
      + (walk ? `\n@keyframes ${name}-feet { ${walk.frames} }` : '');
    cat.dataset.action = action;
    cat.dataset.rest = sit ? 'sit' : 'stand';
    cat.style.setProperty('--cat-action-duration', `${duration}ms`);
    cat.style.animation = `${name} ${duration}ms linear both`;
    spriteElement.style.animation = walk ? `${name}-feet ${duration}ms step-end both` : '';
    phase = { action, name, leg };
    showFrame(sit ? 6 : 0, sit ? 2 : facing === 'right' ? 0 : 1);
  }

  function rest(initial = false) {
    const choice = chooseCatRest(random);
    play('rest', initial ? 1200 : choice.duration, { sit: !initial && choice.sit });
  }

  function prepareWalk() {
    if (destination === null) destination = nextCatNode(habitat, node, previous, random);
    const leg = planCatLeg(point, habitat.nodes[destination], project, {
      facing, width, bend: (random() - 0.5) * 0.12,
    });
    if (leg.facing !== facing) {
      cat.style.setProperty('--cat-turn-angle', facing === 'right' ? '360deg' : '-360deg');
      cat.style.setProperty('--cat-from-row', facing === 'right' ? '0%' : '50%');
      cat.style.setProperty('--cat-to-row', leg.facing === 'right' ? '0%' : '50%');
      play('flip', 820);
      phase.nextLeg = leg;
    } else {
      play('walk', leg.duration, { leg });
    }
  }

  function ended(event) {
    if (destroyed || mode !== 'full' || event.target !== cat || event.animationName !== phase?.name) return;
    if (!cat.isConnected) { destroy(); return; }
    if (phase.action === 'walk') {
      point = { ...habitat.nodes[destination] };
      previous = node;
      node = destination;
      destination = null;
      place();
      play('land', 180);
    } else if (phase.action === 'flip') {
      facing = phase.nextLeg.facing;
      play('land', 180);
    } else if (phase.action === 'land') {
      if (destination !== null) prepareWalk();
      else rest();
    } else {
      prepareWalk();
    }
  }

  function snapshot() {
    if (phase?.action !== 'walk') return;
    const animation = cat.getAnimations().find((item) => item.animationName === phase.name);
    const time = Number(animation?.currentTime || 0) / phase.leg.duration;
    point = sampleCatLeg(phase.leg, time).point;
  }

  function updateMotion() {
    if (destroyed) return;
    const setting = scene.dataset.motion || 'system';
    const next = setting === 'off' || reduced.matches ? 'off' : setting === 'reduced' ? 'reduced' : 'full';
    if (mode === next) return;
    snapshot();
    mode = next;
    cat.dataset.catKind = next;
    cat.style.animation = 'none';
    spriteElement.style.animation = '';
    phase = null;
    place();
    cat.dataset.action = 'rest';
    cat.dataset.rest = 'stand';
    showFrame();
    if (mode === 'full') rest(true);
  }

  function visibility() {
    cat.dataset.paused = String(document.hidden);
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    cat.removeEventListener('animationend', ended);
    reduced.removeEventListener('change', updateMotion);
    document.removeEventListener('visibilitychange', visibility);
    style.remove();
    cat.remove();
  }

  cat.addEventListener('animationend', ended);
  reduced.addEventListener('change', updateMotion);
  document.addEventListener('visibilitychange', visibility);
  visibility();
  updateMotion();
  return { updateMotion, destroy };
}
