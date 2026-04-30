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
 *   States:  exploring → restoring → ascending → finale
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
// Cap pixel ratio at 1.5 — on retina/4K displays the older 1.75 cap was
// pushing the GPU hard enough to starve the audio thread. 1.5 still
// looks crisp and recovers a lot of headroom.
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
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
  audio.playLanding(impactSpeed);
};

// ---- post-processing ----
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const bloom = new UnrealBloomPass(
  // run bloom at half resolution — the falloff hides the lower res, and
  // it was costing 1-2ms/frame at full res. Pre-dawn: a touch more bloom
  // strength so the lantern, eyes, and Last Light pop in the dim air.
  new THREE.Vector2(window.innerWidth * 0.5, window.innerHeight * 0.5),
  0.50,
  0.72,
  0.78,
);
composer.addPass(bloom);

const tonePass = new ShaderPass(ToneMapShader);
composer.addPass(tonePass);
composer.addPass(new OutputPass());

/* -----------------------------------------------------------
 * State machine
 * --------------------------------------------------------- */
let mode = "intro";            // intro → exploring → restoring → ascending → finale → done
let stateTime = 0;             // seconds since this state began
let firstInputAt = 0;          // when the player first touched a key/mouse

// finale fade overlay (created lazily)
let fadeOverlay = null;

// ---- begin: skip the legacy menu/Begin flow ----
titleEl?.classList.add("hidden");
beginBtn?.classList.add("hidden");
hud?.classList.add("visible");

// player is locked during the opening cinematic
player.canControl = false;

function arm() {
  audio.start();
  audio._unmuteMusic?.();
}

window.addEventListener("pointerdown", () => {
  arm();
  if (mode === "intro") return;
  noteFirstInput();
});
window.addEventListener("keydown", (e) => {
  arm();
  if (mode === "intro") { skipIntro(); return; }
  noteFirstInput();
  if (e.code === "KeyE") {
    if (mode === "exploring" && canRestoreNow()) {
      startRestoration();
    } else if ((mode === "exploring" || mode === "ascending") && canLightLampNow()) {
      lightNearestLamp();
    }
  }
});

function noteFirstInput() {
  if (firstInputAt > 0) return;
  firstInputAt = clock.getElapsedTime();
  renderer.domElement.requestPointerLock?.();
  showTitle("The Quiet Cliffs", 0.5, 4.0, 1.5);
}


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

/* ----- press-E prompt for the dying lantern ----- */
function showShrinePrompt() {
  if (promptEl) {
    promptEl.textContent = "[E] take the flame";
    promptEl.classList.add("show");
  }
}
function hideShrinePrompt() {
  if (promptEl) promptEl.classList.remove("show");
}

function hidePrompt() {
  if (promptEl) promptEl.classList.remove("show");
}

const _promptWorld = new THREE.Vector3();
function updatePromptPosition() {
  if (!promptEl || !promptEl.classList.contains("show")) return;
  _promptWorld.copy(player.position);
  _promptWorld.y += 3.8; // above the player's head
  _promptWorld.project(camera);
  const x = ( _promptWorld.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-_promptWorld.y * 0.5 + 0.5) * window.innerHeight;
  promptEl.style.left = `${x}px`;
  promptEl.style.top  = `${y}px`;
}

/* -----------------------------------------------------------
 * Path-lamp lighting system
 *   Lamps[1..3] (z≈-72, -56, -38) are between the shrine and
 *   the cliff steps. The lamp auto-lights when the player steps
 *   within LAMP_STEP_DIST of the base, costing a fraction of their flame.
 * --------------------------------------------------------- */
const LIGHTABLE_LAMP_INDICES = [0, 1, 2]; // 0 = cliff lamp, 1 = mid lamp, 2 = near lamp
const FLAME_COST_PER_LAMP = 0.25;
const LAMP_STEP_DIST = 1.5; // horizontal distance to base for auto-light on approach

function nearestLightableLamp() {
  if (!world.lampPosts) return null;
  if (player.heldLanternFlame < 0.15) return null;
  let best = null, bestD = Infinity;
  for (const idx of LIGHTABLE_LAMP_INDICES) {
    const lp = world.lampPosts[idx];
    if (!lp || lp.lit) continue;
    const dx = player.position.x - lp.group.position.x;
    const dz = player.position.z - lp.group.position.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < LAMP_STEP_DIST && d < bestD) { bestD = d; best = lp; }
  }
  return best;
}

function canLightLampNow() { return nearestLightableLamp() !== null; }

const _lampMoteTmp = new THREE.Vector3();
let lampLightTransfers = [];

