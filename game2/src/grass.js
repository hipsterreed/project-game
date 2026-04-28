import * as THREE from "three";
import { grassFragmentShader, grassVertexShader } from "./shaders.js";

export function buildGrass(scene, palette, sunDir) {
  // Single curved blade geometry
  const bladeHeight = 0.55;
  const bladeWidth = 0.045;
  const segments = 4;

  const bladeGeo = new THREE.BufferGeometry();
  const verts = [];
  const indices = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const w = bladeWidth * (1 - t * 0.85);
    const y = t * bladeHeight;
    verts.push(-w, y, 0, w, y, 0);
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2);
    indices.push(a + 1, a + 3, a + 2);
  }
  bladeGeo.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(verts, 3),
  );
  bladeGeo.setIndex(indices);

  // Distribute grass on a disc, sparser near path, denser farther
  const COUNT = 14000;
  const radius = 70;
  const offsets = new Float32Array(COUNT * 3);
  const scales = new Float32Array(COUNT);
  const rots = new Float32Array(COUNT);
  const variants = new Float32Array(COUNT);

  let placed = 0;
  let attempts = 0;
  while (placed < COUNT && attempts < COUNT * 6) {
    attempts++;
    const r = Math.sqrt(Math.random()) * radius;
    const a = Math.random() * Math.PI * 2;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    // skip if too close to path corridor
    if (Math.abs(x) < 1.4 && z < 18 && z > -24) continue;
    // skip too close to lantern
    const dx = x - 0;
    const dz = z - -22;
    if (Math.sqrt(dx * dx + dz * dz) < 1.6) continue;

    offsets[placed * 3] = x;
    offsets[placed * 3 + 1] = 0;
    offsets[placed * 3 + 2] = z;
    scales[placed] = 0.7 + Math.random() * 0.7;
    rots[placed] = Math.random() * Math.PI;
    variants[placed] = Math.random();
    placed++;
  }

  const inst = new THREE.InstancedBufferGeometry();
  inst.index = bladeGeo.index;
  inst.attributes.position = bladeGeo.attributes.position;
  inst.setAttribute(
    "instanceOffset",
    new THREE.InstancedBufferAttribute(offsets, 3),
  );
  inst.setAttribute(
    "instanceScale",
    new THREE.InstancedBufferAttribute(scales, 1),
  );
  inst.setAttribute(
    "instanceRot",
    new THREE.InstancedBufferAttribute(rots, 1),
  );
  inst.setAttribute(
    "instanceVariant",
    new THREE.InstancedBufferAttribute(variants, 1),
  );
  inst.instanceCount = placed;

  const uniforms = {
    uTime: { value: 0 },
    uWindStrength: { value: 0.65 },
    uPlayerPos: { value: new THREE.Vector3() },
    uColorBase: { value: palette.grassBase },
    uColorTip: { value: palette.grassTip },
    uColorWarm: { value: palette.grassWarm },
    uFogColor: { value: palette.fog },
    uFogNear: { value: 18 },
    uFogFar: { value: 90 },
    uCameraPos: { value: new THREE.Vector3() },
    uSunDir: { value: sunDir },
  };

  const mat = new THREE.ShaderMaterial({
    vertexShader: grassVertexShader,
    fragmentShader: grassFragmentShader,
    uniforms,
    side: THREE.DoubleSide,
    transparent: false,
  });

  const mesh = new THREE.Mesh(inst, mat);
  mesh.frustumCulled = false;
  scene.add(mesh);

  let windPulse = 0;
  const update = (dt, t, camPos) => {
    uniforms.uTime.value = t;
    uniforms.uCameraPos.value.copy(camPos);
    uniforms.uPlayerPos.value.copy(camPos);
    // gentle gusts
    windPulse += dt;
    const gust = 0.6 + Math.sin(t * 0.21) * 0.18 + Math.sin(t * 0.07) * 0.12;
    uniforms.uWindStrength.value = gust;
  };

  return { mesh, update };
}
