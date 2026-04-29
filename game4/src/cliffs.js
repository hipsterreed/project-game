import * as THREE from "three";

/* -----------------------------------------------------------
 * Cliff props — every wordless landmark on The Quiet Cliffs.
 *
 *   - Ruined windmills   (still until restoration spins them)
 *   - Hanging bridges    (some planks missing until restored)
 *   - Cloth banners      (cheap cloth-strip with wind sway)
 *   - Floating fragments (small drifting stones near the edges)
 *   - Wind stones        (small breadcrumb pulses)
 *   - Stone pathway      (slabs along the player's natural path)
 *
 *   Returns: {
 *     group,                     // add to the scene root
 *     colliders,                 // bridge plank colliders (stair-style)
 *     windmills, bridges,        // arrays for restoration anim
 *     banners, fragments, windstones,
 *     setRestoring(t),           // 0..1 ramp for restoration anim
 *     setBridgeReformProgress(t),// 0..1 visual fade-in for missing planks
 *   }
 * --------------------------------------------------------- */

export function buildCliffs({ getTerrainHeight, ISLAND_R, CLIFF_R }) {
  const group = new THREE.Group();
  const colliders = [];

  const STONE_DARK   = new THREE.MeshStandardMaterial({ color: 0x6b5240, roughness: 0.95 });
  const STONE_LIGHT  = new THREE.MeshStandardMaterial({ color: 0x8e7a5c, roughness: 0.92 });
  const WOOD_MAT     = new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 0.85 });
  const WOOD_DARK    = new THREE.MeshStandardMaterial({ color: 0x402a16, roughness: 0.9 });
  const ROPE_MAT     = new THREE.MeshStandardMaterial({ color: 0x3a2818, roughness: 0.95 });

  /* -----------------------------------------------------------
   * Stone pathway — flat slabs leading from spawn (~origin) to the
   * cliff edge (~z = -98), conformed to terrain height.
   * --------------------------------------------------------- */
  const PATH_STEPS = 22;
  for (let i = 0; i < PATH_STEPS; i++) {
    const t = i / (PATH_STEPS - 1);
    // gentle S-curve so the path doesn't look like a ruler
    const z = -8 - t * 88;
    const x = Math.sin(t * Math.PI * 1.3) * 2.8 + (Math.random() - 0.5) * 0.4;
    const y = getTerrainHeight(x, z);
    const w = 1.6 + Math.random() * 0.4;
    const d = 1.05 + Math.random() * 0.2;
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(w, 0.18, d),
      Math.random() < 0.5 ? STONE_LIGHT : STONE_DARK,
    );
    slab.position.set(x, y + 0.04, z);
    slab.rotation.y = (Math.random() - 0.5) * 0.6;
    slab.rotation.x = (Math.random() - 0.5) * 0.05;
    slab.rotation.z = (Math.random() - 0.5) * 0.05;
    slab.castShadow = false;
    slab.receiveShadow = true;
    group.add(slab);
  }

  /* -----------------------------------------------------------
   * Windmills — a stone tower with 4 wooden blades. Initially still,
   * spin up when restoration kicks in. Two per island, on ridges.
   * --------------------------------------------------------- */
  const windmills = [];
  const WINDMILL_SPOTS = [
    { x:  62, z: -22, ang: -0.9 },
    { x: -54, z:  38, ang:  1.1 },
  ];
  for (const spot of WINDMILL_SPOTS) {
    const wm = new THREE.Group();
    wm.position.set(spot.x, getTerrainHeight(spot.x, spot.z), spot.z);
    wm.rotation.y = spot.ang;

    // ---- stone tower base (tapered cylinder) ----
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 1.7, 5.2, 12, 4, false),
      STONE_LIGHT,
    );
    base.position.y = 2.6;
    base.castShadow = true;
    base.receiveShadow = true;
    wm.add(base);

    // ---- broken roof rim ----
    const rim = new THREE.Mesh(
      new THREE.CylinderGeometry(1.45, 1.32, 0.42, 12),
      STONE_DARK,
    );
    rim.position.y = 5.4;
    rim.castShadow = true;
    wm.add(rim);

    // a chip out of the rim — a missing chunk reads as ruined
    const chip = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.5, 0.6),
      STONE_DARK,
    );
    chip.position.set(1.05, 5.5, 0.6);
    chip.rotation.set(0.4, 0.7, 0.2);
    chip.scale.setScalar(0.0);   // hidden — kept as a placeholder anchor
    wm.add(chip);

    // ---- blade hub ----
    const hubGroup = new THREE.Group();
    hubGroup.position.y = 5.4;
    hubGroup.position.z = 1.2;
    hubGroup.rotation.x = -0.05;
    wm.add(hubGroup);

    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.18, 0.34, 10),
      WOOD_DARK,
    );
    hub.rotation.x = Math.PI / 2;
    hub.castShadow = true;
    hubGroup.add(hub);

    // ---- 4 blades ----
    const blades = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const blade = new THREE.Group();
      hubGroup.add(blade);
      blade.rotation.z = a;
      // shaft
      const shaft = new THREE.Mesh(
        new THREE.BoxGeometry(0.10, 2.6, 0.10),
        WOOD_MAT,
      );
      shaft.position.y = 1.45;
      shaft.castShadow = true;
      blade.add(shaft);
      // sail (canvas) — a thin slat fanning out
      const sail = new THREE.Mesh(
        new THREE.BoxGeometry(0.55, 2.0, 0.04),
        WOOD_DARK,
      );
      sail.position.set(0.35, 1.4, 0);
      sail.castShadow = true;
      blade.add(sail);
      // some ribbing
      for (let r = 0; r < 3; r++) {
        const rib = new THREE.Mesh(
          new THREE.BoxGeometry(0.55, 0.04, 0.02),
          WOOD_MAT,
        );
        rib.position.set(0.35, 0.6 + r * 0.7, 0.025);
        blade.add(rib);
      }
      blades.push(blade);
    }

    group.add(wm);
    windmills.push({
      group: wm,
      hubGroup,
      blades,
      currentSpeed: 0,         // blade rotational velocity (rad/s)
      targetSpeed: 0,          // ramps up on restoration
      bladeAng: Math.random() * Math.PI * 2,
    });
  }

  /* -----------------------------------------------------------
   * Hanging bridges — short rope+plank walks across small gaps in
   * the path. Some planks start missing and visually rebuild from
   * glowing threads when the player restores the shrine.
   *
   *   Each bridge is a chain of plank meshes between two endpoints,
   *   with two sagging rope-curves on either side.
   * --------------------------------------------------------- */
  const bridges = [];
  const BRIDGE_SPECS = [
    // a bridge crossing a small dip on the way to the cliff edge
    { from: { x:  4.0, z: -38 }, to: { x: -4.0, z: -52 }, planks: 12, missing: [3, 4, 8] },
    // a side-bridge to a fragment of the island
    { from: { x: -36,  z: -8  }, to: { x: -54,  z: -2  }, planks: 10, missing: [2, 6] },
  ];
  for (const spec of BRIDGE_SPECS) {
    const b = buildBridge(spec, { getTerrainHeight, WOOD_MAT, WOOD_DARK, ROPE_MAT });
    group.add(b.group);
    for (const c of b.colliders) colliders.push(c);
    bridges.push(b);
  }

  /* -----------------------------------------------------------
   * Cloth banners — thin colored strips on tall poles. Each banner
   *   uses a small grid of MeshStandardMaterial planes that we sway
   *   per-frame with a sin wave (cheaper than verlet, reads great
   *   in the wind already kicked up by the global wind uniform.)
   * --------------------------------------------------------- */
  const banners = [];
  const BANNER_SPOTS = [
    { x:  10, z: -16, color: 0xffd9a0 },
    { x: -18, z: -28, color: 0xb8cfd8 },
    { x:  28, z: -54, color: 0xe28f9a },
    { x: -44, z: -66, color: 0xf2e6c0 },
  ];
  for (const spot of BANNER_SPOTS) {
    const b = buildBanner(spot, { getTerrainHeight, WOOD_DARK });
    group.add(b.group);
    banners.push(b);
  }

  /* -----------------------------------------------------------
   * Floating stone fragments — drifting silhouettes near cliff edge.
   *
   *   Two shared geometries (deformed icos) re-used by every fragment;
   *   per-instance scale/rotation gives them visual variety without 28
   *   unique BufferGeometries on the GPU.
   * --------------------------------------------------------- */
  const fragments = [];
  const FRAG_GEOS = [];
  for (let g = 0; g < 3; g++) {
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const pa = geo.attributes.position;
    for (let k = 0; k < pa.count; k++) {
      pa.setX(k, pa.getX(k) * (0.85 + Math.random() * 0.3));
      pa.setY(k, pa.getY(k) * (0.85 + Math.random() * 0.3));
      pa.setZ(k, pa.getZ(k) * (0.85 + Math.random() * 0.3));
    }
    pa.needsUpdate = true;
    geo.computeVertexNormals();
    FRAG_GEOS.push(geo);
  }
  const FRAG_COUNT = 18;
  for (let i = 0; i < FRAG_COUNT; i++) {
    const ang = Math.random() * Math.PI * 2;
    const r = 90 + Math.random() * 110;
    const x = Math.cos(ang) * r;
    const z = Math.sin(ang) * r;
    const y = -6 - Math.random() * 24;
    const sx = 0.6 + Math.random() * 1.8;
    const sy = 0.4 + Math.random() * 0.9;
    const sz = 0.6 + Math.random() * 1.8;

    const geo = FRAG_GEOS[i % FRAG_GEOS.length];
    const m = new THREE.Mesh(geo, (i & 1) ? STONE_LIGHT : STONE_DARK);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    m.castShadow = false;
    m.receiveShadow = false;
    m.userData = {
      bobY: y,
      bobPhase: Math.random() * Math.PI * 2,
      bobSpeed: 0.25 + Math.random() * 0.25,
      spinX: (Math.random() - 0.5) * 0.04,
      spinY: (Math.random() - 0.5) * 0.06,
      spinZ: (Math.random() - 0.5) * 0.04,
    };
    group.add(m);
    fragments.push(m);
  }

  /* -----------------------------------------------------------
   * Wind stones — short engraved markers along the path that pulse
   *   when the player passes near. We create them as ruin-cluster-
   *   like objects so the resonance system already lights them up.
   *
   *   Returned in a list and ALSO appended to the world ruins list
   *   later in scene.js so the resonance system picks them up.
   * --------------------------------------------------------- */
  const windstones = [];
  const STONE_SPOTS = [
    { x:  6, z: -12 },
    { x: -8, z: -28 },
    { x:  10, z: -44 },
    { x: -6, z: -62 },
    { x:  3, z: -82 },
  ];
  for (const spot of STONE_SPOTS) {
    const ws = buildWindStone(spot, { getTerrainHeight, STONE_DARK });
    group.add(ws.group);
    windstones.push(ws);
  }

  /* -----------------------------------------------------------
   * Wind bridge — the ascent path that appears at the cliff edge
   *   once restoration completes. A row of glowing stepping pads
   *   that float upward and outward toward a higher destination
   *   island. Hidden by default; phases in (scale + opacity) when
   *   `setWindBridgeProgress` advances 0 → 1.
   *
   *   Each pad is a thin disc of glowing cloth-stone, with a small
   *   point-light feel (driven via emissive instead of an actual
   *   light to avoid shader recompiles).
   * --------------------------------------------------------- */
  const windBridge = buildWindBridge({ getTerrainHeight });
  group.add(windBridge.group);
  // pads contribute colliders so the player can walk on them once revealed
  for (const c of windBridge.colliders) colliders.push(c);

  /* -----------------------------------------------------------
   * Sky island — the floating destination at the top of the wind
   *   bridge. Round disc with a tapered rocky underside, a small
   *   lighthouse tower, and ancient glowing runes inscribed on the
   *   top surface. Position is the last wind-bridge pad's target.
   * --------------------------------------------------------- */
  const SKY_ISLAND_POS = { x: 0, y: 42, z: -240 };
  const skyIsland = buildSkyIsland(SKY_ISLAND_POS, { STONE_LIGHT, STONE_DARK });
  group.add(skyIsland.group);

  // ---- restoration drivers ----
  const state = {
    restoring: 0,       // 0..1 — eased
    bridgeReform: 0,    // 0..1 — independent timing for plank rebuild
    windBridge: 0,      // 0..1 — wind-bridge phase-in
  };

  function setRestoring(t) { state.restoring = THREE.MathUtils.clamp(t, 0, 1); }
  function setBridgeReformProgress(t) {
    state.bridgeReform = THREE.MathUtils.clamp(t, 0, 1);
  }
  function setWindBridgeProgress(t) {
    state.windBridge = THREE.MathUtils.clamp(t, 0, 1);
  }

  return {
    group,
    colliders,
    windmills,
    bridges,
    banners,
    fragments,
    windstones,
    windBridge,
    skyIsland,
    state,
    setRestoring,
    setBridgeReformProgress,
    setWindBridgeProgress,
  };
}

