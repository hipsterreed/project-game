import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

import { buildWorld, updateWorld, ARCH_POSITION, TOWER_POSITION, SPAWN_POSITION } from "./scene.js";
import { Player } from "./player.js";
import { SandSystem } from "./sand.js";
import { Audio } from "./audio.js";
import { FlowerSystem } from "./flowers.js";
import { ResonanceSystem } from "./resonance.js";
import { ToneMapShader } from "./shaders.js";

/* -----------------------------------------------------------
 * Main bootstrap & game loop
 * --------------------------------------------------------- */

const app = document.getElementById("app");
const titleEl = document.getElementById("title");
const beginBtn = document.getElementById("beginBtn");
const hud = document.getElementById("hud");
const promptEl = document.getElementById("prompt");
const loreEl = document.getElementById("lore");
const loreText = document.getElementById("loreText");
const cineEl = document.getElementById("cine");
const cineText = document.getElementById("cineText");
const ending = document.getElementById("ending");
const loading = document.getElementById("loading");
const compass = document.getElementById("compass");
const compassLabel = document.getElementById("compassLabel");

// ---- renderer ----
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

// ---- scene & camera ----
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  62,
  window.innerWidth / window.innerHeight,
  0.05,
  1500,
);
camera.position.set(0, 6, 12);
camera.userData.domElement = renderer.domElement;

// ---- world ----
const world = buildWorld(scene, renderer);

// ---- player ----
const player = new Player(scene, camera, world);
player.spawn(SPAWN_POSITION);

// ---- sand particles ----
const sand = new SandSystem(scene, world);

// ---- audio ----
const audio = new Audio();

// ---- flowers + resonance ----
const flowers = new FlowerSystem(scene, world);
const resonance = new ResonanceSystem({
  scene, world, player, sand, flowers, audio,
  towerPos: TOWER_POSITION,
});

player.onFootstep = (foot, pos, vel, sprintBlend) => {
  audio.playFootstep(0.6 + sprintBlend * 0.4, sprintBlend);

  // only stamp footprints + kick up grains when actually on sand terrain,
  // not when stepping on tower stone / stairs
  const terrainY = world.getTerrainHeight(pos.x, pos.z);
  if (Math.abs(pos.y - terrainY) < 0.6) {
    const angle = Math.atan2(vel.x, vel.z) || 0;
    world.footprintLayer?.stamp(pos.x, pos.z, angle, foot, 0.7 + sprintBlend * 0.2);
    sand.emitFootstep(pos, vel, sprintBlend);
  }

  // tower-proximity vibrant blooms: as the player walks within range
  // of the tower, leave a trail of vibrant blooms at footstep positions.
  // Cap rate via random gating so the trail doesn't carpet the ground.
  const dx = pos.x - TOWER_POSITION.x;
  const dz = pos.z - TOWER_POSITION.z;
  const distToTower = Math.hypot(dx, dz);
  if (distToTower < 60 && Math.random() < 0.35) {
    // offset slightly to either side of the foot for natural placement
    const off = (foot === "L" ? -0.4 : 0.4);
    const sideX = Math.cos(angleSafe(vel)) * off;
    const sideZ = Math.sin(angleSafe(vel)) * off;
    flowers.spawnVibrant(pos.x + sideX, pos.z + sideZ);
  }
};
player.onLand = (impactSpeed) => {
  audio.playLanding(impactSpeed);
};

function angleSafe(vel) {
  // returns the angle perpendicular (right-hand) to motion; falls back to 0
  if (!vel) return 0;
  const a = Math.atan2(vel.x, vel.z);
  return a + Math.PI / 2;
}

// ---- post-processing ----
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.36, // strength
  0.95, // radius
  0.86, // threshold
);
composer.addPass(bloom);

const tonePass = new ShaderPass(ToneMapShader);
composer.addPass(tonePass);

composer.addPass(new OutputPass());

// ---- state machine ----
let mode = "menu"; // "menu" | "intro" | "playing" | "cinematic" | "ending"
let menuTime = 0;
let endTime = 0;

const menuPath = (t) => {
  const r = 14;
  const x = Math.sin(t * 0.06) * r * 0.7;
  const z = 18 + Math.cos(t * 0.05) * 4;
  const y = world.getHeight(x, z) + 3.4 + Math.sin(t * 0.13) * 0.2;
  camera.position.set(x, y, z);
  camera.lookAt(0, 1.4, -40);
};

