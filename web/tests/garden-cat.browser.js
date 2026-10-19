import { createGardenCat } from '../garden-cat.js';
import { WALL_CAT_HABITAT } from '../cat-motion.js';
import { replaceSceneBase } from '../render-helpers.js';

const results = document.getElementById('results');
const scene = document.getElementById('fixture');
const lines = [];
const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
const check = (name, condition) => {
  if (!condition) throw new Error(name);
  lines.push(`PASS ${name}`);
};
let controller;

try {
  const html = new DOMParser().parseFromString(await (await fetch('./index.html')).text(), 'text/html');
  document.head.append(html.querySelector('style').cloneNode(true));
  document.body.style.cssText = 'display:block;overflow:auto;background:#fafafa;color:#222;padding:24px';
  scene.style.cssText = 'position:relative;width:680px;height:440px;background:#788c58;overflow:hidden';
  const sheet = new Image();
  sheet.src = '../assets/sprites/garden_cat/garden_cat.png';
  await sheet.decode();
  check('real 10x3 sprite sheet loads', sheet.naturalWidth / 10 === sheet.naturalHeight / 3);

  controller = createGardenCat(scene, {
    sprite: sheet.src, habitat: WALL_CAT_HABITAT, random: () => 0.5,
    project: ({ x, y }) => ({ x: x * 6.8, y: y * 4.4, scale: 1, z: 64 }),
  });
  const cat = scene.querySelector('.pg6-garden-cat');
  const sprite = cat.querySelector('.pg6-cat-sprite');
  const pose = cat.querySelector('.pg6-cat-pose');
  const position = () => pose.getBoundingClientRect();
  const finish = async () => {
    const current = cat.getAnimations()[0];
    await new Promise((resolve) => {
      const ended = (event) => {
        if (event.target !== cat || event.animationName !== current.animationName) return;
        cat.removeEventListener('animationend', ended);
        // Freeze the newly-created phase immediately; a loaded desktop may
        // otherwise skip the short landing before the next test assertion.
        cat.getAnimations({ subtree: true }).forEach((animation) => animation.pause());
        resolve();
      };
      cat.addEventListener('animationend', ended);
      current.finish();
    });
    await frame();
  };
  cat.getAnimations({ subtree: true }).forEach((animation) => animation.pause());
  await frame();
  check('one resident starts with a CSS action clock', cat.getAnimations().length === 1);
  scene.classList.add('pg6-firstrun');
  check('first-run reveal has a separate pose clock', pose.getAnimations().length === 1 && cat.getAnimations().length === 1);
  scene.classList.remove('pg6-firstrun');
  controller.updateMotion();
  check('data repaints preserve the cat element', scene.querySelector('.pg6-garden-cat') === cat);
  await finish();
  check('first walk starts without an unnecessary turn', cat.dataset.action === 'walk');
  const walk = cat.getAnimations()[0];
  const duration = walk.effect.getTiming().duration;
  walk.pause();
  walk.currentTime = duration * 0.35;
  await frame();
  const before = position();
  walk.currentTime = duration * 0.65;
  await frame();
  check('CSS translates along the ground without a JS frame loop', Math.abs(position().x - before.x) > 5);
  const midway = position();
  replaceSceneBase(scene, '<svg class="test-base"></svg>');
  controller.updateMotion();
  check('base scene repaints preserve the live CSS clock and anchor', cat.getAnimations()[0] === walk && Math.abs(position().x - midway.x) < 0.1);
  scene.querySelector('.test-base').remove();
  scene.dataset.motion = 'off';
  controller.updateMotion();
  await frame();
  check('turning motion off freezes at the current anchor', Math.abs(position().x - midway.x) < 0.1);
  check('off leaves no active CSS animations', cat.getAnimations({ subtree: true }).length === 0);
  scene.dataset.motion = 'reduced';
  controller.updateMotion();
  await frame();
  check('reduced breathes in place without travelling', cat.getAnimations().length === 0 && sprite.getAnimations().length === 1);
  scene.dataset.motion = 'system';
  controller.updateMotion();
  await frame();
  check('resuming does not teleport home', Math.abs(position().x - midway.x) < 0.1);

  // Finish finite CSS phases until the route reaches its dead end and turns.
  for (let i = 0; i < 24 && cat.dataset.action !== 'flip'; i++) await finish();
  check('a reversal uses a somersault phase', cat.dataset.action === 'flip');
  const flip = sprite.getAnimations().find((animation) => animation.animationName === 'pg6-cat-flip');
  const turnFrames = sprite.getAnimations().find((animation) => animation.animationName === 'pg6-cat-turn-frames');
  const frameEasing = turnFrames.effect.getKeyframes()[0].easing;
  check('turn frames are discrete while rotation is smooth', ['step-end', 'steps(1)', 'steps(1, end)'].includes(frameEasing) && flip.effect.getKeyframes()[0].easing === 'linear');
  for (const animation of cat.getAnimations({ subtree: true })) {
    animation.pause();
    animation.currentTime = 820 * 0.53;
  }
  await frame();
  check('flip lifts and rotates the sprite', getComputedStyle(sprite).transform !== 'none' && sprite.getBoundingClientRect().top < pose.getBoundingClientRect().top);
  check('contact shadow recedes at the apex', Number(getComputedStyle(cat.querySelector('.pg6-cat-shadow')).opacity) < 0.6);
  check('phase changes reuse one bounded stylesheet', scene.querySelectorAll('style').length === 1 && scene.querySelector('style').textContent.length < 25000);
  await finish();
  check('turn finishes on a planted landing beat', cat.dataset.action === 'land');
  await finish();
  check('walking resumes after landing', cat.dataset.action === 'walk');

  const originalHidden = Object.getOwnPropertyDescriptor(document, 'hidden');
  Object.defineProperty(document, 'hidden', { configurable: true, value: true });
  document.dispatchEvent(new Event('visibilitychange'));
  check('hidden windows pause CSS clocks and poses', getComputedStyle(cat).animationPlayState === 'paused' && getComputedStyle(sprite).animationPlayState === 'paused');
  if (originalHidden) Object.defineProperty(document, 'hidden', originalHidden);
  else delete document.hidden;
  document.dispatchEvent(new Event('visibilitychange'));
  controller.destroy();
  controller.updateMotion();
  check('renderer teardown removes the cat and generated stylesheet', !scene.children.length);
  results.textContent = `${lines.join('\n')}\n\n${lines.length} checks passed`;
  results.dataset.result = 'pass';
} catch (error) {
  results.textContent = `${lines.join('\n')}\nFAIL ${error.message}`;
  results.dataset.result = 'fail';
} finally {
  controller?.destroy();
  scene.hidden = true;
}