/* -----------------------------------------------------------
 * Per-frame update — pure animation, no allocation.
 * --------------------------------------------------------- */
export function updateCliffs(cliffs, dt, t, player, audio) {
  const r = cliffs.state.restoring;

  // ---- windmills: ramp current speed toward target * restoration ----
  for (const wm of cliffs.windmills) {
    wm.targetSpeed = r * 0.35;                           // gentle once restored
    wm.currentSpeed = THREE.MathUtils.damp(wm.currentSpeed, wm.targetSpeed, 1.4, dt);
    wm.bladeAng += wm.currentSpeed * dt;
    if (wm.hubGroup) wm.hubGroup.rotation.z = wm.bladeAng;
  }

  // ---- banners: gentle sway driven by sin time + flag wind ----
  for (const b of cliffs.banners) {
    const wind = 0.55 + r * 0.45;
    const swayX = Math.sin(t * 1.2 + b.phase) * 0.18 * wind;
    const swayZ = Math.cos(t * 0.9 + b.phase * 0.7) * 0.12 * wind;
    if (b.cloth) {
      b.cloth.rotation.x = swayZ;
      b.cloth.rotation.z = swayX;
      // gentle bob to simulate billow
      b.cloth.position.y = b.clothBaseY + Math.sin(t * 1.5 + b.phase) * 0.05;
    }
  }

  // ---- bridges: plank fade-in tied to bridgeReform ----
  // animate the shared missingMat once per bridge (uniforms shared across
  // all missing planks on that bridge → one shader, one upload)
  const reform = cliffs.state.bridgeReform;
  for (const br of cliffs.bridges) {
    const sharedMat = br.group.userData.missingMat;
    if (sharedMat) {
      // average rebuild progress, used for the shared opacity/emissive
      const local = THREE.MathUtils.clamp(reform, 0, 1);
      sharedMat.emissiveIntensity = (1 - local) * 0.8;
      sharedMat.opacity = 0.4 + 0.6 * local;
    }
    // per-plank scale.y stagger gives each plank its own rebuild timing
    // without any per-plank material work
    for (const p of br.planks) {
      if (!p.missing) continue;
      const local = THREE.MathUtils.clamp(reform * 1.6 - p.delay, 0, 1);
      p.mesh.scale.y = local;
      p.mesh.visible = local > 0.02;
      if (local >= 0.999 && !p.colliderEnabled) {
        p.colliderEnabled = true;
        if (p.colliderRef) p.colliderRef.halfW = p.colliderHalfW;
      }
    }
  }

  // ---- fragments: bob + spin ----
  for (const f of cliffs.fragments) {
    const u = f.userData;
    f.position.y = u.bobY + Math.sin(t * u.bobSpeed + u.bobPhase) * 0.7;
    f.rotation.x += u.spinX * dt * 60;
    f.rotation.y += u.spinY * dt * 60;
    f.rotation.z += u.spinZ * dt * 60;
  }

  // ---- wind bridge: phase pads in, drift cloth around them ----
  const wb = cliffs.windBridge;
  if (wb) {
    const wbT = cliffs.state.windBridge;
    const pp = player?.position;
    // spring constants — under-damped so the pad drops then bobs back
    // up past its rest height (gives the "floating platform" feel)
    const SPRING_K = 26;
    const SPRING_C = 3.0;

    for (let i = 0; i < wb.pads.length; i++) {
      const pad = wb.pads[i];
      // staggered fade-in: each pad starts a moment after the last.
      // The 2.0 multiplier guarantees every pad reaches eased=1 by the
      // time wbT saturates so the late pads are fully walkable, not
      // half-scale stones.
      const local = THREE.MathUtils.clamp(wbT * 2.0 - i * 0.07, 0, 1);
      const eased = local * local * (3 - 2 * local);
      pad.mesh.scale.setScalar(eased);
      pad.mat.opacity = 0.55 + eased * 0.4;

      // ---- step-on reaction + lantern proximity ----
      let lanternProx = 0;
      if (pp && eased > 0.85) {
        const dxp = pp.x - pad.mesh.position.x;
        const dzp = pp.z - pad.mesh.position.z;
        const dyp = pp.y - pad.targetY;
        const dxz = Math.hypot(dxp, dzp);
        // lantern glow falls off with overall distance to the pad
        const dist = Math.hypot(dxz, dyp);
        lanternProx = Math.max(0, 1 - dist / 4.5);
        // step-on: player feet within pad disc, just above its surface
        if (dxz < pad.colliderHalfW + 0.4 && dyp > -0.2 && dyp < 1.6) {
          if (!pad.played) {
            pad.played = true;
            pad.pressedVel -= 3.2;     // downward kick (drops the pad)
            audio?.playRuinChime?.(7 + i * 4);
          }
          pad.lit = Math.min(1, pad.lit + dt * 4.0);
        }
      }

      // spring physics for the press: under-damped so it overshoots
      // upward like a floating platform settling back into place
      const accel = -SPRING_K * pad.pressed - SPRING_C * pad.pressedVel;
      pad.pressedVel += accel * dt;
      pad.pressed   += pad.pressedVel * dt;

      // emissive composes a dim base + lit-up boost + lantern proximity glow
      const baseEm  = 0.12;
      const litEm   = pad.lit * 1.2;
      const lampEm  = lanternProx * 0.7;
      pad.mat.emissiveIntensity = (baseEm + litEm + lampEm) * (0.35 + eased * 0.65);

      // pad position: gentle bob + spring offset
      const bob = Math.sin(t * 0.7 + pad.bobPhase) * 0.12;
      const padY = pad.targetY + bob + pad.pressed;
      pad.mesh.position.y = padY;
      // collider follows so the player rides the pad as it bobs/presses
      if (pad.colliderRef) pad.colliderRef.y = padY + 0.09;

      // toggle collider when fully present
      if (eased > 0.85 && !pad.colliderEnabled) {
        pad.colliderEnabled = true;
        pad.colliderRef.halfW = pad.colliderHalfW;
        pad.colliderRef.halfD = pad.colliderHalfD;
      }
    }
    // motes share a single material — write opacity once, animate
    // position/rotation per-mote (cheap)
    if (wb.motes.length) {
      wb.motes[0].material.opacity = cliffs.state.windBridge * 0.7;
    }
    for (const mote of wb.motes) {
      mote.position.y = mote.baseY + Math.sin(t * 1.4 + mote.phase) * 0.3;
      mote.rotation.y += dt * 0.4;
    }
  }

  // ---- sky island runes: gentle out-of-phase pulse on each material ----
  const si = cliffs.skyIsland;
  if (si) {
    for (let i = 0; i < si.runeMats.length; i++) {
      const m = si.runeMats[i];
      const base = m.userData.baseOpacity;
      // each rune drifts on its own phase so the inscription "breathes"
      const pulse = 0.78 + 0.22 * Math.sin(t * 0.55 + i * 0.7);
      m.opacity = base * pulse;
    }
    if (si.haloMat) {
      const base = si.haloMat.userData.baseOpacity;
      si.haloMat.opacity = base * (0.85 + 0.15 * Math.sin(t * 0.9));
    }
  }
}

