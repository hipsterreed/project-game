import * as THREE from "three";
import {
  foliageFragmentShader,
  foliageVertexShader,
} from "./shaders.js";

export function buildTrees(scene, palette, sunDir) {
  const group = new THREE.Group();
  scene.add(group);

  const trunkMat = new THREE.MeshStandardMaterial({
    color: palette.trunk,
    roughness: 1.0,
  });

  // each foliage cluster gets its own ShaderMaterial instance so uniforms update together
  const foliageUniforms = {
    uTime: { value: 0 },
    uWindStrength: { value: 0.55 },
    uColor: { value: palette.treeFoliage },
    uColorWarm: { value: palette.treeFoliageWarm },
    uFogColor: { value: palette.fog },
    uFogNear: { value: 18 },
    uFogFar: { value: 110 },
    uCameraPos: { value: new THREE.Vector3() },
    uSunDir: { value: sunDir },
  };

  const foliageMat = new THREE.ShaderMaterial({
    vertexShader: foliageVertexShader,
    fragmentShader: foliageFragmentShader,
    uniforms: foliageUniforms,
  });

  // tree placement — avoid path corridor
  const placements = [];
  const TARGET = 80;
  let attempts = 0;
  while (placements.length < TARGET && attempts < TARGET * 12) {
    attempts++;
    const r = 12 + Math.random() * 60;
    const a = Math.random() * Math.PI * 2;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (Math.abs(x) < 4 && z < 20 && z > -28) continue;
    // not too clumpy
    let tooClose = false;
    for (const p of placements) {
      const dx = p.x - x;
      const dz = p.z - z;
      if (dx * dx + dz * dz < 9) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;
    placements.push({ x, z, scale: 0.85 + Math.random() * 1.4, seed: Math.random() });
  }

  for (const p of placements) {
    const tree = makeTree(p, trunkMat, foliageMat);
    group.add(tree);
  }

  const update = (dt, t, camPos) => {
    foliageUniforms.uTime.value = t;
    foliageUniforms.uCameraPos.value.copy(camPos);
    const gust = 0.45 + Math.sin(t * 0.18) * 0.18 + Math.sin(t * 0.05) * 0.1;
    foliageUniforms.uWindStrength.value = gust;
  };

  return { group, update };
}

function makeTree(p, trunkMat, foliageMat) {
  const g = new THREE.Group();
  g.position.set(p.x, 0, p.z);

  const trunkH = 4.5 * p.scale;
  const trunkR = 0.18 * p.scale;
  const trunkGeo = new THREE.CylinderGeometry(trunkR * 0.7, trunkR, trunkH, 7);
  // slight twist
  trunkGeo.translate(0, trunkH / 2, 0);
  const trunk = new THREE.Mesh(trunkGeo, trunkMat);
  trunk.castShadow = true;
  g.add(trunk);

  // foliage: 3-5 icosahedra clusters near top
  const clusters = 3 + Math.floor(p.seed * 3);
  for (let i = 0; i < clusters; i++) {
    const r = (1.0 + Math.random() * 0.8) * p.scale;
    const fGeo = new THREE.IcosahedronGeometry(r, 0);
    // jitter vertices a touch for organic feel
    const pos = fGeo.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      pos.setXYZ(
        v,
        pos.getX(v) * (0.9 + Math.random() * 0.25),
        pos.getY(v) * (0.85 + Math.random() * 0.3),
        pos.getZ(v) * (0.9 + Math.random() * 0.25),
      );
    }
    fGeo.computeVertexNormals();

    const f = new THREE.Mesh(fGeo, foliageMat);
    const angle = (i / clusters) * Math.PI * 2 + Math.random();
    const rad = 0.35 * p.scale;
    f.position.set(
      Math.cos(angle) * rad,
      trunkH + (i - clusters / 2) * 0.4 * p.scale + r * 0.3,
      Math.sin(angle) * rad,
    );
    f.castShadow = true;
    g.add(f);
  }

  // slight tilt
  g.rotation.y = p.seed * Math.PI * 2;
  g.rotation.z = (Math.random() - 0.5) * 0.06;

  return g;
}
