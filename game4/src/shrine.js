import * as THREE from "three";

/* -----------------------------------------------------------
 * Lantern Shrine — a sacred lantern hanging up the trail.
 *
 *   The player walks up to it; its flame is dim and flickering,
 *   on the verge of going out. Press E to take the flame: the
 *   shrine goes dark and the player's held lantern lights up.
 *   Built in the same visual language as the spawn lamp it
 *   replaced (warm hooked-pole lantern) but bigger, on a 3-step
 *   stone dais, so it reads as a sacred object.
 *
 *   Returns:
 *     {
 *       group,         // THREE.Group — drop into the scene
 *       activate(t),   // start the take-the-flame transfer
 *       update(dt,t),  // per-frame flicker / fade
 *       isActive(),    // true once the flame has been claimed
 *       getFlame(),    // 0..1 — current flame strength on the shrine
 *       worldPos(),    // Vector3 of the lantern's core
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

  // point light at the lantern — bright enough to see from across the
  // trail, but driven by the flame state so it pulses like it's dying.
  const light = new THREE.PointLight(0xffc890, 0.0, 38, 1.4);
  light.position.copy(glass.position);
  group.add(light);

  // ---- world-space pivot used for ripple origin / proximity checks ----
  const worldPivot = new THREE.Vector3();

  // ---- state ----
  // flame: 1.0 = full, 0.0 = out. Starts at "dying" — dim and unstable.
  // When activate() fires, flame fades to 0 over ~1.2s (the player has
  // taken it).
  const state = {
    active: false,
    activatedAt: 0,
    flame: 0.42,             // dying: low and flickering
  };

  function activate(t) {
    if (state.active) return;
    state.active = true;
    state.activatedAt = t;
  }

  function update(dt, t) {
    if (state.active) {
      // brief swell as it leaves, then fade to dark
      const since = Math.max(0, t - state.activatedAt);
      const swell = since < 0.25 ? since / 0.25 : Math.max(0, 1 - (since - 0.25) / 1.0);
      state.flame = swell * 1.0;
    } else {
      // Dying-pulse rhythm: a slow heartbeat where the flame briefly swells
      // bright, then nearly fades out before the next beat. Deep troughs so
      // it reads as almost gone, with fast jitter on top so it feels alive
      // and fragile. Range roughly 0.04 .. 1.0.
      const heart = Math.sin(t * 1.4) * 0.5 + 0.5;          // 0..1, ~4.5s period
      const heartShaped = Math.pow(heart, 2.6);             // sharp short peak, long trough
      const fastFlick =
        Math.sin(t * 11.3) * 0.05 +
        Math.sin(t * 19.7 + 0.4) * 0.03;
      // a slower gust that occasionally crushes brightness toward zero
      const gust = Math.max(0, 1.0 - Math.pow(Math.sin(t * 0.31 + 1.1) * 0.5 + 0.5, 4.0) * 0.95);
      state.flame = Math.max(0.04, (0.06 + heartShaped * 0.98 + fastFlick) * gust);
    }
    const e = THREE.MathUtils.clamp(state.flame, 0, 1);

    // glass color slides from cool gray (out) to warm amber (lit)
    glassMat.color.setRGB(
      0.42 + 0.62 * e,
      0.36 + 0.55 * e,
      0.28 + 0.10 * e,
    );
    glassMat.opacity = 0.55 + 0.30 * e;
    coreMat.opacity = Math.min(1, e * 1.15);
    haloMat.opacity = e * (0.85 + Math.sin(t * 1.4) * 0.10);
    // light intensity tracks the pulse strongly so the world brightens
    // and dims around the post on each beat
    light.intensity = e * (5.5 + Math.sin(t * 1.2) * 0.6);
    ringMat.opacity = e * (0.75 + Math.sin(t * 0.9) * 0.18);
    const s = 1.0 + Math.sin(t * 1.6) * 0.10 * e;
    core.scale.setScalar(s);
    halo.scale.setScalar(s * 1.2);
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
    getFlame: () => state.flame,
    worldPos,
  };
}