/* -----------------------------------------------------------
 * Wind bridge — the ascending stepping-stone path. A row of
 *   pads cantilevered out from the cliff edge toward an upper
 *   destination island. Each pad is a soft glowing disc.
 * --------------------------------------------------------- */
function buildWindBridge({ getTerrainHeight }) {
  const group = new THREE.Group();
  const pads = [];
  const motes = [];
  const colliders = [];

  // Start from just past the cliff edge (~z = -100) and ascend toward
  // the sky island at (0, 42, -240). More pads, packed closer so the
  // jumps are comfortable; final pad lands at the near edge of the
  // island disc rather than its centre.
  const PAD_COUNT = 24;
  const startX = 0,    startY = -2,   startZ = -100;
  const endX   = 0,    endY   = 42,   endZ   = -222;

  for (let i = 0; i < PAD_COUNT; i++) {
    const t = i / (PAD_COUNT - 1);
    // smoothstep so steps near the edge are closer & rises pickup later
    const eased = t * t * (3 - 2 * t);
    const x = THREE.MathUtils.lerp(startX, endX, t)
            + Math.sin(t * Math.PI * 2.0) * 2.4;     // gentle S-curve
    const y = THREE.MathUtils.lerp(startY, endY, eased)
            + Math.sin(t * Math.PI * 4) * 0.8;
    const z = THREE.MathUtils.lerp(startZ, endZ, t);

    // soft glowing pad geometry — circular slab with emissive top.
    // Starts dim ("not lit yet"); each pad lights up the first time the
    // player steps on it. Bigger discs so jumping between them is forgiving.
    const padGeo = new THREE.CylinderGeometry(2.1, 1.9, 0.22, 22, 1);
    const padMat = new THREE.MeshStandardMaterial({
      color: 0xfff0c4,
      emissive: 0xffd9a0,
      emissiveIntensity: 0.12,
      roughness: 0.55,
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
    });
    const pad = new THREE.Mesh(padGeo, padMat);
    pad.position.set(x, y, z);
    pad.scale.setScalar(0.0);
    pad.castShadow = false;
    pad.receiveShadow = false;
    group.add(pad);

    // collider — disabled until pad is fully present. Sized to match the
    // larger disc so the player doesn't slip off the visible edge.
    const colliderHalfW = 1.9;
    const colliderHalfD = 1.9;
    const colliderRef = {
      x, y: y + 0.09, z,
      halfW: 0.0001, halfD: 0.0001,    // disabled
      cos: 1, sin: 0,
    };
    colliders.push(colliderRef);

    pads.push({
      mesh: pad,
      mat: padMat,
      bobPhase: i * 0.4,
      targetY: y,
      colliderRef,
      colliderEnabled: false,
      colliderHalfW,
      colliderHalfD,
      // step-on reactivity: lit (0..1) ramps to 1 the first time the
      // player stands on the pad. pressed (in metres) is a spring offset
      // that briefly drops then bobs back up like a floating platform.
      lit: 0,
      pressed: 0,
      pressedVel: 0,
      played: false,
      index: i,
    });

  }
  // ---- a few drifting motes scattered along the bridge for atmosphere.
  // Shared geometry + shared material so the whole flock renders in one
  // batch, instead of 42 unique mesh+material pairs.
  const moteGeo = new THREE.OctahedronGeometry(0.14, 0);
  const moteMat = new THREE.MeshBasicMaterial({
    color: 0xfff0c4,
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
  });
  const MOTE_COUNT = 14;
  for (let m = 0; m < MOTE_COUNT; m++) {
    const i = Math.min(PAD_COUNT - 1, Math.floor((m / MOTE_COUNT) * PAD_COUNT));
    const pad = pads[i];
    const px = pad.mesh.position.x;
    const py = pad.targetY;
    const pz = pad.mesh.position.z;
    const ang = Math.random() * Math.PI * 2;
    const r = 1.4 + Math.random() * 1.1;
    const mote = new THREE.Mesh(moteGeo, moteMat);
    mote.position.set(
      px + Math.cos(ang) * r,
      py + 0.6 + Math.random() * 0.7,
      pz + Math.sin(ang) * r,
    );
    mote.baseY = mote.position.y;
    mote.phase = Math.random() * Math.PI * 2;
    group.add(mote);
    motes.push(mote);
  }

  return { group, pads, motes, colliders };
}