// Browsers block audio playback until a user gesture, so we can't truly
// start music at page load. Next-best thing: retry on every input event
// until the <audio> element reports as actually playing. Some browsers
// don't treat pointermove as a valid activation, so we keep retrying
// through pointerdown/keydown/touchstart/click as well.
function startMusicOnFirstGesture() {
  const kick = () => {
    audio.start();              // idempotent: starts the synth bed once
    audio._unmuteMusic?.();     // retries play() + unmutes every time
    if (audio.music && !audio.music.paused && !audio.music.muted) {
      window.removeEventListener("pointerdown", kick);
      window.removeEventListener("pointermove", kick);
      window.removeEventListener("keydown", kick);
      window.removeEventListener("touchstart", kick);
      window.removeEventListener("click", kick, true);
    }
  };
  window.addEventListener("pointerdown", kick);
  window.addEventListener("pointermove", kick);
  window.addEventListener("keydown", kick);
  window.addEventListener("touchstart", kick);
  // capture-phase click so we fire before the Begin button's handler
  window.addEventListener("click", kick, true);
}
startMusicOnFirstGesture();

beginBtn.addEventListener("click", () => {
  if (mode !== "menu") return;
  mode = "intro";
  titleEl.classList.add("hidden");
  hud.classList.add("visible");

  audio.start(); // safe to call again — guarded by `started` flag
  renderer.domElement.requestPointerLock?.();
  player.enableControl();

  setTimeout(() => {
    mode = "playing";
    showPrompt("walk forward");
    setTimeout(() => hidePrompt(), 4500);
  }, 1400);
});

function showPrompt(text) {
  promptEl.textContent = text;
  promptEl.classList.add("show");
}
function hidePrompt() {
  promptEl.classList.remove("show");
}

function showLore(text) {
  loreText.textContent = text;
  loreEl.classList.add("show");
}
function hideLore() {
  loreEl.classList.remove("show");
}

function showCine(text) {
  cineText.textContent = "";
  cineEl.classList.add("show");
  // typewriter
  const total = text.length;
  let i = 0;
  if (cineText._typewriterTimer) clearInterval(cineText._typewriterTimer);
  cineText._typewriterTimer = setInterval(() => {
    i += 1;
    cineText.textContent = text.slice(0, i);
    if (i >= total) {
      clearInterval(cineText._typewriterTimer);
      cineText._typewriterTimer = null;
    }
  }, 50);
}
function hideCine() {
  cineEl.classList.remove("show");
}

// ---- main loop ----
const clock = new THREE.Clock();
let lastTime = 0;

function animate() {
  const t = clock.getElapsedTime();
  const dt = Math.min(0.05, t - lastTime);
  lastTime = t;

  updateWorld(world, dt, t);
  tonePass.uniforms.uTime.value = t;

  if (mode === "menu") {
    menuTime += dt;
    menuPath(menuTime);
  } else if (mode === "intro") {
    player.update(dt, t);
  } else if (mode === "playing") {
    player.update(dt, t);
    handleLampProximity();
    handleTowerCinematicTrigger();
    handleTopProximity();
    handlePuzzleProximity();
  } else if (mode === "cinematic") {
    // player still updates (so cloak/ribbons keep alive) but input
    // is locked because canControl was disabled when entering this mode
    player.update(dt, t);
    updateCinematicCamera(dt, t);
  } else if (mode === "ending") {
    endTime += dt;
    player.update(dt, t);
    const o = Math.min(1, endTime / 8);
    camera.position.y += dt * 0.3;
    camera.fov = THREE.MathUtils.lerp(camera.fov, 50, dt * 0.4);
    camera.updateProjectionMatrix();
  }

  // sun shadow camera follows the player (keeps shadows crisp around them)
  if (mode !== "menu") {
    const sd = world.sunDir;
    world.sun.position.set(
      player.position.x + sd.x * 120,
      player.position.y + sd.y * 120,
      player.position.z + sd.z * 120,
    );
    world.sun.target.position.copy(player.position);
    world.sun.target.updateMatrixWorld();
  }

  // wind for sand & audio
  const wind = computeGlobalWind(t, player.velocity);
  sand.update(dt, t, wind, camera, player);
  flowers.update(dt);
  if (mode === "playing" || mode === "ending" || mode === "cinematic") {
    resonance.update(dt, t);
  }
  audio.update(dt, t, {
    speed: player.currentSpeed,
    sliding: player.sliding,
    archProximity: getArchProximity(),
  });

  if (mode === "playing") updateCompass();

  composer.render();
  requestAnimationFrame(animate);
}

