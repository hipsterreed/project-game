import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createScene } from './scene.js';
import { buildWorld } from './world.js';
import { Player } from './player.js';
import { AdaptiveAudio } from './audio.js';
import { ParticleSystem } from './particles.js';
import { BirdFlock } from './birds.js';

const canvas = document.getElementById('canvas');
const menu = document.getElementById('menu');
const startBtn = document.getElementById('start');
const loading = document.getElementById('loading');
const cursor = document.getElementById('cursor');
const closing = document.getElementById('closing');
const closingWord = document.getElementById('closingWord');
const pauseEl = document.getElementById('pause');

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const { scene, sun, sunMesh } = createScene();
const camera = new THREE.PerspectiveCamera(
  62,
  window.innerWidth / window.innerHeight,
  0.1,
  1500
);
camera.position.set(0, 1.65, 60);

// Post-processing: render -> bloom -> output (gamma-correct + tonemap)
const composer = new EffectComposer(renderer);
composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
composer.setSize(window.innerWidth, window.innerHeight);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.32,  // strength
  0.7,   // radius
  0.92   // threshold (only the very brightest pixels bloom)
);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const world = buildWorld(scene);
const particles = new ParticleSystem(scene);
const birds = new BirdFlock(scene);
const player = new Player(camera, renderer.domElement, world);
const audio = new AdaptiveAudio();
player.onStep = (intensity) => audio.triggerFootstep(intensity);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

window.addEventListener('mousemove', (e) => {
  cursor.style.left = e.clientX + 'px';
  cursor.style.top = e.clientY + 'px';
});

setTimeout(() => loading.classList.add('hide'), 600);

let started = false;
let arrived = false;
let timeSinceStart = 0;

startBtn.addEventListener('click', () => {
  if (started) return;
  started = true;
  // Lock pointer SYNCHRONOUSLY in the click handler so the browser
  // accepts the user gesture. Audio init is fired off in parallel.
  document.body.classList.add('in-game');
  player.lock();
  audio.init();
  setTimeout(() => document.body.classList.add('played-a-bit'), 8000);
});

// Click the canvas to (re)lock if user escapes
renderer.domElement.addEventListener('click', () => {
  if (started && !document.pointerLockElement) player.lock();
});

// Pause only when user has been playing for a moment AND explicitly releases.
// This avoids the pause flashing on if pointer lock fails to engage initially.
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  if (started && !locked && !arrived && timeSinceStart > 1.5) {
    pauseEl.classList.add('show');
    audio.setPaused(true);
  } else {
    pauseEl.classList.remove('show');
    audio.setPaused(false);
  }
});

pauseEl.addEventListener('click', () => {
  player.lock();
});

const goal = new THREE.Vector3(0, 0, -60);
const startPos = new THREE.Vector3(0, 1.65, 60);
const totalDist = startPos.distanceTo(goal);

const clock = new THREE.Clock();

function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  if (started) timeSinceStart += dt;

  player.update(dt, started && !pauseEl.classList.contains('show'));
  world.update(t, dt);
  particles.update(t, dt, camera.position);
  birds.update(t, dt);

  // Compute progress toward the tree (0 = start, 1 = arrived)
  const horizontal = new THREE.Vector3(camera.position.x, 0, camera.position.z);
  const distToGoal = horizontal.distanceTo(new THREE.Vector3(goal.x, 0, goal.z));
  const progress = Math.max(0, Math.min(1, 1 - distToGoal / totalDist));

  // Compute speed scalar 0..1 from player velocity
  const speed = player.getSpeedNormalized();

  try { audio.update(dt, speed, progress); } catch (e) { console.warn('audio:', e); }

  // When near the tree -> arrival sequence
  if (!arrived && distToGoal < 6 && started && timeSinceStart > 4) {
    arrived = true;
    triggerArrival();
  }

  // Subtle exposure breathing - very gentle "breath" feel
  renderer.toneMappingExposure = 0.85 + Math.sin(t * 0.3) * 0.03;

  // Bloom intensifies on arrival for emotional payoff
  if (arrived) {
    bloom.strength = THREE.MathUtils.lerp(bloom.strength, 0.9, 0.02);
  } else {
    bloom.strength = THREE.MathUtils.lerp(bloom.strength, 0.32 + progress * 0.25, 0.04);
  }

  composer.render();
  requestAnimationFrame(animate);
}

function triggerArrival() {
  document.body.classList.add('cinematic');
  audio.triggerSwell();
  particles.burstAt(goal.x, 1.5, goal.z);

  setTimeout(() => {
    closingWord.textContent = 'home.';
    closing.classList.add('show');
  }, 2400);

  setTimeout(() => {
    closing.classList.remove('show');
    document.body.classList.remove('cinematic');
    arrived = false;
  }, 12000);
}

animate();

// Debug exposure (harmless)
if (typeof window !== 'undefined') {
  window.__drift = { camera, scene, renderer, audio, player, world, composer };
}