/* -----------------------------------------------------------
 * Sky island — the floating circular destination at the top of
 *   the wind bridge. A grass-topped disc with a rocky tapered
 *   underside, ringed by a few jagged stones, with a stone
 *   lighthouse tower at its centre. Ancient runes are inscribed
 *   on the top surface in vibrant colors that pulse gently.
 * --------------------------------------------------------- */
function buildSkyIsland(pos, mats) {
  const { STONE_LIGHT, STONE_DARK } = mats;
  const g = new THREE.Group();
  g.position.set(pos.x, pos.y, pos.z);

  const ISLAND_R   = 18;
  const TOP_THICK  = 1.0;

  // grass-topped disc
  const topMat = new THREE.MeshStandardMaterial({
    color: 0x4a4a32,
    roughness: 0.9,
  });
  const top = new THREE.Mesh(
    new THREE.CylinderGeometry(ISLAND_R, ISLAND_R - 0.6, TOP_THICK, 36, 1),
    topMat,
  );
  top.position.y = 0;
  top.castShadow = true;
  top.receiveShadow = true;
  g.add(top);

  // rocky tapered underside — cone with apex pointing down
  const under = new THREE.Mesh(
    new THREE.ConeGeometry(ISLAND_R - 0.8, 22, 28, 4, true),
    STONE_DARK,
  );
  under.rotation.x = Math.PI;       // flip so the point faces down
  under.position.y = -TOP_THICK / 2 - 11;
  under.castShadow = true;
  g.add(under);

  // a ring of jagged boulders around the equator for silhouette
  const BOULDER_GEO = new THREE.IcosahedronGeometry(1.0, 0);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
    const r = ISLAND_R - 0.8 + (Math.random() - 0.3) * 1.2;
    const stone = new THREE.Mesh(
      BOULDER_GEO,
      i & 1 ? STONE_LIGHT : STONE_DARK,
    );
    stone.position.set(
      Math.cos(a) * r,
      -1.2 - Math.random() * 1.0,
      Math.sin(a) * r,
    );
    stone.scale.set(
      0.9 + Math.random() * 1.6,
      1.2 + Math.random() * 1.6,
      0.9 + Math.random() * 1.6,
    );
    stone.rotation.set(
      Math.random() * Math.PI,
      Math.random() * Math.PI,
      Math.random() * Math.PI,
    );
    stone.castShadow = true;
    g.add(stone);
  }

  /* ---- ancient runes: rings + spokes + glyph dots, additive emissive,
   * vibrant but capped to ~0.55 opacity so they catch the eye without
   * blowing out the dim pre-dawn palette. */
  const RUNE_COLORS = [0x4ad8ff, 0xff6acc, 0xffd24a, 0x9aff86];
  const runeMats = [];
  function makeRuneMat(color, opacity) {
    const m = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    m.userData.baseOpacity = opacity;
    runeMats.push(m);
    return m;
  }

  const RUNE_Y = TOP_THICK / 2 + 0.025;

  // three concentric rings, each its own color
  const RING_RADII = [13.5, 9.0, 5.0];
  for (let i = 0; i < RING_RADII.length; i++) {
    const ringR = RING_RADII[i];
    const ringGeo = new THREE.RingGeometry(ringR - 0.20, ringR, 96);
    ringGeo.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(
      ringGeo,
      makeRuneMat(RUNE_COLORS[i % RUNE_COLORS.length], 0.55),
    );
    ring.position.y = RUNE_Y + i * 0.005;
    g.add(ring);
  }

  // 8 radial spokes between the inner and outer rings
  const SPOKES = 8;
  for (let i = 0; i < SPOKES; i++) {
    const a = (i / SPOKES) * Math.PI * 2;
    const inner = 5.2;
    const outer = 8.8;
    const len = outer - inner;
    const spokeGeo = new THREE.PlaneGeometry(0.22, len);
    spokeGeo.rotateX(-Math.PI / 2);
    spokeGeo.translate(0, 0, inner + len / 2);
    const spoke = new THREE.Mesh(
      spokeGeo,
      makeRuneMat(RUNE_COLORS[i % RUNE_COLORS.length], 0.45),
    );
    spoke.rotation.y = a;
    spoke.position.y = RUNE_Y + 0.005;
    g.add(spoke);
  }

  // glyph dots scattered along a mid radius — irregular spacing reads
  // as written symbols rather than a regular pattern
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2 + Math.sin(i * 1.31) * 0.12;
    const r = 11.2 + Math.sin(i * 2.7) * 0.4;
    const size = 0.18 + Math.random() * 0.18;
    const dotGeo = new THREE.CircleGeometry(size, 8);
    dotGeo.rotateX(-Math.PI / 2);
    const dot = new THREE.Mesh(
      dotGeo,
      makeRuneMat(RUNE_COLORS[i % RUNE_COLORS.length], 0.5),
    );
    dot.position.set(Math.cos(a) * r, RUNE_Y + 0.01, Math.sin(a) * r);
    g.add(dot);
  }

  // central emblem — a small bright disc at the foot of the lighthouse
  const emblemGeo = new THREE.CircleGeometry(1.4, 24);
  emblemGeo.rotateX(-Math.PI / 2);
  const emblem = new THREE.Mesh(emblemGeo, makeRuneMat(0xfff0c4, 0.5));
  emblem.position.y = RUNE_Y + 0.015;
  g.add(emblem);

  /* ---- lighthouse tower at the centre ---- */
  const tower = new THREE.Group();
  tower.position.y = TOP_THICK / 2;
  g.add(tower);

  // base plinth
  const plinth = new THREE.Mesh(
    new THREE.CylinderGeometry(2.4, 3.0, 1.0, 16),
    STONE_LIGHT,
  );
  plinth.position.y = 0.5;
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  tower.add(plinth);

  // tapered shaft
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(1.4, 2.2, 8.5, 18),
    STONE_LIGHT,
  );
  shaft.position.y = 5.25;
  shaft.castShadow = true;
  tower.add(shaft);

  // gallery ring (a wider band where the lantern room sits)
  const gallery = new THREE.Mesh(
    new THREE.CylinderGeometry(1.85, 1.85, 0.5, 18),
    STONE_DARK,
  );
  gallery.position.y = 9.75;
  gallery.castShadow = true;
  tower.add(gallery);

  // lantern room frame — open cylinder, shows the lamp inside
  const lanternRoom = new THREE.Mesh(
    new THREE.CylinderGeometry(1.3, 1.3, 1.6, 8, 1, true),
    new THREE.MeshStandardMaterial({
      color: 0x4a3826,
      roughness: 0.85,
      side: THREE.DoubleSide,
    }),
  );
  lanternRoom.position.y = 10.8;
  tower.add(lanternRoom);

  // glowing lamp
  const lampMat = new THREE.MeshBasicMaterial({
    color: 0xffe9b8,
    transparent: true,
    opacity: 0.95,
    fog: false,
  });
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.85, 16, 12), lampMat);
  lamp.position.y = 10.8;
  tower.add(lamp);

  // soft halo around the lamp (additive)
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0xfff0c4,
    transparent: true,
    opacity: 0.22,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  haloMat.userData.baseOpacity = 0.22;
  const halo = new THREE.Mesh(new THREE.SphereGeometry(1.55, 16, 12), haloMat);
  halo.position.y = 10.8;
  tower.add(halo);

  // conical roof
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(1.55, 1.7, 10),
    STONE_DARK,
  );
  roof.position.y = 12.45;
  roof.castShadow = true;
  tower.add(roof);

  // small finial on top
  const finial = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 8, 6),
    new THREE.MeshStandardMaterial({
      color: 0xffd28a,
      emissive: 0xffd28a,
      emissiveIntensity: 0.45,
      roughness: 0.6,
    }),
  );
  finial.position.y = 13.45;
  tower.add(finial);

  return { group: g, runeMats, haloMat };
}

