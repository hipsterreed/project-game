import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

import { buildWorld } from "./scene.js";
import { Player } from "./player.js";
import { Audio } from "./audio.js";
import { ToneMapShader } from "./shaders.js";

const app = document.getElementById("app");
const titleEl = document.getElementById("title");
const beginBtn = document.getElementById("beginBtn");
const hud = document.getElementById("hud");
const prompt = document.getElementById("prompt");
const ending = document.getElementById("ending");
const loading = document.getElementById("loading");

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  62,
  window.innerWidth / window.innerHeight,
  0.05,
  500,
);
camera.position.set(0, 1.65, 18);

const world = buildWorld(scene);
const player = new Player(camera, world);
const audio = new Audio(camera);

// ---- post-processing ----
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.55, // strength
  0.85, // radius
  0.78, // threshold
);
composer.addPass(bloom);

const tonePass = new ShaderPass(ToneMapShader);
composer.addPass(tonePass);

composer.addPass(new OutputPass());

// ---- main menu camera flythrough ----
let mode = "menu"; // "menu" | "intro" | "playing" | "ending"
let menuTime = 0;
const menuPath = (t) => {
  // gentle drifting camera around the starting area
  const r = 12;
  const x = Math.sin(t * 0.07) * r * 0.6;
  const z = 22 + Math.cos(t * 0.05) * 6;
  const y = 1.85 + Math.sin(t * 0.13) * 0.15;
  return new THREE.Vector3(x, y, z);
};

const startPos = new THREE.Vector3(0, 1.65, 18);
const startLookAt = new THREE.Vector3(0, 1.65, -22); // toward the lantern
let intro = null;

beginBtn.addEventListener("click", async () => {
  await audio.init();
  audio.startAmbience();
  titleEl.classList.add("hidden");
  mode = "intro";

  // capture current camera state so the glide is continuous
  const fromPos = camera.position.clone();
  const fromQuat = camera.quaternion.clone();

  // compute the destination orientation by briefly placing the *real* camera
  // at the start and using its lookAt (cameras have flipped lookAt vs Object3D).
  const savedPos = camera.position.clone();
  camera.position.copy(startPos);
  camera.lookAt(startLookAt);
  const toQuat = camera.quaternion.clone();
  camera.position.copy(savedPos);
  camera.quaternion.copy(fromQuat);

  intro = {
    fromPos,
    toPos: startPos.clone(),
    fromQuat,
    toQuat,
    t: 0,
    duration: 3.6,
  };

  // grab pointer-lock during the user gesture; freeze mouse-look until handoff
  player.frozen = true;
  player.lock();
});

let promptTimer = null;
function showPrompt(text) {
  prompt.textContent = text;
  prompt.classList.add("show");
  if (promptTimer) clearTimeout(promptTimer);
}
function hidePrompt() {
  prompt.classList.remove("show");
}

// ---- arrival / ending ----
let arrived = false;
function checkArrival() {
  const goal = world.lantern.position;
  const dx = camera.position.x - goal.x;
  const dz = camera.position.z - goal.z;
  const dist = Math.sqrt(dx * dx + dz * dz);

  // progress 0..1 from start (z ~= 18) toward lantern
  const startZ = 18;
  const totalDist = startZ - goal.z;
  const traveled = startZ - camera.position.z;
  const progress = Math.max(0, Math.min(1, traveled / totalDist));
  audio.setProgress(progress);

  if (!arrived && dist < 2.4) {
    arrived = true;
    triggerEnding();
  }
}

function triggerEnding() {
  audio.swell();
  player.cinematicLockOn(world.lantern.position);
  setTimeout(() => {
    ending.classList.add("show");
  }, 4500);
  setTimeout(() => {
    audio.fadeOut(6);
  }, 7000);
}

// ---- resize ----
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// ---- main loop ----
const clock = new THREE.Clock();
function loop() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  world.update(dt, t, camera.position);

  if (mode === "menu") {
    menuTime += dt;
    const p = menuPath(menuTime);
    camera.position.lerp(p, 0.02);
    camera.lookAt(world.lantern.position.x, 1.6, world.lantern.position.z);
  } else if (mode === "intro" && intro) {
    intro.t = Math.min(intro.t + dt, intro.duration);
    const k = intro.t / intro.duration;
    // ease-in-out cubic
    const ease = k < 0.5
      ? 4 * k * k * k
      : 1 - Math.pow(-2 * k + 2, 3) / 2;

    camera.position.lerpVectors(intro.fromPos, intro.toPos, ease);
    camera.quaternion.copy(intro.fromQuat).slerp(intro.toQuat, ease);

    if (intro.t >= intro.duration) {
      // hand off to the player at the matching yaw/pitch
      const e = new THREE.Euler().setFromQuaternion(camera.quaternion, "YXZ");
      player.position.copy(camera.position);
      player.position.y = 0; // player.position is on the ground; eye height is added in update
      player.yaw = e.y;
      player.pitch = e.x;
      player.targetYaw = e.y;
      player.targetPitch = e.x;
      mode = "playing";
      hud.classList.add("visible");
      player.frozen = false;
      setTimeout(() => {
        showPrompt("walk forward");
        setTimeout(() => hidePrompt(), 4000);
      }, 600);
      intro = null;
    }
  } else if (mode === "playing") {
    player.update(dt, audio);
    checkArrival();
  } else if (mode === "ending") {
    player.update(dt, audio);
  }

  audio.update(dt, camera.position, player.velocity);

  composer.render();
  requestAnimationFrame(loop);
}

// fade loading away once first frame is ready
requestAnimationFrame(() => {
  loop();
  setTimeout(() => loading.classList.add("gone"), 200);
});
