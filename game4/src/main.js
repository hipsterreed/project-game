import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

import { buildWorld, updateWorld, SHRINE_POSITION, SPAWN_POSITION, CLIFF_EDGE } from "./scene.js";
import { Player } from "./player.js";
import { SandSystem } from "./sand.js";
import { Audio } from "./audio.js";
import { FlowerSystem } from "./flowers.js";
import { ResonanceSystem } from "./resonance.js";
import { ToneMapShader } from "./shaders.js";

/* -----------------------------------------------------------
 * Act One — The Quiet Cliffs
 *   States:  awakening → exploring → restoring → ascending → finale
 *   No HUD, no compass, no lore prose. The world tells the story.
 * --------------------------------------------------------- */

const app = document.getElementById("app");
const titleEl = document.getElementById("title");      // legacy — kept hidden
const beginBtn = document.getElementById("beginBtn");  // legacy — auto-clicked away
const hud = document.getElementById("hud");
const promptEl = document.getElementById("prompt");
const cineEl = document.getElementById("cine");
const cineText = document.getElementById("cineText");
const ending = document.getElementById("ending");
const loading = document.getElementById("loading");
const compass = document.getElementById("compass");

// hide the HUD legacy bits — the cliffs demo is silent
if (compass) compass.style.display = "none";

// ---- renderer ----
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

// ---- scene & camera ----
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  62,
  window.innerWidth / window.innerHeight,
  0.05,
  2000,
);
camera.position.set(0, 6, 12);
camera.userData.domElement = renderer.domElement;

// ---- world ----
const world = buildWorld(scene, renderer);

// ---- player ----
const player = new Player(scene, camera, world);
// place player next to the shrine, facing toward the cliff edge
const spawn = new THREE.Vector3(SPAWN_POSITION.x, 0, SPAWN_POSITION.z);
spawn.y = world.getTerrainHeight(spawn.x, spawn.z);
player.spawn(spawn);

// ---- sand particles (footstep dust + ambient drift = "wind made visible") ----
const sand = new SandSystem(scene, world);

// ---- audio ----
const audio = new Audio();

// ---- flowers + resonance ----
const flowers = new FlowerSystem(scene, world);
const resonance = new ResonanceSystem({
  scene, world, player, sand, flowers, audio,
  // pass shrine pos as the legacy "towerPos" — used by resonance's
  // particle stream direction math; cliffs aim motes upward toward
  // The Last Light when the player walks past, which reads great.
  towerPos: new THREE.Vector3(SHRINE_POSITION.x, 80, SHRINE_POSITION.z - 30),
});

// ---- footsteps: dust on dirt patches, tiny chance of bloom near shrine ----
player.onFootstep = (foot, pos, vel, sprintBlend) => {
  if (mode === "awakening") return;            // silent until standing
  audio.playFootstep(0.6 + sprintBlend * 0.4, sprintBlend);

  const terrainY = world.getTerrainHeight(pos.x, pos.z);
  if (Math.abs(pos.y - terrainY) < 0.6) {
    const angle = Math.atan2(vel.x, vel.z) || 0;
    world.footprintLayer?.stamp(pos.x, pos.z, angle, foot, 0.6 + sprintBlend * 0.2);
    sand.emitFootstep(pos, vel, sprintBlend);
  }

  // glowing flowers on every step within the shrine plaza after restoration
  if (world.shrine?.isActive() && Math.hypot(pos.x, pos.z) < 28 && Math.random() < 0.35) {
    const off = (foot === "L" ? -0.4 : 0.4);
    const ang = Math.atan2(vel.x, vel.z) + Math.PI / 2;
    flowers.spawnVibrant(pos.x + Math.cos(ang) * off, pos.z + Math.sin(ang) * off);
  }
};
player.onLand = (impactSpeed) => {
  if (mode === "awakening") return;
  audio.playLanding(impactSpeed);
};

// ---- post-processing ----
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.42,    // strength — bumped a touch so the shrine + Last Light glow more
  0.95,
  0.84,
);
composer.addPass(bloom);

const tonePass = new ShaderPass(ToneMapShader);
composer.addPass(tonePass);
composer.addPass(new OutputPass());

/* -----------------------------------------------------------
 * State machine
 * --------------------------------------------------------- */
let mode = "awakening";       // awakening → exploring → restoring → ascending → finale → done
let stateTime = 0;             // seconds since this state began
let firstInputAt = 0;          // when the player first touched a key/mouse

// finale fade overlay (created lazily)
let fadeOverlay = null;

// ---- begin: skip the legacy menu/Begin flow, start in awakening ----
titleEl?.classList.add("hidden");
beginBtn?.classList.add("hidden");
hud?.classList.add("visible");