/* -----------------------------------------------------------
 * Bridge builder — internal helper.
 * --------------------------------------------------------- */
// Shared materials for plank rebuild — declared at module scope so all
// bridges share the same compiled shader. The "missing" material is
// still per-bridge because emissiveIntensity is animated; we update it
// once globally each frame from updateCliffs.
const _PLANK_PRESENT_MAT = new THREE.MeshStandardMaterial({
  color: 0x6a4a2a,
  roughness: 0.85,
});

function buildBridge(spec, mats) {
  const { getTerrainHeight, WOOD_MAT, WOOD_DARK, ROPE_MAT } = mats;
  const group = new THREE.Group();
  const planks = [];
  const colliders = [];

  // One missing-plank material shared across this bridge's missing planks.
  // Animation for the rebuild glow modulates this shared material's
  // opacity / emissiveIntensity, so all missing planks rebuild in sync.
  const missingMat = new THREE.MeshStandardMaterial({
    color: 0x6a4a2a,
    roughness: 0.85,
    transparent: true,
    opacity: 0.0,
    emissive: 0xffd9a0,
    emissiveIntensity: 0.0,
  });

  const ax = spec.from.x, az = spec.from.z;
  const bx = spec.to.x,   bz = spec.to.z;
  const dxAB = bx - ax, dzAB = bz - az;
  const len = Math.hypot(dxAB, dzAB);
  const dirX = dxAB / len, dirZ = dzAB / len;
  // perpendicular for the rope offset
  const perpX = -dirZ, perpZ = dirX;

  const ay = getTerrainHeight(ax, az) + 0.2;
  const by = getTerrainHeight(bx, bz) + 0.2;

  const PLANK_W = 1.4;
  const PLANK_LEN = 0.42;
  const N = spec.planks;

  // collect plank-relative metadata so we can rebuild missing planks
  for (let i = 0; i < N; i++) {
    const t = (i + 0.5) / N;
    const px = ax + dxAB * t;
    const pz = az + dzAB * t;
    // catenary sag
    const sag = -Math.sin(Math.PI * t) * 0.45;
    const py = THREE.MathUtils.lerp(ay, by, t) + sag - 0.02;

    const isMissing = spec.missing.includes(i);
    const plank = new THREE.Mesh(
      new THREE.BoxGeometry(PLANK_W, 0.06, PLANK_LEN),
      isMissing ? missingMat : _PLANK_PRESENT_MAT,
    );
    plank.position.set(px, py, pz);
    plank.rotation.y = Math.atan2(dirX, dirZ);
    plank.castShadow = true;
    plank.receiveShadow = true;
    if (isMissing) plank.scale.y = 0.0;
    group.add(plank);

    // plank collider — missing planks are hidden and have no collider
    let colliderHalfW = PLANK_W / 2;
    let colliderRef = null;
    if (!isMissing) {
      colliderRef = {
        x: px, z: pz, y: py + 0.06,
        halfW: PLANK_W / 2,
        halfD: PLANK_LEN / 2 + 0.05,
        cos: Math.cos(plank.rotation.y),
        sin: Math.sin(plank.rotation.y),
      };
      colliders.push(colliderRef);
    }

    planks.push({
      mesh: plank,
      missing: isMissing,
      delay: spec.missing.indexOf(i) * 0.12,
      colliderEnabled: !isMissing,
      colliderRef,
      colliderHalfW,
    });
  }

  // attach the shared missing-plank material so updateCliffs can animate
  // it once per bridge instead of once per plank
  group.userData.missingMat = missingMat;

  // ---- two sagging ropes: one on each side of the planks ----
  for (const side of [-1, 1]) {
    const ropePts = [];
    const ROPE_SEGS = 10;
    for (let i = 0; i <= ROPE_SEGS; i++) {
      const t = i / ROPE_SEGS;
      const x = ax + dxAB * t + perpX * (PLANK_W / 2 + 0.05) * side;
      const z = az + dzAB * t + perpZ * (PLANK_W / 2 + 0.05) * side;
      const yy = THREE.MathUtils.lerp(ay, by, t) - Math.sin(Math.PI * t) * 0.45 + 0.45;
      ropePts.push(new THREE.Vector3(x, yy, z));
    }
    const ropeCurve = new THREE.CatmullRomCurve3(ropePts);
    // 18 tube segments × 4 radial = ~72 verts. Plenty for a thin rope at
    // bridge distance.
    const ropeGeo = new THREE.TubeGeometry(ropeCurve, 18, 0.025, 4, false);
    const rope = new THREE.Mesh(ropeGeo, ROPE_MAT);
    rope.castShadow = false;
    rope.receiveShadow = false;
    group.add(rope);
  }

  // ---- 4 anchoring posts at each end ----
  for (const e of [{ x: ax, z: az, y: ay }, { x: bx, z: bz, y: by }]) {
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.10, 0.13, 1.4, 7),
      WOOD_DARK,
    );
    post.position.set(e.x, e.y + 0.7, e.z);
    post.castShadow = true;
    group.add(post);
  }

  return { group, planks, colliders };
}

