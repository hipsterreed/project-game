import * as THREE from "three";

/* -----------------------------------------------------------
 * Lantern Shrine — the dormant centerpiece of the island.
 *
 *   The player wakes beside this shrine. It starts dormant
 *   (dim glass, no point light) and is restored when the
 *   player presses E. Built in the same visual language as
 *   the spawn lamp it replaced (warm hooked-pole lantern)
 *   but bigger, on a 3-step stone dais, so it reads as a
 *   sacred object the world has been built around.
 *
 *   Returns:
 *     {
 *       group,       // THREE.Group — drop into the scene
 *       activate(t), // begins the restoration: glass brightens,
 *                    // point light rises, gentle pulse settles in
 *       update(dt,t),// per-frame flicker / pulse
 *       isActive(),  // boolean
 *       worldPos(),  // Vector3 of the lantern's lit core (for
 *                    // distance checks / ripple origin)
 *     }
 * --------------------------------------------------------- */
export function buildShrine() {
  const group = new THREE.Group();

  // ---- materials ----
  const stoneMat = new THREE.MeshStandardMaterial({
    color: 0x6b5240,
    roughness: 0.95,
    metalness: 0.02,
  });
  const stoneCapMat = new THREE.MeshStandardMaterial({
    color: 0x8a6e54,
    roughness: 0.92,
    metalness: 0.02,
  });
  const ironMat = new THREE.MeshStandardMaterial({
    color: 0x3a2618,
    roughness: 0.65,
    metalness: 0.35,
  });

  // ---- 3-step circular stone dais ----
  // tier 0 (largest) sits in the ground; tiers 1, 2 step up like a
  // sacred plinth.
  const tiers = [
    { rT: 2.6,  rB: 2.7, h: 0.32, y: -0.05 },
    { rT: 2.05, rB: 2.18, h: 0.28, y: 0.27 },
    { rT: 1.55, rB: 1.65, h: 0.26, y: 0.55 },
  ];
  const daisTopY = tiers[tiers.length - 1].y + tiers[tiers.length - 1].h;
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i];
    const geo = new THREE.CylinderGeometry(t.rT, t.rB, t.h, 24, 1);
    const mesh = new THREE.Mesh(geo, i === tiers.length - 1 ? stoneCapMat : stoneMat);
    mesh.position.y = t.y + t.h * 0.5;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // ---- carved ring inset on the top tier (additive glow when active) ----
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xffd9a0,
    transparent: true,
    opacity: 0.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const ringGeo = new THREE.RingGeometry(0.95, 1.25, 36, 1);
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = daisTopY + 0.012;
  group.add(ring);

  // ---- the lantern: hooked pole rising from the dais centre ----
  // pole
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.085, 4.2, 8),
    ironMat,
  );
  pole.position.y = daisTopY + 2.1;
  pole.castShadow = true;
  group.add(pole);

  // foot ring (decorative collar at the base)
  const collar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.22, 0.18, 16),
    stoneCapMat,
  );
  collar.position.y = daisTopY + 0.09;
  collar.castShadow = true;
  group.add(collar);

  // hook (a half-torus reaching outward at the top)
  const hookGeo = new THREE.TorusGeometry(0.42, 0.045, 8, 16, Math.PI * 0.7);
  const hook = new THREE.Mesh(hookGeo, ironMat);
  hook.rotation.z = Math.PI;
  hook.position.set(0.42, daisTopY + 4.0, 0);
  hook.castShadow = true;
  group.add(hook);

  // chain links holding the lantern body
  for (let i = 0; i < 3; i++) {
    const link = new THREE.Mesh(
      new THREE.TorusGeometry(0.06, 0.014, 6, 10),
      ironMat,
    );
    link.position.set(0.84, daisTopY + 3.84 - i * 0.13, 0);
    link.rotation.x = (i % 2) * Math.PI / 2;
    group.add(link);
  }

  // ---- the lantern body (glass + cage) ----
  // glass — octahedron, stretched, semi-transparent
  const glassGeo = new THREE.OctahedronGeometry(0.32, 0);
  glassGeo.scale(1.0, 1.5, 1.0);
  const glassMat = new THREE.MeshBasicMaterial({
    color: 0x6a5a44,                 // dim/dormant: cool gray-warm
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  const glass = new THREE.Mesh(glassGeo, glassMat);
  glass.position.set(0.84, daisTopY + 3.0, 0);
  group.add(glass);

  // iron cage around the glass — 4 thin verticals
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const cage = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.85, 5),
      ironMat,
    );
    cage.position.set(
      glass.position.x + Math.cos(a) * 0.27,
      glass.position.y,
      glass.position.z + Math.sin(a) * 0.27,
    );
    cage.castShadow = false;
    group.add(cage);
  }
  // top + bottom cage rings
  for (const dy of [-0.42, 0.42]) {
    const r = new THREE.Mesh(
      new THREE.TorusGeometry(0.27, 0.018, 5, 14),
      ironMat,
    );
    r.rotation.x = Math.PI / 2;
    r.position.set(glass.position.x, glass.position.y + dy, glass.position.z);
    group.add(r);
  }

  // hot core — the sacred flame. Dim by default; bright when active.
  const coreMat = new THREE.MeshBasicMaterial({
    color: 0xfff1c4,
    transparent: true,
    opacity: 0.0,
  });
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.10, 12, 8),
    coreMat,
  );
  core.position.copy(glass.position);
  group.add(core);

  // halo around the core (additive, bigger; only visible when active)
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0xffb070,
    transparent: true,
    opacity: 0.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(0.32, 12, 8),
    haloMat,
  );
  halo.position.copy(glass.position);
  group.add(halo);

  // point light at the lantern, 0 intensity until activated
  const light = new THREE.PointLight(0xffc890, 0.0, 22, 1.6);
  light.position.copy(glass.position);
  group.add(light);

  // ---- world-space pivot used for ripple origin / proximity checks ----
  const worldPivot = new THREE.Vector3();

  // ---- state ----
  const state = {
    active: false,
    activatedAt: 0,
    fade: 0,   // 0 -> 1 over ~3s after activate()
  };

  function activate(t) {
    if (state.active) return;
    state.active = true;
    state.activatedAt = t;
  }

  function update(dt, t) {
    if (state.active) {
      state.fade = Math.min(1, state.fade + dt / 3.0);
    }
    const f = state.fade;
    // ease-out cubic for the warm-up swell
    const e = 1 - Math.pow(1 - f, 3);

    if (e > 0) {
      // glass color slides from cool gray to warm amber
      glassMat.color.setRGB(
        0.42 + 0.62 * e,    // r
        0.36 + 0.55 * e,    // g
        0.28 + 0.10 * e,    // b
      );
      glassMat.opacity = 0.55 + 0.30 * e;
      // core / halo / light all swell
      coreMat.opacity = e * 0.95;
      haloMat.opacity = e * (0.55 + Math.sin(t * 1.4) * 0.10);
      light.intensity = e * (1.8 + Math.sin(t * 1.2) * 0.18);
      // engraved ring pulse
      ringMat.opacity = e * (0.55 + Math.sin(t * 0.9) * 0.18);
      // gentle breathing scale on the core
      const s = 1.0 + Math.sin(t * 1.6) * 0.05 * e;
      core.scale.setScalar(s);
      halo.scale.setScalar(s * 1.2);
    }
  }

  function worldPos() {
    glass.getWorldPosition(worldPivot);
    return worldPivot;
  }

  return {
    group,
    activate,
    update,
    isActive: () => state.active,
    worldPos,
  };
}
