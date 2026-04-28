import * as THREE from 'three';
import { applyWind, tickWindMaterials } from './shaders.js';

const TERRAIN_SIZE = 220;

export function buildWorld(scene) {
  const windMats = [];

  // ------- Ground -------
  const groundGeo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, 128, 128);
  groundGeo.rotateX(-Math.PI / 2);

  // Gentle terrain undulation (and a hill at the goal)
  const positions = groundGeo.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const z = positions.getZ(i);

    let y = 0;
    // Soft rolling
    y += Math.sin(x * 0.05) * 0.6;
    y += Math.cos(z * 0.07) * 0.5;
    y += Math.sin((x + z) * 0.03) * 0.4;

    // Hill at the goal location (x=0, z=-60)
    const dx = x - 0;
    const dz = z - (-60);
    const distHill = Math.sqrt(dx * dx + dz * dz);
    y += Math.exp(-distHill * distHill / 380) * 4.5;

    // Flatten the path corridor (z from 60 down to -60, x near 0)
    const corridor = Math.exp(-(x * x) / 22);
    y *= 1.0 - corridor * 0.6;

    positions.setY(i, y);
  }
  groundGeo.computeVertexNormals();

  // Two-tone ground using vertex color
  const colors = new Float32Array(positions.count * 3);
  const cGreen = new THREE.Color(0x6e8c4a);
  const cWarm = new THREE.Color(0xb89456);
  const cDark = new THREE.Color(0x47572d);
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    const noise =
      Math.sin(x * 0.18) * 0.5 +
      Math.cos(z * 0.21) * 0.5 +
      Math.sin((x + z) * 0.07) * 0.3;
    const t = (noise + 1.5) / 3;
    const tmp = new THREE.Color().lerpColors(cDark, cGreen, t);
    tmp.lerp(cWarm, Math.max(0, Math.sin(x * 0.04) * 0.3));
    colors[i * 3 + 0] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  groundGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const groundMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0.0,
    flatShading: false,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.receiveShadow = true;
  scene.add(ground);

  // Helper to sample terrain height
  function heightAt(x, z) {
    let y = 0;
    y += Math.sin(x * 0.05) * 0.6;
    y += Math.cos(z * 0.07) * 0.5;
    y += Math.sin((x + z) * 0.03) * 0.4;
    const dx = x - 0;
    const dz = z - (-60);
    const distHill = Math.sqrt(dx * dx + dz * dz);
    y += Math.exp(-distHill * distHill / 380) * 4.5;
    const corridor = Math.exp(-(x * x) / 22);
    y *= 1.0 - corridor * 0.6;
    return y;
  }

  // ------- Trees (instanced low-poly cones) -------
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.28, 1.6, 6);
  trunkGeo.translate(0, 0.8, 0);
  const trunkMat = new THREE.MeshStandardMaterial({
    color: 0x4a3322,
    roughness: 0.9,
    flatShading: true,
  });

  // Foliage - stacked cones for stylized look
  const foliageMat = new THREE.MeshStandardMaterial({
    color: 0x6f8f4a,
    roughness: 0.9,
    flatShading: true,
  });
  applyWind(foliageMat, { windStrength: 1.0, windFreq: 0.8, anchorY: 1.3 });
  windMats.push(foliageMat);

  const foliageMatWarm = foliageMat.clone();
  foliageMatWarm.color = new THREE.Color(0x9b7f3c);
  applyWind(foliageMatWarm, { windStrength: 1.1, windFreq: 0.7, anchorY: 1.3 });
  windMats.push(foliageMatWarm);

  const foliageMatDark = foliageMat.clone();
  foliageMatDark.color = new THREE.Color(0x4f7240);
  applyWind(foliageMatDark, { windStrength: 0.9, windFreq: 0.85, anchorY: 1.3 });
  windMats.push(foliageMatDark);

  const foliageGeo = new THREE.ConeGeometry(1.5, 3.0, 7);
  foliageGeo.translate(0, 2.6, 0);

  // Build clusters of trees, leaving the corridor clear
  const trees = new THREE.Group();
  scene.add(trees);

  function plantTree(x, z, scale, mat) {
    const y = heightAt(x, z);
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.set(x, y, z);
    trunk.scale.setScalar(scale);
    trunk.castShadow = true;
    trunk.receiveShadow = false;

    // Stack 2-3 cones for layered foliage
    const layers = 2 + Math.floor(Math.random() * 2);
    const folGroup = new THREE.Group();
    folGroup.position.set(x, y, z);
    for (let i = 0; i < layers; i++) {
      const fol = new THREE.Mesh(foliageGeo, mat);
      const layerScale = scale * (1 - i * 0.18);
      fol.scale.setScalar(layerScale);
      fol.position.y = i * scale * 0.9;
      fol.rotation.y = Math.random() * Math.PI * 2;
      fol.castShadow = true;
      folGroup.add(fol);
    }

    // Random rotation/lean
    trunk.rotation.y = Math.random() * Math.PI * 2;
    folGroup.rotation.y = Math.random() * Math.PI * 2;

    trees.add(trunk);
    trees.add(folGroup);
  }

  // Random scatter trees, but avoid the corridor
  const rng = mulberry32(12345);
  const mats = [foliageMat, foliageMatDark, foliageMatWarm];
  let placed = 0;
  let tries = 0;
  while (placed < 220 && tries < 5000) {
    tries++;
    const x = (rng() - 0.5) * (TERRAIN_SIZE - 30);
    const z = (rng() - 0.5) * (TERRAIN_SIZE - 30);

    // Keep central corridor clear
    if (Math.abs(x) < 6 && z > -55 && z < 65) continue;
    // Keep area around the goal hill clear (the lone tree is special)
    if (Math.hypot(x, z + 60) < 12) continue;

    const scale = 0.9 + rng() * 1.4;
    const mat = mats[Math.floor(rng() * mats.length)];
    plantTree(x, z, scale, mat);
    placed++;
  }

  // Cluster of denser grove around mid-point for light shafts
  for (let i = 0; i < 24; i++) {
    const angle = rng() * Math.PI * 2;
    const r = 9 + rng() * 6;
    const x = Math.cos(angle) * r + (rng() - 0.5) * 4;
    const z = -10 + Math.sin(angle) * r + (rng() - 0.5) * 4;
    if (Math.abs(x) < 5) continue;
    plantTree(x, z, 1.4 + rng() * 0.8, mats[Math.floor(rng() * mats.length)]);
  }

  // ------- The lone tree at the goal (focal point) -------
  const loneFoliageMat = foliageMat.clone();
  loneFoliageMat.color = new THREE.Color(0xc89858);
  loneFoliageMat.emissive = new THREE.Color(0x331a08);
  loneFoliageMat.emissiveIntensity = 0.4;
  applyWind(loneFoliageMat, { windStrength: 0.7, windFreq: 0.6, anchorY: 1.3 });
  windMats.push(loneFoliageMat);

  const loneTrunkGeo = new THREE.CylinderGeometry(0.5, 0.9, 5.5, 8);
  loneTrunkGeo.translate(0, 2.7, 0);
  const loneTrunkMat = new THREE.MeshStandardMaterial({
    color: 0x3a261a,
    roughness: 0.85,
    flatShading: true,
  });
  const loneTrunk = new THREE.Mesh(loneTrunkGeo, loneTrunkMat);
  const goalY = heightAt(0, -60);
  loneTrunk.position.set(0, goalY, -60);
  loneTrunk.castShadow = true;
  scene.add(loneTrunk);

  // Layered crown (bigger, fuller)
  const loneCrown = new THREE.Group();
  loneCrown.position.set(0, goalY, -60);
  for (let i = 0; i < 5; i++) {
    const fol = new THREE.Mesh(foliageGeo, loneFoliageMat);
    const s = 3.4 - i * 0.4;
    fol.scale.setScalar(s);
    fol.position.y = 4.0 + i * 1.6;
    fol.rotation.y = Math.random() * Math.PI * 2;
    fol.castShadow = true;
    loneCrown.add(fol);
  }
  scene.add(loneCrown);

  // Soft light at the lone tree (warm point light)
  const treeLight = new THREE.PointLight(0xffae5b, 1.4, 30, 1.6);
  treeLight.position.set(0, goalY + 6, -60);
  scene.add(treeLight);

  // ------- Grass blades (instanced) -------
  const bladeGeo = new THREE.PlaneGeometry(0.06, 0.55, 1, 3);
  bladeGeo.translate(0, 0.275, 0);
  const grassMat = new THREE.MeshStandardMaterial({
    color: 0x7ba74a,
    side: THREE.DoubleSide,
    roughness: 1,
    metalness: 0,
    flatShading: true,
  });
  applyWind(grassMat, { windStrength: 1.3, windFreq: 1.4, anchorY: 0 });
  windMats.push(grassMat);

  const GRASS_COUNT = 9000;
  const grass = new THREE.InstancedMesh(bladeGeo, grassMat, GRASS_COUNT);
  grass.castShadow = false;
  grass.receiveShadow = true;
  const dummy = new THREE.Object3D();
  const tmpColor = new THREE.Color();
  const grassWarm = new THREE.Color(0xc7a25c);
  const grassGreen = new THREE.Color(0x88b95a);
  const grassDeep = new THREE.Color(0x4a6b2c);
  for (let i = 0; i < GRASS_COUNT; i++) {
    const x = (rng() - 0.5) * (TERRAIN_SIZE - 6);
    const z = (rng() - 0.5) * (TERRAIN_SIZE - 6);
    const y = heightAt(x, z);
    dummy.position.set(x, y, z);
    dummy.rotation.y = rng() * Math.PI * 2;
    const s = 0.7 + rng() * 1.3;
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    grass.setMatrixAt(i, dummy.matrix);

    const t = rng();
    if (t < 0.3) tmpColor.copy(grassWarm).lerp(grassGreen, rng());
    else if (t < 0.7) tmpColor.copy(grassGreen);
    else tmpColor.copy(grassDeep).lerp(grassGreen, rng());
    grass.setColorAt(i, tmpColor);
  }
  grass.instanceMatrix.needsUpdate = true;
  if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
  scene.add(grass);

  // ------- Wildflowers (small spheres of color scattered) -------
  const flowerGeo = new THREE.IcosahedronGeometry(0.07, 0);
  const flowerMatA = new THREE.MeshStandardMaterial({
    color: 0xfff1b8,
    emissive: 0xffd070,
    emissiveIntensity: 0.6,
    roughness: 0.6,
    flatShading: true,
  });
  const flowerMatB = new THREE.MeshStandardMaterial({
    color: 0xffd0e0,
    emissive: 0xff80a0,
    emissiveIntensity: 0.4,
    roughness: 0.6,
    flatShading: true,
  });
  const flowerMatC = new THREE.MeshStandardMaterial({
    color: 0xc8d0ff,
    emissive: 0x7080ff,
    emissiveIntensity: 0.4,
    roughness: 0.6,
    flatShading: true,
  });
  const flowerMats = [flowerMatA, flowerMatB, flowerMatC];

  for (let i = 0; i < 600; i++) {
    const x = (rng() - 0.5) * (TERRAIN_SIZE - 10);
    const z = (rng() - 0.5) * (TERRAIN_SIZE - 10);
    if (Math.abs(x) < 4 && z > -55 && z < 55) {
      // sparser in the corridor
      if (rng() > 0.25) continue;
    }
    const y = heightAt(x, z);
    const flower = new THREE.Mesh(flowerGeo, flowerMats[Math.floor(rng() * 3)]);
    flower.position.set(x, y + 0.08, z);
    flower.scale.setScalar(0.7 + rng() * 0.8);
    scene.add(flower);
  }

  // ------- Distant mountain silhouettes (purely visual) -------
  const mountainGeo = new THREE.ConeGeometry(60, 40, 4);
  const mountainMat = new THREE.MeshBasicMaterial({
    color: 0x7a6080,
    fog: true,
  });
  for (let i = 0; i < 9; i++) {
    const angle = (i / 9) * Math.PI * 2;
    const r = 380;
    const m = new THREE.Mesh(mountainGeo, mountainMat);
    m.position.set(Math.cos(angle) * r, -8, Math.sin(angle) * r);
    m.rotation.y = rng() * Math.PI;
    m.scale.set(1 + rng() * 0.6, 0.7 + rng() * 0.6, 1 + rng() * 0.6);
    scene.add(m);
  }

  return {
    heightAt,
    update(t, dt) {
      tickWindMaterials(windMats, t);
      // Subtle pulse on the lone tree light
      treeLight.intensity = 1.3 + Math.sin(t * 0.7) * 0.2;
    },
  };
}

// Seeded PRNG so the world looks the same each load
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