function lightNearestLamp() {
  const lp = nearestLightableLamp();
  if (!lp) return;
  lp.lit = true;
  player.heldLanternFlame = Math.max(0.2, player.heldLanternFlame - FLAME_COST_PER_LAMP);
  audio.playLampLight();

  // mote arcs from player lantern to the lamp
  if (player.heldLanternCore) {
    player.heldLanternCore.getWorldPosition(_lampMoteTmp);
  } else {
    _lampMoteTmp.copy(player.position).y += 1.5;
  }
  const startPos = _lampMoteTmp.clone();
  const endPos = lp.group.position.clone().add(lp.lanternOffset);
  const mote = makeFlameMote(startPos);
  lampLightTransfers.push({
    mote, startPos, endPos,
    t0: clock.getElapsedTime(),
    duration: 0.65,
    lp,
  });
}

function updateLampLightTransfers(t) {
  for (let i = lampLightTransfers.length - 1; i >= 0; i--) {
    const tr = lampLightTransfers[i];
    const u = THREE.MathUtils.clamp((t - tr.t0) / tr.duration, 0, 1);
    tr.mote.position.lerpVectors(tr.startPos, tr.endPos, u);
    tr.mote.position.y += Math.sin(u * Math.PI) * 0.45;
    tr.mote.material.opacity = u < 0.78 ? 1 : Math.max(0, 1 - (u - 0.78) / 0.22);
    if (u >= 1) {
      scene.remove(tr.mote);
      tr.mote.geometry.dispose();
      tr.mote.material.dispose();
      // ignite the lamp — warm glass glow and inner core, no halo orb
      const lp = tr.lp;
      lp.glassMat.emissiveIntensity = 1.4;
      lp.glassMat.opacity = 0.9;
      lp.haloMat.opacity = 0;
      lp.coreMat.opacity = 0.82;
      lp.light.intensity = 1.2;
      lampLightTransfers.splice(i, 1);
    }
  }
}

