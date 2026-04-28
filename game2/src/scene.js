import * as THREE from "three";
import { buildGrass } from "./grass.js";
import { buildTrees } from "./trees.js";
import { buildFireflies, buildDust } from "./particles.js";
import {
  foliageFragmentShader,
  foliageVertexShader,
} from "./shaders.js";

// soft golden-hour palette
const palette = {
  sky: new THREE.Color("#f3a96a"),
  skyHigh: new THREE.Color("#553560"),
  fog: new THREE.Color("#e8a373"),
  ground: new THREE.Color("#3a2a1c"),
  grassBase: new THREE.Color("#5a4220"),
  grassTip: new THREE.Color("#e9b870"),
  grassWarm: new THREE.Color("#ffd58a"),
  treeFoliage: new THREE.Color("#33301c"),
  treeFoliageWarm: new THREE.Color("#a48040"),
  trunk: new THREE.Color("#1a120a"),
  lantern: new THREE.Color("#ffcd86"),
};

const sunDir = new THREE.Vector3(-0.55, 0.18, -0.8).normalize();

export function buildWorld(scene) {
  scene.background = palette.sky;
  scene.fog = new THREE.Fog(palette.fog, 18, 110);

  // ---- sky dome with vertical gradient ----
  const skyGeo = new THREE.SphereGeometry(280, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      uColorLow: { value: palette.fog },
      uColorMid: { value: palette.sky },
      uColorHigh: { value: palette.skyHigh },
      uSunDir: { value: sunDir },
      uTime: { value: 0 },
    },
    vertexShader: `
      varying vec3 vWorldDir;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldDir = normalize(wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform vec3 uColorLow;
      uniform vec3 uColorMid;
      uniform vec3 uColorHigh;
      uniform vec3 uSunDir;
      varying vec3 vWorldDir;
      void main(){
        float h = clamp(vWorldDir.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 col = mix(uColorLow, uColorMid, smoothstep(0.0, 0.4, h));
        col = mix(col, uColorHigh, smoothstep(0.45, 0.95, h));
        // sun glow
        float sun = max(dot(normalize(vWorldDir), normalize(uSunDir)), 0.0);
        col += vec3(1.0, 0.7, 0.45) * pow(sun, 32.0) * 0.9;
        col += vec3(1.0, 0.6, 0.3) * pow(sun, 4.0) * 0.18;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  scene.add(sky);

  // ---- lights ----
  const sun = new THREE.DirectionalLight(0xffd5a0, 1.6);
  sun.position.copy(sunDir).multiplyScalar(60);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = 60;
  sun.shadow.camera.left = -s;
  sun.shadow.camera.right = s;
  sun.shadow.camera.top = s;
  sun.shadow.camera.bottom = -s;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 200;
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  scene.add(sun.target);

  const hemi = new THREE.HemisphereLight(0xffd0a0, 0x1a1410, 0.45);
  scene.add(hemi);

  // ---- ground ----
  const groundGeo = new THREE.PlaneGeometry(260, 260, 200, 200);
  groundGeo.rotateX(-Math.PI / 2);

  // gentle noise displacement on ground
  {
    const pos = groundGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      // keep path flat
      const distFromPath = Math.abs(x);
      const pathFlat = Math.exp(-distFromPath * distFromPath * 0.12);
      const n =
        Math.sin(x * 0.15) * 0.35 +
        Math.cos(z * 0.13 + x * 0.04) * 0.4 +
        Math.sin((x + z) * 0.08) * 0.25;
      pos.setY(i, n * (1 - pathFlat * 0.85));
    }
    groundGeo.computeVertexNormals();
  }

  const groundMat = new THREE.MeshStandardMaterial({
    color: palette.ground,
    roughness: 1.0,
    metalness: 0.0,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.receiveShadow = true;
  scene.add(ground);

  // ---- trees + grass + particles ----
  const trees = buildTrees(scene, palette, sunDir);
  const grass = buildGrass(scene, palette, sunDir);
  const fireflies = buildFireflies(scene);
  const dust = buildDust(scene, sunDir);

  // ---- guiding path lights ----
  const pathStones = [];
  for (let i = 0; i < 12; i++) {
    const z = 14 - i * 2.6;
    const stoneGeo = new THREE.IcosahedronGeometry(0.18, 0);
    const stoneMat = new THREE.MeshStandardMaterial({
      color: 0xffc98a,
      emissive: 0xff9a55,
      emissiveIntensity: 1.4,
      roughness: 0.6,
    });
    const stone = new THREE.Mesh(stoneGeo, stoneMat);
    const offsetX = Math.sin(i * 0.7) * 0.3;
    stone.position.set(offsetX, 0.18, z);
    stone.userData.basePos = stone.position.clone();
    stone.userData.phase = i * 0.6;
    scene.add(stone);

    // tiny point light at every other stone
    if (i % 2 === 0) {
      const pl = new THREE.PointLight(0xffb070, 0.6, 4.5, 1.4);
      pl.position.copy(stone.position).add(new THREE.Vector3(0, 0.3, 0));
      stone.userData.light = pl;
      scene.add(pl);
    }
    pathStones.push(stone);
  }

  // ---- the lantern (the goal) ----
  const lanternGroup = new THREE.Group();
  lanternGroup.position.set(0, 0, -22);

  const postGeo = new THREE.CylinderGeometry(0.05, 0.07, 2.2, 8);
  const postMat = new THREE.MeshStandardMaterial({
    color: 0x1a120a,
    roughness: 1.0,
  });
  const post = new THREE.Mesh(postGeo, postMat);
  post.position.y = 1.1;
  post.castShadow = true;
  lanternGroup.add(post);

  const cageGeo = new THREE.IcosahedronGeometry(0.32, 0);
  const cageMat = new THREE.MeshStandardMaterial({
    color: 0xffe0a8,
    emissive: 0xffb060,
    emissiveIntensity: 3.5,
    roughness: 0.4,
  });
  const cage = new THREE.Mesh(cageGeo, cageMat);
  cage.position.y = 2.2;
  lanternGroup.add(cage);

  const lanternLight = new THREE.PointLight(0xffb070, 4.0, 22, 1.6);
  lanternLight.position.set(0, 2.3, 0);
  lanternLight.castShadow = true;
  lanternLight.shadow.mapSize.set(512, 512);
  lanternGroup.add(lanternLight);

  scene.add(lanternGroup);

  // ---- god-ray cones (cheap fake) ----
  const rays = [];
  for (let i = 0; i < 5; i++) {
    const rayGeo = new THREE.ConeGeometry(2 + i * 0.5, 30, 16, 1, true);
    const rayMat = new THREE.MeshBasicMaterial({
      color: 0xffd28a,
      transparent: true,
      opacity: 0.045,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const ray = new THREE.Mesh(rayGeo, rayMat);
    ray.position.set(-22 + i * 4, 12, -10 - i * 6);
    ray.rotation.z = sunDir.x * 0.6;
    ray.rotation.x = 0.2;
    rays.push(ray);
    scene.add(ray);
  }

  // ---- distant background tree ring (fake depth) ----
  const ringGroup = new THREE.Group();
  const silMat = new THREE.MeshBasicMaterial({
    color: palette.fog,
    transparent: true,
    opacity: 0.6,
    fog: true,
  });
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    const r = 95 + Math.random() * 18;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const h = 5 + Math.random() * 8;
    const w = 1 + Math.random() * 2.5;
    const g = new THREE.PlaneGeometry(w, h);
    const m = new THREE.Mesh(g, silMat);
    m.position.set(x, h / 2, z);
    m.lookAt(0, h / 2, 0);
    ringGroup.add(m);
  }
  scene.add(ringGroup);

  // ---- birds (simple instanced V's drifting in distance) ----
  const birdsGroup = new THREE.Group();
  const birdMat = new THREE.MeshBasicMaterial({ color: 0x1a1208, fog: true });
  const birds = [];
  for (let i = 0; i < 8; i++) {
    const g = makeBirdGeometry();
    const m = new THREE.Mesh(g, birdMat);
    m.position.set(
      -40 + Math.random() * 80,
      18 + Math.random() * 12,
      -40 + Math.random() * 30,
    );
    m.userData.speed = 0.6 + Math.random() * 0.5;
    m.userData.phase = Math.random() * Math.PI * 2;
    birdsGroup.add(m);
    birds.push(m);
  }
  scene.add(birdsGroup);

  // ---- expose API ----
  const update = (dt, t, camPos) => {
    skyMat.uniforms.uTime.value = t;
    grass.update(dt, t, camPos);
    trees.update(dt, t, camPos);
    fireflies.update(dt, t);
    dust.update(dt, t, camPos);

    // pulse path stones gently
    for (const stone of pathStones) {
      const p = stone.userData.phase + t * 1.2;
      const pulse = 0.85 + Math.sin(p) * 0.15;
      stone.material.emissiveIntensity = 1.2 * pulse;
      if (stone.userData.light) {
        stone.userData.light.intensity = 0.55 * pulse;
      }
      stone.position.y =
        stone.userData.basePos.y + Math.sin(t * 1.4 + stone.userData.phase) * 0.015;
    }

    // lantern flicker
    const flick = 0.92 + Math.sin(t * 7.2) * 0.04 + Math.sin(t * 13.7) * 0.04;
    lanternLight.intensity = 4.0 * flick;
    cage.material.emissiveIntensity = 3.4 * flick;
    cage.rotation.y += dt * 0.2;

    // birds
    for (const b of birds) {
      b.position.x += Math.sin(b.userData.phase + t * 0.4) * dt * b.userData.speed * 1.2;
      b.position.z += dt * b.userData.speed * 0.4;
      if (b.position.z > 30) b.position.z = -45;
      // flap
      const flap = Math.sin(t * 8 + b.userData.phase) * 0.3;
      b.rotation.z = flap;
    }
  };

  return {
    update,
    lantern: lanternGroup,
    sun,
  };
}

function makeBirdGeometry() {
  const g = new THREE.BufferGeometry();
  // a tiny V
  const verts = new Float32Array([
    -0.4, 0, 0,
    0, 0.05, 0.1,
    0.4, 0, 0,
  ]);
  g.setAttribute("position", new THREE.BufferAttribute(verts, 3));
  g.setIndex([0, 1, 2]);
  g.computeVertexNormals();
  return g;
}