// the first input transitions into "exploring" — until then, controls
// are locked and the camera sits low looking at the shrine.
let controlsEnabled = false;

function arm() {
  audio.start();
  audio._unmuteMusic?.();
}

window.addEventListener("pointerdown", () => {
  arm();
  if (mode === "awakening") tryWake();
});
window.addEventListener("keydown", (e) => {
  arm();
  if (mode === "awakening") tryWake();
  // press E near the shrine to trigger restoration
  if (e.code === "KeyE" && mode === "exploring") {
    if (canRestoreNow()) startRestoration();
  }
});

function tryWake() {
  if (firstInputAt > 0) return;
  firstInputAt = clock.getElapsedTime();
  // request pointer lock on first gesture
  renderer.domElement.requestPointerLock?.();
  // controls are enabled in the awakening→exploring transition (so the
  // intro 1.4s isn't disrupted by the player walking through the camera)
  showTitle("The Quiet Cliffs", 0.5, 4.0, 1.5);
}

/* -----------------------------------------------------------
 * Awakening pose — the player starts crouched/seated until first
 *   input. We achieve "seated" by lowering the body group + a
 *   forward tilt, then ease back to standing on first input.
 *
 *   Camera is locked low and angled at the dormant shrine.
 * --------------------------------------------------------- */
// (seatedTarget / standingTarget pose constants used to live here, but
//  modifying player.body.rotation fights the player's per-frame quat
//  set. The awakening framing is now camera-only.)

// disable input from the start — Player.enableControl() is called on first input
player.canControl = false;

/* -----------------------------------------------------------
 * Title overlay (single line, no UI library) — fades in/out and
 *   lives on top of the canvas. Reuses the loading <div> as a
 *   scrim wrapper.
 * --------------------------------------------------------- */
function ensureFadeOverlay() {
  if (fadeOverlay) return fadeOverlay;
  const el = document.createElement("div");
  el.style.position = "fixed";
  el.style.inset = "0";
  el.style.background = "white";
  el.style.opacity = "0";
  el.style.pointerEvents = "none";
  el.style.transition = "opacity 1.6s ease-in-out";
  el.style.zIndex = "100";
  document.body.appendChild(el);
  fadeOverlay = el;
  return el;
}

let titleEl2 = null;
function showTitle(text, fadeInDelay, hold, fadeDur) {
  if (!titleEl2) {
    titleEl2 = document.createElement("div");
    titleEl2.style.position = "fixed";
    titleEl2.style.inset = "0";
    titleEl2.style.display = "flex";
    titleEl2.style.alignItems = "center";
    titleEl2.style.justifyContent = "center";
    titleEl2.style.color = "rgba(255, 240, 220, 0.92)";
    titleEl2.style.font = "300 38px/1.2 Georgia, serif";
    titleEl2.style.letterSpacing = "0.18em";
    titleEl2.style.opacity = "0";
    titleEl2.style.pointerEvents = "none";
    titleEl2.style.textShadow = "0 0 24px rgba(40, 20, 8, 0.55)";
    titleEl2.style.transition = "opacity 1.4s ease-in-out";
    titleEl2.style.zIndex = "60";
    document.body.appendChild(titleEl2);
  }
  titleEl2.textContent = text;
  setTimeout(() => { titleEl2.style.opacity = "1"; }, fadeInDelay * 1000);
  setTimeout(() => { titleEl2.style.opacity = "0"; }, (fadeInDelay + hold) * 1000);
}

let endEl = null;
function showEnd(text) {
  if (!endEl) {
    endEl = document.createElement("div");
    endEl.style.position = "fixed";
    endEl.style.inset = "0";
    endEl.style.display = "flex";
    endEl.style.alignItems = "center";
    endEl.style.justifyContent = "center";
    endEl.style.color = "rgba(80, 50, 30, 0.85)";
    endEl.style.font = "300 28px/1.4 Georgia, serif";
    endEl.style.letterSpacing = "0.22em";
    endEl.style.opacity = "0";
    endEl.style.pointerEvents = "none";
    endEl.style.transition = "opacity 2.0s ease-in-out 1.4s";
    endEl.style.zIndex = "120";
    document.body.appendChild(endEl);
  }
  endEl.textContent = text;
  endEl.style.opacity = "1";
}

/* ----- press-E prompt for the shrine ----- */
function showShrinePrompt() {
  if (promptEl) {
    promptEl.textContent = "[E] place your hand";
    promptEl.classList.add("show");
  }
}
function hideShrinePrompt() {
  if (promptEl) promptEl.classList.remove("show");
}

/* -----------------------------------------------------------
 * Restoration trigger
 * --------------------------------------------------------- */