function flickerLitLamps(t) {
  if (!world.lampPosts) return;
  for (const idx of LIGHTABLE_LAMP_INDICES) {
    const lp = world.lampPosts[idx];
    if (!lp?.lit) continue;
    const f = 0.88 + Math.sin(t * 1.4 + idx * 1.7) * 0.08 +
              Math.sin(t * 3.1 + idx * 0.9) * 0.04;
    lp.glassMat.emissiveIntensity = 1.4 * f;
    lp.coreMat.opacity = 0.82 * f;
    lp.light.intensity = 1.2 * f;
  }
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

/* -----------------------------------------------------------
 * Take-the-flame cinematic
 *
 *   Triggered by [E] near the dying lantern. Locks player input,
 *   walks the avatar the last few steps to the shrine, has them
 *   raise their lantern overhead, then a glowing mote arcs from
 *   the shrine's flame down into the held lantern. The world
 *   ripple fires when the flame lands.
 *
 *   Phases (durations in seconds):
 *     APPROACH (1.4) — auto-walk to the shrine, body faces it
 *     RAISE    (0.9) — lantern rises overhead, brief held beat
 *     JUMP     (0.9) — flame leaves shrine, arcs into lantern
 *     SETTLE   (0.5) — lower lantern, ripple has been triggered
 * --------------------------------------------------------- */
const TF_APPROACH = 1.4;
const TF_RAISE    = 0.9;
const TF_JUMP     = 0.9;
const TF_SETTLE   = 0.35;
const TF_TOTAL    = TF_APPROACH + TF_RAISE + TF_JUMP + TF_SETTLE;

let flameTransfer = null;       // active cinematic state
let rippleArmed = false;        // whether resonance ripple has been kicked

function startRestoration() {
  mode = "restoring";
  stateTime = 0;
  hidePrompt();
  player.canControl = false;
  rippleArmed = false;

  const sp = world.shrine.worldPos().clone();
  // approach target: stop ~2.3m from the shrine, facing it
  const dx = player.position.x - sp.x;
  const dz = player.position.z - sp.z;
  const d = Math.max(0.0001, Math.hypot(dx, dz));
  const stopDist = 2.3;
  const approachTarget = new THREE.Vector3(
    sp.x + (dx / d) * stopDist,
    0,
    sp.z + (dz / d) * stopDist,
  );
  approachTarget.y = world.getTerrainHeight(approachTarget.x, approachTarget.z);
  const facingYaw = Math.atan2(-(sp.x - approachTarget.x), -(sp.z - approachTarget.z));

  flameTransfer = {
    t0: clock.getElapsedTime(),
    sp,
    startPos: player.position.clone(),
    approachTarget,
    facingYaw,
    mote: null,
  };
}

function makeFlameMote(pos) {
  const mat = new THREE.MeshBasicMaterial({
    color: 0xfff1c4,
    transparent: true,
    opacity: 1,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), mat);
  mesh.position.copy(pos);
  scene.add(mesh);
  return mesh;
}

const _flameTarget = new THREE.Vector3();
const _approachTmp = new THREE.Vector3();
function updateFlameTransfer(t, dt) {
  if (!flameTransfer) return;
  const elapsed = t - flameTransfer.t0;

  // ---- phase: APPROACH ----
  if (elapsed < TF_APPROACH) {
    const u = elapsed / TF_APPROACH;
    const eased = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
    _approachTmp.lerpVectors(flameTransfer.startPos, flameTransfer.approachTarget, eased);
    _approachTmp.y = world.getTerrainHeight(_approachTmp.x, _approachTmp.z);
    // drive position + a fake forward velocity so the walk cycle plays
    const prevX = player.position.x;
    const prevZ = player.position.z;
    player.position.x = _approachTmp.x;
    player.position.y = _approachTmp.y;
    player.position.z = _approachTmp.z;
    player.velocity.x = (player.position.x - prevX) / Math.max(dt, 1e-4);
    player.velocity.z = (player.position.z - prevZ) / Math.max(dt, 1e-4);
    player.velocity.y = 0;
    player.bodyYaw = lerpAngle(player.bodyYaw, flameTransfer.facingYaw, Math.min(1, dt * 5));
    player.targetYaw = flameTransfer.facingYaw;
    player.lanternRaise = 0;
    return;
  }

  // standing still from here on
  player.velocity.x = 0;
  player.velocity.z = 0;
  player.bodyYaw = lerpAngle(player.bodyYaw, flameTransfer.facingYaw, Math.min(1, dt * 6));

  // ---- phase: RAISE (lift the lantern overhead) ----
  const raiseStart = TF_APPROACH;
  const jumpStart  = TF_APPROACH + TF_RAISE;
  const settleStart = jumpStart + TF_JUMP;

  if (elapsed < jumpStart) {
    const u = (elapsed - raiseStart) / TF_RAISE;
    const eased = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
    player.lanternRaise = eased;
    return;
  }

  // ---- phase: JUMP (flame crosses from shrine to lantern) ----
  if (elapsed < settleStart) {
    player.lanternRaise = 1;
    if (!flameTransfer.mote) {
      flameTransfer.mote = makeFlameMote(flameTransfer.sp);
      // shrine flame begins fading out
      world.shrine.activate(t);
    }
    const u = (elapsed - jumpStart) / TF_JUMP;

    // lantern world position (where the held core sits)
    if (player.heldLanternCore) {
      player.heldLanternCore.getWorldPosition(_flameTarget);
    } else {
      _flameTarget.copy(player.position);
      _flameTarget.y += 2.2;
    }
    const m = flameTransfer.mote;
    m.position.lerpVectors(flameTransfer.sp, _flameTarget, u);
    m.position.y += Math.sin(u * Math.PI) * 0.55;
    m.material.opacity = u < 0.82 ? 1.0 : Math.max(0, 1.0 - (u - 0.82) / 0.18);

    // lit-ness ramps with u, with a final flash near the end
    player.heldLanternFlame = Math.pow(u, 1.4);

    // arm the world ripple just before the flame lands, and hand control
    // back to the player at the same moment so the SETTLE phase is just
    // visual polish — they can already walk away.
    if (!rippleArmed && u > 0.7) {
      rippleArmed = true;
      resonance.triggerRipple?.(flameTransfer.sp, {
        speed: 36,
        maxRadius: 200,
        // ripple onComplete only handles the late-game ascending bump
        onComplete: () => {
          if (mode === "restoring") {
            mode = "ascending";
            stateTime = 0;
          }
        },
      });
      mode = "ascending";
      stateTime = 0;
      player.canControl = true;
      audio.fadeIn(1.2);
    }
    return;
  }

  // ---- phase: SETTLE (lower lantern, player already in control) ----
  if (elapsed < TF_TOTAL) {
    const u = (elapsed - settleStart) / TF_SETTLE;
    player.lanternRaise = 1 - (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
    player.heldLanternFlame = 1;
    if (flameTransfer.mote && flameTransfer.mote.material.opacity > 0) {
      flameTransfer.mote.material.opacity = Math.max(
        0, flameTransfer.mote.material.opacity - dt * 4,
      );
    }
    return;
  }

  // ---- cinematic complete ----
  if (flameTransfer.mote) {
    scene.remove(flameTransfer.mote);
    flameTransfer.mote.geometry.dispose();
    flameTransfer.mote.material.dispose();
  }
  player.lanternRaise = 0;
  player.heldLanternFlame = 1;
  flameTransfer = null;
}

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d >  Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// camera / scratch vectors used by cinematic states
const _camIdealPos = new THREE.Vector3();
const _camLook = new THREE.Vector3();
const _tmpVec = new THREE.Vector3();

/* -----------------------------------------------------------
 * Opening cinematic
 *
 *   Timing (stateTime seconds):
 *     0 – 2.2     FLICKER  — tight on lighthouse; lamp flickers then dies
 *     2.2 – 10.2  RETREAT  — single bezier: pulls back and descends the whole
 *                            way from lighthouse to spawn with no phase seam;
 *                            camera looks back as each lamp dies along the path
 *     7.7         TEXT     — phrase fades in
 *     10.2                 — transition to "exploring"
 * --------------------------------------------------------- */
const INTRO_FLICKER_DUR = 2.2;
const INTRO_RETREAT_DUR = 8.0;

const INTRO_ZOOM_AT  = INTRO_FLICKER_DUR;
const INTRO_TRACK_AT = INTRO_ZOOM_AT + INTRO_RETREAT_DUR;  // = INTRO_END; TRACK branch never fires
const INTRO_TEXT_AT  = INTRO_ZOOM_AT + 5.5;
const INTRO_END      = INTRO_ZOOM_AT + INTRO_RETREAT_DUR;

// lamp die times: [cliff lamp, path lamp, spawn lamp]
const LAMP_DIE_TIMES = [7.5, 8.5, 9.5];

// voice line — place your ElevenLabs export at assets/sounds/intro_voice.mp3
const _voiceLine = new window.Audio("assets/sounds/intro_voice.mp3");
_voiceLine.volume = 0.85;
let _voicePlayed = false;

const _restoreMusic = new window.Audio("assets/sounds/restore_the_light.mp3");
_restoreMusic.volume = 1.0;
let _restoreMusicPlayed = false;

// cubic bezier: full retreat path (lighthouse → spawn)
// P1 is below P0 — camera descends the whole way, no upward arc
const _zP0 = new THREE.Vector3(1.5, 54.5, -222);
const _zP1 = new THREE.Vector3(3,   38,   -202);
const _zP2 = new THREE.Vector3(2.5,  5,    -90);
const _zP3 = new THREE.Vector3(2,    4.5,  -14);
// cubic bezier: look-target (lighthouse → looking back at path lamps from spawn)
const _zL0 = new THREE.Vector3(0,   53.8, -240);
const _zL1 = new THREE.Vector3(0.5, 50,   -235);
const _zL2 = new THREE.Vector3(1.5,  5,   -120);
const _zL3 = new THREE.Vector3(2,    4.5,  -60);
const _iTrackEnd = new THREE.Vector3(2, 4.5, -14);
const _ibTmp = new THREE.Vector3();
const _ilTmp = new THREE.Vector3();

function _quadBez(a, b, c, t, out) {
  const s = 1 - t;
  out.set(
    s*s*a.x + 2*s*t*b.x + t*t*c.x,
    s*s*a.y + 2*s*t*b.y + t*t*c.y,
    s*s*a.z + 2*s*t*b.z + t*t*c.z,
  );
}

function _cubicBez(p0, p1, p2, p3, t, out) {
  const s = 1 - t;
  out.set(
    s*s*s*p0.x + 3*s*s*t*p1.x + 3*s*t*t*p2.x + t*t*t*p3.x,
    s*s*s*p0.y + 3*s*s*t*p1.y + 3*s*t*t*p2.y + t*t*t*p3.y,
    s*s*s*p0.z + 3*s*s*t*p1.z + 3*s*t*t*p2.z + t*t*t*p3.z,
  );
}

function _introFlicker(t, seed) {
  return Math.abs(Math.sin(t * 23.1 + seed) * Math.cos(t * 13.7 + seed * 1.9));
}

const _INTRO_LINES = [
  "the lights are going out",
  "who will bear the light",
  "who will restore the flame?",
];
// [showAt, hideAt] for each line
const _INTRO_LINE_TIMES = [[1.0, 2.6], [3.0, 4.6], [5.0, 7.2]];

let _introLineEls = null;
function _ensureIntroLines() {
  if (_introLineEls) return _introLineEls;
  const base =
    "position:fixed;bottom:72px;left:0;right:0;text-align:center;" +
    "font:300 26px/1.5 Georgia,serif;letter-spacing:0.26em;" +
    "color:rgba(255,238,210,0.95);opacity:0;pointer-events:none;" +
    "text-shadow:0 0 28px rgba(255,170,50,0.5),0 0 6px rgba(0,0,0,0.9);" +
    "transition:opacity 0.9s ease-in-out;z-index:55;user-select:none;";
  _introLineEls = _INTRO_LINES.map(text => {
    const el = document.createElement("div");
    el.style.cssText = base;
    el.textContent = text;
    document.body.appendChild(el);
    return el;
  });
  return _introLineEls;
}

let _introTitleEl = null;
function _ensureIntroTitle() {
  if (_introTitleEl) return _introTitleEl;
  _introTitleEl = document.createElement("div");
  _introTitleEl.style.cssText =
    "position:fixed;top:40px;right:48px;text-align:right;" +
    "font:300 20px/1.5 Georgia,serif;letter-spacing:0.32em;" +
    "color:rgba(255,238,210,0.88);opacity:0;pointer-events:none;" +
    "text-shadow:0 0 20px rgba(255,150,40,0.4),0 0 5px rgba(0,0,0,0.85);" +
    "transition:opacity 1.6s ease-in-out;z-index:56;user-select:none;";
  _introTitleEl.textContent = "The Quiet Cliffs";
  document.body.appendChild(_introTitleEl);
  return _introTitleEl;
}

function introUpdate(dt, t) {
  const si   = world.cliffs?.skyIsland;
  const lamps = world.lampPosts;

  // ---- Lighthouse: flicker during hold, fade during zoom-out ----
  if (stateTime < INTRO_ZOOM_AT) {
    const f = _introFlicker(t, 0);
    if (si?.lampMat) {
      si.lampMat.opacity = 0.35 + f * 0.65;
      si.lampMat.color.setRGB(1.0, 0.85 + f * 0.15, 0.5 + f * 0.35);
    }
    if (si?.haloMat) si.haloMat.opacity = 0.22 * (0.4 + f * 0.6);

  } else if (stateTime < INTRO_ZOOM_AT + 0.5) {
    // quick extinction — light dies as the camera starts to pull back
    const dying = 1 - (stateTime - INTRO_ZOOM_AT) / 0.5;
    if (si?.lampMat) {
      si.lampMat.opacity = dying * 0.9;
      si.lampMat.color.setRGB(1.0, 0.7 * dying, 0.3 * dying);
    }
    if (si?.haloMat) si.haloMat.opacity = dying * 0.22;

  } else {
    if (si?.lampMat) si.lampMat.opacity = 0;
    if (si?.haloMat) si.haloMat.opacity = 0;
  }

  // ---- Camera path ----
  if (stateTime < INTRO_ZOOM_AT) {
    // FLICKER: hold tight on the lighthouse lamp — keep trackers in sync so
    // the lerp-based phases below don't snap when they take over
    camera.position.set(1.5, 54.5, -222);
    _camLook.set(0, 53.8, -240);
    camera.lookAt(_camLook);

  } else {
    // RETREAT: single bezier from lighthouse to spawn — no phase seam
    const u = THREE.MathUtils.clamp((stateTime - INTRO_ZOOM_AT) / INTRO_RETREAT_DUR, 0, 1);
    const e = u * u * (3 - 2 * u);  // smoothstep: gentle start, gentle landing
    _cubicBez(_zP0, _zP1, _zP2, _zP3, e, _ibTmp);
    camera.position.lerp(_ibTmp, Math.min(1, dt * 8));
    _cubicBez(_zL0, _zL1, _zL2, _zL3, e, _ilTmp);
    _camLook.lerp(_ilTmp, Math.min(1, dt * 5));
    camera.lookAt(_camLook);
  }

  // ---- Lamp post die sequence ----
  if (lamps) {
    for (let i = 0; i < lamps.length; i++) {
      const lp = lamps[i];
      const dieAt = LAMP_DIE_TIMES[i];
      if (stateTime < dieAt) {
        lp.glassMat.emissiveIntensity = 1.4;
        lp.glassMat.opacity = 0.9;
        lp.haloMat.opacity = 0.38;
      } else if (stateTime < dieAt + 0.65) {
        const dying = 1 - (stateTime - dieAt) / 0.65;
        const f = _introFlicker(t, i * 2.3 + 7.1);
        lp.glassMat.emissiveIntensity = dying * (0.2 + f * 1.2);
        lp.glassMat.opacity = 0.3 + f * 0.6 * dying;
        lp.haloMat.opacity = 0.38 * dying * f;
      } else {
        lp.glassMat.emissiveIntensity = 0;
        lp.glassMat.opacity = 0.12;
        lp.haloMat.opacity = 0;
      }
    }
  }

  // ---- Text overlay + voice ----
  const lines = _ensureIntroLines();
  for (let i = 0; i < lines.length; i++) {
    const [show, hide] = _INTRO_LINE_TIMES[i];
    lines[i].style.opacity = (stateTime >= show && stateTime < hide) ? "1" : "0";
  }

  const titleEl3 = _ensureIntroTitle();
  const showGameTitle = stateTime >= 7.0 && stateTime < INTRO_END - 0.4;
  titleEl3.style.opacity = showGameTitle ? "1" : "0";

  if (!_restoreMusicPlayed && stateTime >= 2.0) {
    _restoreMusicPlayed = true;
    _restoreMusic.play().catch(() => {});
  }

  if (!_voicePlayed && stateTime >= INTRO_TEXT_AT) {
    _voicePlayed = true;
    _voiceLine.play().catch(() => {});
  }

  if (stateTime >= INTRO_END) endIntro();
}

function endIntro() {
  mode = "exploring";
  stateTime = 0;
  player.canControl = true;
  _voicePlayed = false;
  _restoreMusicPlayed = false;

  // hide text
  if (_introLineEls) _introLineEls.forEach(el => el.style.opacity = "0");
  if (_introTitleEl) _introTitleEl.style.opacity = "0";

  // freeze all lamps dark — player lights them by carrying the shrine flame
  const lamps = world.lampPosts;
  if (lamps) {
    for (let i = 0; i < lamps.length; i++) {
      lamps[i].glassMat.emissiveIntensity = 0;
      lamps[i].glassMat.opacity = 0.12;
      lamps[i].haloMat.opacity = 0;
    }
  }
  const si = world.cliffs?.skyIsland;
  if (si?.lampMat) si.lampMat.opacity = 0;
  if (si?.haloMat) si.haloMat.opacity = 0;

  // position camera behind player so the snap isn't jarring
  const pp = player.position;
  camera.position.set(pp.x + 2, pp.y + 4, pp.z + 7);
  camera.lookAt(pp.x, pp.y + 1, pp.z - 4);

  noteFirstInput();
}

function skipIntro() {
  if (mode !== "intro") return;
  stateTime = INTRO_END;   // endIntro() fires on the next frame
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

/* Step-front respawn: when the player misses a pad and falls below the
 * mist line, drop them just back from the cliff edge in front of the
 * first stepping pad (not all the way back at spawn) and show a short
 * "the shadows have spared your life" message. */
const STEP_FRONT = new THREE.Vector3(
  0,
  world.getTerrainHeight(0, -94) + 0.5,
  -94,
);
const FOG_DEATH_Y = -25;     // anything below the cloud plane counts as "in the fog"
let shadowsCooldown = 0;     // seconds — debounce so we don't re-fire mid-teleport

let shadowsEl = null;
function ensureShadowsMessage() {
  if (shadowsEl) return shadowsEl;
  const el = document.createElement("div");
  el.style.position = "fixed";
  el.style.left = "0";
  el.style.right = "0";
  el.style.bottom = "22%";
  el.style.textAlign = "center";
  el.style.color = "rgba(220, 210, 230, 0.92)";
  el.style.font = "300 26px/1.4 Georgia, serif";
  el.style.letterSpacing = "0.20em";
  el.style.opacity = "0";
  el.style.pointerEvents = "none";
  el.style.textShadow = "0 0 22px rgba(8, 4, 18, 0.85), 0 0 4px rgba(0,0,0,0.9)";
  el.style.transition = "opacity 1.2s ease-in-out";
  el.style.zIndex = "70";
  el.textContent = "the shadows have spared your life";
  document.body.appendChild(el);
  shadowsEl = el;
  return el;
}

function fallToShadows() {
  player.position.copy(STEP_FRONT);
  player.velocity.set(0, 0, 0);
  const el = ensureShadowsMessage();
  el.style.opacity = "1";
  // hold for ~2.4s, then fade out
  clearTimeout(shadowsEl._hideTimer);
  shadowsEl._hideTimer = setTimeout(() => { el.style.opacity = "0"; }, 2400);
  shadowsCooldown = 1.2;
}

function restoringCameraUpdate(dt, t) {
  // Cinematic two-shot framing: camera sits to the side of the player
  // looking past them at the shrine, drifts forward subtly during the
  // approach, then swings up slightly when the lantern is raised.
  const sp = world.shrine.worldPos();
  const pp = player.position;
  // direction perpendicular to the player→shrine line, used as the side offset
  const dx = sp.x - pp.x;
  const dz = sp.z - pp.z;
  const len = Math.max(0.0001, Math.hypot(dx, dz));
  const nx = dx / len, nz = dz / len;
  // perp (rotate 90°): (-nz, nx)
  const px = -nz, pz = nx;

  const sideOff = 3.6;
  const backOff = -0.6;     // negative = camera slightly behind the player
  const heightLift = 1.7 + (player.lanternRaise || 0) * 0.6;
  _camIdealPos.set(
    pp.x + px * sideOff + nx * backOff,
    pp.y + heightLift,
    pp.z + pz * sideOff + nz * backOff,
  );
  camera.position.lerp(_camIdealPos, dt * 2.2);
  // look at the midpoint between player chest and shrine glass — keeps
  // both subjects in frame while the flame jumps the gap
  const midX = (pp.x + sp.x) * 0.5;
  const midZ = (pp.z + sp.z) * 0.5;
  const midY = pp.y + 1.6 + (player.lanternRaise || 0) * 0.3;
  camera.lookAt(midX, midY, midZ);
}

let finaleStarted = false;
const _finaleStart = { camPos: new THREE.Vector3(), planetSize: 0.06 };
function maybeStartFinale() {
  if (finaleStarted) return;
  // distance to the cliff edge
  const dx = player.position.x - CLIFF_EDGE.x;
  const dz = player.position.z - CLIFF_EDGE.z;
  const d = Math.hypot(dx, dz);
  if (d < 6.0) {
    finaleStarted = true;
    mode = "traversing";
    stateTime = 0;
    player.canControl = true;
  }
}

// finale pacing — pan, rise, hold, then return control to the player
const FN_PAN  = 2.2;
const FN_RISE = 2.6;
const FN_HOLD = 0.9;
const FN_REVEAL_END = FN_PAN + FN_RISE + FN_HOLD;

function finaleUpdate(dt, t) {
  // ---- fade out the Last Light (the "other floating thing") ----
  // shrink it through the pan phase and clamp to 0; once gone, the player's
  // eye has nowhere to drift but the new sky island.
  const lastLightFade = THREE.MathUtils.clamp(stateTime / 1.6, 0, 1);
  world.skyMat.uniforms.uPlanetSize.value =
    _finaleStart.planetSize * (1 - lastLightFade);

  // ---- cloud sea: parts and sinks as before, gives the reveal scale ----
  const cloudT = THREE.MathUtils.clamp(stateTime / (FN_PAN + FN_RISE), 0, 1);
  const cloudEased = cloudT < 0.5
    ? 2 * cloudT * cloudT
    : 1 - Math.pow(-2 * cloudT + 2, 2) / 2;
  if (world.clouds) {
    world.clouds.partFactor.value = cloudEased;
    world.clouds.plane.position.y = -22 - cloudEased * 30;
  }

  // sky base brightens slightly toward white (kept from the prior finale)
  const horiz = world.skyMat.uniforms.uHorizon.value;
  horiz.lerp(new THREE.Color("#ffe4c4"), dt * 0.6);

  // ---- camera cinematic ----
  // Phase 1 (0..FN_PAN): pan from the player's cliff vantage toward a
  //   close framing of the lighthouse on the new sky island.
  // Phase 2 (FN_PAN..FN_PAN+FN_RISE): rise up and pull back so the whole
  //   circular island and its glowing runes come into view from above.
  const islandPos = world.cliffs?.skyIsland?.group?.position;
  if (!islandPos) return;
  const ix = islandPos.x;
  const iy = islandPos.y;
  const iz = islandPos.z;

  // anchor A: where the camera was when finale started (player at cliff)
  const aX = _finaleStart.camPos.x;
  const aY = _finaleStart.camPos.y;
  const aZ = _finaleStart.camPos.z;
  // anchor B: cinematic vantage near the island, low and close to frame
  //   the lighthouse against the sky
  const bX = ix + 4;
  const bY = iy + 6;
  const bZ = iz + 32;
  // anchor C: high reveal, looking down on the disc and runes
  const cX = ix + 6;
  const cY = iy + 34;
  const cZ = iz + 24;

  const panT  = THREE.MathUtils.clamp(stateTime / FN_PAN, 0, 1);
  const panE  = panT * panT * (3 - 2 * panT);
  const riseT = THREE.MathUtils.clamp((stateTime - FN_PAN) / FN_RISE, 0, 1);
  const riseE = riseT * riseT * (3 - 2 * riseT);

  // pan A→B, then rise B→C
  const pX = THREE.MathUtils.lerp(aX, bX, panE);
  const pY = THREE.MathUtils.lerp(aY, bY, panE);
  const pZ = THREE.MathUtils.lerp(aZ, bZ, panE);
  const fX = THREE.MathUtils.lerp(pX, cX, riseE);
  const fY = THREE.MathUtils.lerp(pY, cY, riseE);
  const fZ = THREE.MathUtils.lerp(pZ, cZ, riseE);

  // ease toward the keyframe rather than snap — keeps motion velvety
  camera.position.lerp(_tmpVec.set(fX, fY, fZ), Math.min(1, dt * 2.4));

  // look target: lighthouse lantern during pan, drifts down to the
  // island disc as the camera rises so the runes come into frame
  const lookY = (iy + 11) - riseE * 9;
  camera.lookAt(ix, lookY, iz);

  // ---- end of reveal: hand control back so the player can hop the pads ----
  if (stateTime > FN_REVEAL_END) {
    mode = "traversing";
    stateTime = 0;
    player.canControl = true;
  }
}

/* Lighthouse-reach ending — once the player makes it onto the sky island
 * and is close to the lighthouse, fade to white and show "to be continued". */
let lighthouseReached = false;
function maybeFinishOnLighthouse() {
  if (lighthouseReached) return;
  const isle = world.cliffs?.skyIsland?.group?.position;
  if (!isle) return;
  const dx = player.position.x - isle.x;
  const dz = player.position.z - isle.z;
  const dy = player.position.y - isle.y;
  // on the disc (within ~6m of the lighthouse base) and at island height
  if (Math.hypot(dx, dz) < 6.0 && dy > -1.0 && dy < 6.0) {
    lighthouseReached = true;
    mode = "ending";
    stateTime = 0;
    player.canControl = false;
  }
}

function endingUpdate(dt) {
  const fadeT = THREE.MathUtils.clamp(stateTime / 1.8, 0, 1);
  const ov = ensureFadeOverlay();
  ov.style.opacity = `${fadeT}`;
  if (fadeT >= 1.0 && mode !== "done") {
    mode = "done";
    showEnd("to be continued");
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

  updateWorld(world, dt, t, player, audio);
  tonePass.uniforms.uTime.value = t;
  updateFlameTransfer(t, dt);
  updateLampLightTransfers(t);
  flickerLitLamps(t);

  // ---- player update with state-aware overrides ----
  if (mode === "intro") {
    introUpdate(dt, t);
  } else if (mode === "exploring") {
    player.update(dt, t);
    fallPrevention();
    // auto-light lamp when player steps close to the base
    if (canLightLampNow()) lightNearestLamp();
    // shrine prompt takes priority
    if (canRestoreNow()) {
      showShrinePrompt();
    } else {
      hidePrompt();
    }
    // cliff-edge proximity also triggers the reveal cinematic
    maybeStartFinale();
  } else if (mode === "restoring") {
    player.update(dt, t);
    restoringCameraUpdate(dt, t);
    hidePrompt();
    // when the wave + bridge reform are clearly underway we'll move on,
    // but the resonance ripple onComplete callback also bumps us to ascending.
  } else if (mode === "ascending") {
    player.update(dt, t);
    maybeStartFinale();
    fallPrevention();
    // auto-light lamp when player steps close to the base
    if (canLightLampNow()) lightNearestLamp();
    hidePrompt();
  } else if (mode === "finale") {
    player.update(dt, t);
    finaleUpdate(dt, t);
  } else if (mode === "traversing") {
    // player has control; pads are walkable, lighthouse is the goal
    player.update(dt, t);
    shadowsCooldown = Math.max(0, shadowsCooldown - dt);
    if (shadowsCooldown === 0 && player.position.y < FOG_DEATH_Y) {
      fallToShadows();
    }
    maybeFinishOnLighthouse();
  } else if (mode === "ending") {
    player.update(dt, t);
    endingUpdate(dt);
  } else {
    // "done" — keep updating particles + cloak so the final shot is alive
    player.update(dt, t);
  }
  updatePromptPosition();

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
  const windScale = world.shrine?.isActive() ? 1.3 : 1.0;
  const wind = computeGlobalWind(t, player.velocity, windScale);
  sand.update(dt, t, wind, camera, player);
  flowers.update(dt);
  resonance.update(dt, t);
  audio.update(dt, t, {
    speed: player.currentSpeed,
    sliding: player.sliding,
    archProximity: world.shrine?.isActive() ? 1.0 : 0.0,
  });

  // restoration animation drivers (cliff props)
  if (
    mode === "restoring" || mode === "ascending" || mode === "finale" ||
    mode === "traversing" || mode === "ending" || mode === "done"
  ) {
    const since = (mode === "restoring") ? stateTime : Math.max(stateTime + 6, 6);
    world.cliffs?.setRestoring(THREE.MathUtils.clamp(since / 2.5, 0, 1));
    world.cliffs?.setBridgeReformProgress(THREE.MathUtils.clamp((since - 0.4) / 3.5, 0, 1));
    // wind bridge: starts forming after restoration ripple has covered
    // the island (~5s in restoring), then completes during ascending.
    // Once finale fires we lock it at 1 so the pads stay walkable for
    // traversing/ending no matter how stateTime resets between modes.
    let wbT;
    if (mode === "restoring") {
      wbT = THREE.MathUtils.clamp((stateTime - 4.0) / 4.0, 0, 1);
    } else if (mode === "ascending") {
      wbT = THREE.MathUtils.clamp(1.0 + stateTime / 6.0, 0, 1);
    } else {
      wbT = 1;
    }
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
  // keep bloom at half-res
  bloom.setSize(w * 0.5, h * 0.5);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
});

// ---- kick off ----
loading?.classList.add("gone");
animate();