/* -----------------------------------------------------------
 * Banner builder — internal helper.
 * --------------------------------------------------------- */
function buildBanner(spot, mats) {
  const { getTerrainHeight, WOOD_DARK } = mats;
  const group = new THREE.Group();
  const baseY = getTerrainHeight(spot.x, spot.z);
  group.position.set(spot.x, baseY, spot.z);
  group.rotation.y = Math.random() * Math.PI * 2;

  // pole
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.06, 3.6, 6),
    WOOD_DARK,
  );
  pole.position.y = 1.8;
  pole.castShadow = true;
  group.add(pole);

  // crossbar
  const cross = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.025, 1.0, 6),
    WOOD_DARK,
  );
  cross.rotation.z = Math.PI / 2;
  cross.position.set(0, 3.3, 0);
  group.add(cross);

  // cloth panel — thin double-sided plane
  const clothMat = new THREE.MeshStandardMaterial({
    color: spot.color,
    side: THREE.DoubleSide,
    roughness: 0.95,
    emissive: spot.color,
    emissiveIntensity: 0.04,
  });
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 1.6, 4, 8), clothMat);
  // anchor at top — set its origin at the top of the geometry
  cloth.geometry.translate(0, -0.8, 0);
  cloth.position.set(0, 3.3, 0.04);
  cloth.castShadow = false;
  group.add(cloth);

  return {
    group,
    cloth,
    clothBaseY: 3.3,
    phase: Math.random() * Math.PI * 2,
  };
}