function canRestoreNow() {
  if (world.shrine?.isActive()) return false;
  const sp = world.shrine.worldPos();
  const dx = player.position.x - sp.x;
  const dz = player.position.z - sp.z;
  const d = Math.hypot(dx, dz);
  return d < 4.5;
}

function startRestoration() {
  mode = "restoring";
  stateTime = 0;
  hideShrinePrompt();
  player.canControl = false;
  audio.fadeOut(1.0);
  // arm the wave; the resonance system carries it out from here
  resonance.triggerRipple?.(world.shrine.worldPos(), {
    speed: 36,           // m/s — covers ~110m in ~3s
    maxRadius: 200,
    onComplete: () => {
      // finale opens up after restoration settles
      mode = "ascending";
      stateTime = 0;
      player.canControl = true;
      audio.fadeIn(2.5);
    },
  });
  // the shrine itself starts swelling immediately
  world.shrine.activate(clock.getElapsedTime());
}

// camera helpers for awakening intro pan
const _camIdealPos = new THREE.Vector3();
const _camLook = new THREE.Vector3();
const _tmpVec = new THREE.Vector3();

function awakeningCameraUpdate(dt, t) {
  // Awakening framing: camera sits low and slightly behind/right of the
  // player. Player is facing -Z (toward the cliff edge / sunrise). The
  // dormant shrine sits at (0,0,0), just to the player's rear-left, so
  // it reads in the foreground. The Last Light is visible above the
  // cliff in the distance.
  // (We don't modify the player's body pose — the camera framing alone
  //  communicates the quiet, intimate moment.)
  const sway = Math.sin(t * 0.08) * 0.02;
  const targetX = player.position.x + 2.6 + sway;
  const targetY = player.position.y + 1.55;
  const targetZ = player.position.z + 3.4;
  _camIdealPos.set(targetX, targetY, targetZ);
  camera.position.lerp(_camIdealPos, dt * 1.6);
  // look slightly forward and up — toward the cliff edge, with the
  // shrine framed off camera-left
  _camLook.set(player.position.x - 1.2, player.position.y + 1.7, player.position.z - 28);
  camera.lookAt(_camLook);
}

function intoExploringEase(dt) {
  // no body pose to ease — the player stands naturally as soon as they
  // gain control. The mode transition itself is the visual cue.
}

// Soft fall-prevention: if the player slips off the cliff before
// restoration, gently teleport them back to spawn rather than letting
// them plunge into the void.
function fallPrevention() {
  if (player.position.y < -40) {
    player.position.set(spawn.x, spawn.y + 0.5, spawn.z);
    player.velocity.set(0, 0, 0);
  }
}

function restoringCameraUpdate(dt, t) {
  // slow-zoom toward the shrine
  const sp = world.shrine.worldPos();
  const ang = stateTime * 0.20;     // small drift around shrine
  const dist = THREE.MathUtils.lerp(5.0, 2.6, THREE.MathUtils.smoothstep(stateTime, 0, 1.5));
  const yOff = 1.6;
  _camIdealPos.set(
    sp.x - Math.sin(ang) * dist,
    sp.y + yOff,
    sp.z - Math.cos(ang) * dist,
  );
  camera.position.lerp(_camIdealPos, dt * 1.3);
  camera.lookAt(sp.x, sp.y + 2.0, sp.z);
}

let finaleStarted = false;
function maybeStartFinale() {
  if (finaleStarted) return;
  // distance to the cliff edge
  const dx = player.position.x - CLIFF_EDGE.x;
  const dz = player.position.z - CLIFF_EDGE.z;
  const d = Math.hypot(dx, dz);
  if (d < 6.0) {
    finaleStarted = true;
    mode = "finale";
    stateTime = 0;
    player.canControl = false;
  }
}

function finaleUpdate(dt, t) {
  // 0..3.5s : camera tilts up, cloud sea sinks, Last Light grows
  const u = THREE.MathUtils.clamp(stateTime / 3.5, 0, 1);
  const eased = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;

  // cloud part driver
  if (world.clouds) {
    world.clouds.partFactor.value = eased;
    world.clouds.plane.position.y = -42 - eased * 24;   // sinks
  }
  // Last Light grows
  world.skyMat.uniforms.uPlanetSize.value = 0.06 + eased * 0.10;
  // sky base brightens slightly toward white
  const horiz = world.skyMat.uniforms.uHorizon.value;
  horiz.lerp(new THREE.Color("#ffe4c4"), dt * 0.6);

  // camera: from current position, tilt up toward Last Light
  const lp = world.skyMat.uniforms.uPlanetDir.value;
  const lookTarget = _tmpVec.set(
    player.position.x + lp.x * 600,
    player.position.y + lp.y * 600,
    player.position.z + lp.z * 600,
  );
  camera.position.x = THREE.MathUtils.lerp(camera.position.x, player.position.x, dt * 0.8);
  camera.position.y = THREE.MathUtils.lerp(camera.position.y, player.position.y + 2.8, dt * 0.6);
  camera.position.z = THREE.MathUtils.lerp(camera.position.z, player.position.z + 2.0, dt * 0.8);
  camera.lookAt(lookTarget);

  // fade to white starting at 3.0s
  if (stateTime > 3.0) {
    const fadeT = THREE.MathUtils.clamp((stateTime - 3.0) / 2.0, 0, 1);
    const ov = ensureFadeOverlay();
    ov.style.opacity = `${fadeT}`;
    if (fadeT >= 1.0 && mode !== "done") {
      mode = "done";
      showEnd("to be continued");
    }
  }
}