const _windTmp = new THREE.Vector3();
function computeGlobalWind(t, playerVel) {
  const base = -1.4 + Math.sin(t * 0.15) * 0.5;
  _windTmp.set(
    base + Math.sin(t * 0.4) * 0.3,
    0.05 + Math.sin(t * 0.31) * 0.04,
    Math.sin(t * 0.27) * 0.3,
  );
  _windTmp.addScaledVector(playerVel, -0.3);
  return _windTmp;
}

function getArchProximity() {
  const d = player.distanceToArch();
  return THREE.MathUtils.clamp(1 - d / 220, 0, 1);
}

function updateCompass() {
  const toArch = new THREE.Vector3().subVectors(world.archTrigger, player.position);
  toArch.y = 0;
  const cam = new THREE.Vector3().subVectors(player.position, camera.position);
  cam.y = 0; cam.normalize();
  const camAng = Math.atan2(cam.x, cam.z);
  const archAng = Math.atan2(toArch.x, toArch.z);
  let dy = archAng - camAng;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  const aligned = Math.abs(dy) < 0.18;
  const dist = player.distanceToArch();
  const closeFade = THREE.MathUtils.clamp(1 - (1 - dist / 220), 0, 1);
  compass.style.opacity = `${(aligned ? 0.18 : 0.55) * (0.4 + 0.6 * closeFade)}`;
  if (dist < 12) {
    compassLabel.textContent = "the tower";
  }
}

// ---- lamp lore (near spawn) ----
const LAMP_LORE = [
  "they say the tower listens.",
  "if your steps reach the top,",
  "what aches inside you will be answered.",
];
let lampLoreShown = false;
let lampLoreLeft = false;
function handleLampProximity() {
  if (!world.lamp) return;
  const dx = player.position.x - world.lamp.position.x;
  const dz = player.position.z - world.lamp.position.z;
  const d = Math.hypot(dx, dz);

  if (d < 3.5 && !lampLoreShown) {
    lampLoreShown = true;
    // sequence the three lines
    showLore(LAMP_LORE[0]);
    setTimeout(() => showLore(LAMP_LORE.slice(0, 2).join("  ")), 2400);
    setTimeout(() => showLore(LAMP_LORE.join("  ")), 5200);
    setTimeout(() => hideLore(), 11500);
  }
  if (d > 9 && lampLoreShown && !lampLoreLeft) {
    lampLoreLeft = true;
    hideLore();
  }
  if (d > 16) {
    // allow re-trigger if the player wanders back later
    lampLoreShown = false;
    lampLoreLeft = false;
  }
}

// ---- tower puzzle: 3 glyph plates at the base ----
// Stairs have a missing middle section. Press E near each plate to
// light it; once all three are lit, the upper steps phase in.
let puzzleNearIndex = -1;
let puzzleSolved = false;

function handlePuzzleProximity() {
  if (puzzleSolved) return;
  const plates = world.towerInfo?.plates;
  if (!plates) return;

  let closest = -1;
  let closestD = 2.6; // activation radius
  for (let i = 0; i < plates.length; i++) {
    const p = plates[i];
    if (p.lit) continue;
    const dx = player.position.x - (TOWER_POSITION.x + p.x);
    const dz = player.position.z - (TOWER_POSITION.z + p.z);
    const d = Math.hypot(dx, dz);
    if (d < closestD) { closestD = d; closest = i; }
  }

  if (closest !== puzzleNearIndex) {
    puzzleNearIndex = closest;
    if (closest >= 0) {
      const remaining = plates.filter((p) => !p.lit).length;
      showPrompt(remaining > 1 ? "[E] activate" : "[E] activate — final glyph");
    } else {
      hidePrompt();
    }
  }
}