/* -----------------------------------------------------------
 * Wind stone — small engraved marker that pulses softly when the
 *   player passes. Uses the same material conventions as ruin
 *   clusters so the ResonanceSystem treats it as a ruin-lite.
 * --------------------------------------------------------- */
function buildWindStone(spot, mats) {
  const { getTerrainHeight, STONE_DARK } = mats;
  const group = new THREE.Group();
  const y = getTerrainHeight(spot.x, spot.z);
  group.position.set(spot.x, y, spot.z);

  // unique stone material (so resonance can drive emissive per stone)
  const stoneMat = new THREE.MeshStandardMaterial({
    color: 0x7a6a5a, roughness: 0.95,
    emissive: 0x000000, emissiveIntensity: 0.0,
  });
  const engMat = new THREE.MeshBasicMaterial({
    color: 0xfff0c0,
    transparent: true,
    opacity: 0.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  // squat shape: short pillar with a flat carved face
  const stone = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.42, 1.2, 8),
    stoneMat,
  );
  stone.position.y = 0.6;
  stone.castShadow = true;
  stone.receiveShadow = true;
  group.add(stone);

  // engraving — a thin horizontal carve with a vertical accent
  const engGroup = new THREE.Group();
  group.add(engGroup);
  // horizontal slash
  const hSlash = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.06), engMat);
  hSlash.position.set(0, 0.85, 0.32);
  engGroup.add(hSlash);
  // small vertical
  const vSlash = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.30), engMat);
  vSlash.position.set(0, 0.55, 0.32);
  engGroup.add(vSlash);

  // expose materials for the resonance system (it expects this shape)
  group.userData.stoneMaterial = stoneMat;
  group.userData.engravingMaterial = engMat;
  group.userData.engravings = [hSlash, vSlash];
  group.userData.engravingGroup = engGroup;
  group.userData.pillarTopY = 1.2;

  return { group, stoneMat, engMat };
}