/* -----------------------------------------------------------
 * Main loop
 * --------------------------------------------------------- */
const clock = new THREE.Clock();
let lastTime = 0;

function animate() {
  const t = clock.getElapsedTime();
  const dt = Math.min(0.05, t - lastTime);
  lastTime = t;
  stateTime += dt;

  updateWorld(world, dt, t);
  tonePass.uniforms.uTime.value = t;

  // ---- player update with state-aware overrides ----
  if (mode === "awakening") {
    player.update(dt, t);
    awakeningCameraUpdate(dt, t);
  } else if (mode === "exploring") {
    player.update(dt, t);
    intoExploringEase(dt);
    fallPrevention();
    // proximity prompt for the shrine
    if (canRestoreNow()) showShrinePrompt(); else hideShrinePrompt();
  } else if (mode === "restoring") {
    player.update(dt, t);
    restoringCameraUpdate(dt, t);
    // when the wave + bridge reform are clearly underway we'll move on,
    // but the resonance ripple onComplete callback also bumps us to ascending.
  } else if (mode === "ascending") {
    player.update(dt, t);
    maybeStartFinale();
    fallPrevention();
  } else if (mode === "finale") {
    player.update(dt, t);
    finaleUpdate(dt, t);
  } else {
    // "done" — keep updating particles + cloak so the final shot is alive
    player.update(dt, t);
  }

  // promote awakening -> exploring once the body has stood up enough
  if (mode === "awakening" && firstInputAt > 0 && (t - firstInputAt) > 1.4) {
    mode = "exploring";
    stateTime = 0;
    player.enableControl();
  }

  // sun shadow camera follows the player
  const sd = world.sunDir;
  world.sun.position.set(
    player.position.x + sd.x * 120,
    player.position.y + sd.y * 120,
    player.position.z + sd.z * 120,
  );
  world.sun.target.position.copy(player.position);
  world.sun.target.updateMatrixWorld();

  // wind for sand & audio
  const windScale = (mode === "awakening") ? 0.2 : (world.shrine?.isActive() ? 1.3 : 1.0);
  const wind = computeGlobalWind(t, player.velocity, windScale);
  sand.update(dt, t, wind, camera, player);
  flowers.update(dt);
  if (mode !== "awakening") resonance.update(dt, t);
  audio.update(dt, t, {
    speed: player.currentSpeed,
    sliding: player.sliding,
    archProximity: world.shrine?.isActive() ? 1.0 : 0.0,
  });

  // restoration animation drivers (cliff props)
  if (mode === "restoring" || mode === "ascending" || mode === "finale" || mode === "done") {
    const since = (mode === "restoring") ? stateTime : Math.max(stateTime + 6, 6);
    world.cliffs?.setRestoring(THREE.MathUtils.clamp(since / 2.5, 0, 1));
    world.cliffs?.setBridgeReformProgress(THREE.MathUtils.clamp((since - 0.4) / 3.5, 0, 1));
    // wind bridge: starts forming after restoration ripple has covered
    // the island (~5s in restoring), then completes during ascending.
    const wbT = (mode === "restoring")
      ? THREE.MathUtils.clamp((stateTime - 4.0) / 4.0, 0, 1)
      : THREE.MathUtils.clamp(1.0 + stateTime / 6.0, 0, 1);
    world.cliffs?.setWindBridgeProgress(wbT);
  }

  composer.render();
  requestAnimationFrame(animate);
}

const _windTmp = new THREE.Vector3();
function computeGlobalWind(t, playerVel, scale = 1.0) {
  const base = -1.2 + Math.sin(t * 0.15) * 0.45;
  _windTmp.set(
    base + Math.sin(t * 0.4) * 0.3,
    0.05 + Math.sin(t * 0.31) * 0.04,
    Math.sin(t * 0.27) * 0.3,
  );
  _windTmp.multiplyScalar(scale);
  _windTmp.addScaledVector(playerVel, -0.3);
  return _windTmp;
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
loading?.classList.add("gone");
animate();
