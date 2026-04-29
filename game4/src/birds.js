import * as THREE from "three";

/* -----------------------------------------------------------
 * Birds — a small flock circling overhead. Each bird is a tiny
 *   instanced V-shape; circling on a slow ellipse with a sine
 *   wing-flap deformation done per-frame on the matrix. Cheap.
 *
 *   Returns:  { group, birds, update(dt, t) }
 * --------------------------------------------------------- */

const BIRD_COUNT = 5;

export function buildBirds() {
  const group = new THREE.Group();

  // ---- one "V" geometry, two thin wing planes joined at the body ----
  // Each wing is a long thin triangle; together they read as a bird
  // silhouette from below/above.
  const birdGeo = new THREE.BufferGeometry();
  const verts = new Float32Array([
    // body / left wing tip / right wing tip
    0,   0,    0,
   -0.55, 0.05, 0.30,
   -0.55, 0.05, -0.30,
    // body / right wing tip / right tail
    0,   0,    0,
    0.55, 0.05, -0.30,
    0.55, 0.05, 0.30,
  ]);
  const idx = new Uint16Array([0, 1, 2, 3, 4, 5]);
  birdGeo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
  birdGeo.setIndex(new THREE.BufferAttribute(idx, 1));
  birdGeo.computeVertexNormals();

  // dark silhouette material — birds read as cutouts against the sunrise sky
  const birdMat = new THREE.MeshBasicMaterial({
    color: 0x2a2018,
    fog: true,
    side: THREE.DoubleSide,
  });

  const birds = [];
  for (let i = 0; i < BIRD_COUNT; i++) {
    const m = new THREE.Mesh(birdGeo, birdMat);
    const orbitR = 32 + i * 18 + Math.random() * 12;
    const orbitY = 26 + i * 4 + Math.random() * 6;
    const phase = Math.random() * Math.PI * 2;
    const speed = 0.18 + Math.random() * 0.10;
    const flapSpeed = 4.5 + Math.random() * 2.5;
    const flapAmp = 0.28 + Math.random() * 0.10;
    const scale = 1.8 + Math.random() * 0.7;
    m.scale.setScalar(scale);
    m.userData = { orbitR, orbitY, phase, speed, flapSpeed, flapAmp };
    group.add(m);
    birds.push(m);
  }

  return { group, birds };
}

export function updateBirds(state, dt, t) {
  for (const m of state.birds) {
    const u = m.userData;
    const ang = u.phase + t * u.speed;
    const x = Math.cos(ang) * u.orbitR;
    const z = Math.sin(ang) * u.orbitR;
    const y = u.orbitY + Math.sin(t * 0.6 + u.phase) * 1.6;
    m.position.set(x, y, z);
    // face along the orbit tangent (heading)
    m.rotation.y = -ang + Math.PI / 2;
    // wing flap — tilt around the heading axis with a sine wave
    const flap = Math.sin(t * u.flapSpeed + u.phase) * u.flapAmp;
    m.rotation.z = flap;
    // tilt slightly into the turn
    m.rotation.x = -0.10;
  }
}