window.addEventListener("keydown", (e) => {
  if (e.code !== "KeyE") return;
  if (mode !== "playing") return;
  if (puzzleSolved || puzzleNearIndex < 0) return;
  const plates = world.towerInfo?.plates;
  if (!plates) return;
  const plate = plates[puzzleNearIndex];
  if (!plate || plate.lit) return;

  plate.lit = true;
  plate.activatedAt = clock.getElapsedTime();
  plate.glyphMat.color.setHex(0x9be0e8);
  plate.light.intensity = 2.6;
  audio.playFootstep?.(0.7, 0.4); // soft chime placeholder
  puzzleNearIndex = -1;
  hidePrompt();

  if (plates.every((p) => p.lit)) {
    puzzleSolved = true;
    world.unlockTowerStairs();
    showPrompt("the stairs awaken");
    setTimeout(hidePrompt, 4000);
  } else {
    const left = plates.filter((p) => !p.lit).length;
    showPrompt(`${left} glyph${left > 1 ? "s" : ""} remain`);
    setTimeout(hidePrompt, 2200);
  }
});

// ---- tower approach cinematic ----
let cinematicArmed = true;
let cineStart = 0;
let cineFrom = new THREE.Vector3();
let cineFromLook = new THREE.Vector3();
let cineDuration = 6.5;

function handleTowerCinematicTrigger() {
  const dx = player.position.x - TOWER_POSITION.x;
  const dz = player.position.z - TOWER_POSITION.z;
  const d = Math.hypot(dx, dz);
  if (cinematicArmed && d < 18) {
    enterCinematic();
  }
  // re-arm if player walks far away
  if (d > 60) cinematicArmed = true;
}

function enterCinematic() {
  cinematicArmed = false;
  mode = "cinematic";
  cineStart = clock.getElapsedTime();
  cineFrom.copy(camera.position);
  // remember a current look-target near the player
  cineFromLook.copy(player.position).y += 1.5;
  // freeze player input
  player.canControl = false;
  showCine("the top speaks to you...");
}

function exitCinematic() {
  hideCine();
  mode = "playing";
  player.canControl = true;
  // request pointer lock again so mouse-look resumes
  renderer.domElement.requestPointerLock?.();
}

function updateCinematicCamera(dt, t) {
  const elapsed = t - cineStart;
  const u = THREE.MathUtils.clamp(elapsed / cineDuration, 0, 1);
  // ease in/out
  const eased = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;

  // camera path: start from player follow position, move to a slow
  // tilt up the tower from a mid-distance vantage.
  const towerY = world.archTrigger.y;
  const totalH = world.towerInfo?.totalHeight || 80;

  // anchor: a viewing point ~28m south of the tower at chest-cam height
  const ax = TOWER_POSITION.x;
  const az = TOWER_POSITION.z + 28;
  const ay = towerY + 8 + eased * (totalH * 0.35);

  // blend from cineFrom -> anchor over the first 25% then hold
  const blend = THREE.MathUtils.smoothstep(elapsed, 0, cineDuration * 0.25);
  camera.position.x = THREE.MathUtils.lerp(cineFrom.x, ax, blend);
  camera.position.y = THREE.MathUtils.lerp(cineFrom.y, ay, blend);
  camera.position.z = THREE.MathUtils.lerp(cineFrom.z, az, blend);

  // look target: pan from base to top of the tower
  const lookY = towerY + eased * (totalH + 4);
  camera.lookAt(TOWER_POSITION.x, lookY, TOWER_POSITION.z);

  if (u >= 1) {
    // a beat after the pan completes, ease back to gameplay
    if (elapsed > cineDuration + 1.6) exitCinematic();
  }
}

// ---- top-of-tower trigger -> ending ----
let topReached = false;
function handleTopProximity() {
  if (topReached) return;
  const dx = player.position.x - TOWER_POSITION.x;
  const dz = player.position.z - TOWER_POSITION.z;
  const radial = Math.hypot(dx, dz);
  const towerY = world.archTrigger.y;
  const totalH = world.towerInfo?.totalHeight || 80;
  if (player.position.y > towerY + totalH * 0.85 && radial < 6) {
    topReached = true;
    enterEnding();
  }
}

function enterEnding() {
  mode = "ending";
  endTime = 0;
  audio.fadeOut(8);
  hud.classList.remove("visible");
  ending.classList.add("show");
  document.exitPointerLock?.();
}

// ---- resize ----
window.addEventListener("resize", () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
});

// ---- kick off ----
loading.classList.add("gone");
animate();
