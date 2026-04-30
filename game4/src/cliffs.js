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
  const BRIDGE_SPECS = [];
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
  const BANNER_SPOTS = [];
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
  const STONE_SPOTS = [];
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

  // ---- sky island runes: pulse while lighthouse lamp burns, dark when out ----
  const si = cliffs.skyIsland;
  if (si) {
    // lampMat.opacity is driven to 0 by the intro cinematic when the lamp goes out.
    // Normalise by the lamp's design-time max (0.88) so glyphs track brightness exactly.
    const lampBright = si.lampMat ? Math.min(1, si.lampMat.opacity / 0.88) : 0;

    for (let i = 0; i < si.runeMats.length; i++) {
      const m = si.runeMats[i];
      const base = m.userData.baseOpacity;
      // slow, out-of-phase pulse so the inscription "breathes" like old stone
      const pulse = 0.80 + 0.20 * Math.sin(t * 0.45 + i * 0.65);
      m.opacity = base * pulse * lampBright;
    }
    if (si.haloMat) {
      const base = si.haloMat.userData.baseOpacity;
      si.haloMat.opacity = base * (0.85 + 0.15 * Math.sin(t * 0.9));
    }
    // outer icosahedron rotates slowly, inner octahedron counter-rotates —
    // together they catch different facets of light each frame like a gem
    if (si.lampMesh) {
      si.lampMesh.rotation.y = t * 0.38;
      si.lampMesh.rotation.x = Math.sin(t * 0.22) * 0.18;
    }
    if (si.coreMesh) {
      si.coreMesh.rotation.y = -t * 0.65;
      si.coreMesh.rotation.z =  t * 0.28;
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

  // ---- rocky underside: three stratified layers ----
  // Each stratum is wider at its top than its bottom, so from below every
  // layer overhangs the one beneath it — reads as a torn rock mass, not a cone.
  //
  //   y=−0.5  ┌─────────────────────────┐ stratum 1 top  (R 17.5)
  //            │  (overhang lip)          │
  //   y=−5.5  └───────────────────┘       stratum 1 bot  (R 13.5)
  //   y=−5.5        ┌──────────────────┐  stratum 2 top  (R 13.0)
  //                 │                  │
  //   y=−12.5       └──────────┘        stratum 2 bot  (R  8.0)
  //   y=−13.0           ┌───────────┐   stratum 3 top  (R  7.5)
  //                     │           │
  //   y=−21.0           └─────┘      stratum 3 bot  (R  4.0)
  //   y=−21.8               ═══       flat bottom cap (R  4.0)

  const STRATA = [
    { cy: -3.0,  h: 5.0,  topR: 17.5, botR: 13.5, segs: 20 },
    { cy: -9.0,  h: 7.0,  topR: 13.0, botR:  8.0, segs: 18 },
    { cy: -17.0, h: 8.0,  topR:  7.5, botR:  4.0, segs: 14 },
  ];
  for (const s of STRATA) {
    const stratum = new THREE.Mesh(
      new THREE.CylinderGeometry(s.topR, s.botR, s.h, s.segs, 2),
      STONE_DARK,
    );
    stratum.position.y = s.cy;
    stratum.castShadow = true;
    g.add(stratum);
  }

  // flat bottom cap — sheared-off underside feels like it was ripped from the ground
  const bottomCap = new THREE.Mesh(
    new THREE.CylinderGeometry(4.2, 4.2, 0.8, 14),
    STONE_DARK,
  );
  bottomCap.position.y = -21.8;
  bottomCap.castShadow = true;
  g.add(bottomCap);

  // ---- hanging boulder clusters ----
  // Irregular icosahedra scattered across the underside add roughness and
  // break up the clean geometry of the strata edges.
  const HANG_GEO = new THREE.IcosahedronGeometry(1.0, 0);
  const HANG_SPOTS = [
    // outer perimeter drips along stratum 1
    { r: 15.0, a: 0.3,  y: -2.5,  sx: 2.4, sy: 1.2, sz: 2.0 },
    { r: 13.5, a: 1.1,  y: -4.0,  sx: 1.8, sy: 2.0, sz: 1.6 },
    { r: 14.5, a: 2.0,  y: -3.2,  sx: 2.2, sy: 1.4, sz: 2.4 },
    { r: 12.8, a: 3.2,  y: -4.5,  sx: 1.6, sy: 1.8, sz: 1.5 },
    { r: 15.5, a: 4.1,  y: -2.8,  sx: 2.6, sy: 1.0, sz: 2.2 },
    { r: 13.0, a: 5.3,  y: -3.8,  sx: 1.9, sy: 1.6, sz: 2.0 },
    // mid-depth chunks along stratum 2 seam
    { r:  9.5, a: 0.7,  y: -8.0,  sx: 2.0, sy: 2.6, sz: 1.8 },
    { r: 11.0, a: 1.8,  y: -7.2,  sx: 1.6, sy: 2.0, sz: 2.2 },
    { r:  8.5, a: 2.9,  y: -9.0,  sx: 2.4, sy: 1.8, sz: 1.6 },
    { r: 10.5, a: 4.5,  y: -7.8,  sx: 1.8, sy: 2.4, sz: 2.0 },
    // lower clusters near stratum 3
    { r:  5.5, a: 0.4,  y: -14.5, sx: 1.8, sy: 2.8, sz: 1.6 },
    { r:  6.5, a: 2.4,  y: -13.8, sx: 2.0, sy: 2.2, sz: 1.8 },
    { r:  5.0, a: 4.0,  y: -15.0, sx: 1.6, sy: 3.0, sz: 1.4 },
    // a couple near the flat bottom for final roughness
    { r:  3.0, a: 1.2,  y: -19.5, sx: 1.4, sy: 2.0, sz: 1.2 },
    { r:  2.5, a: 3.8,  y: -20.0, sx: 1.2, sy: 1.6, sz: 1.4 },
  ];
  for (let i = 0; i < HANG_SPOTS.length; i++) {
    const s = HANG_SPOTS[i];
    const rock = new THREE.Mesh(HANG_GEO, i & 1 ? STONE_LIGHT : STONE_DARK);
    rock.position.set(Math.cos(s.a) * s.r, s.y, Math.sin(s.a) * s.r);
    rock.scale.set(s.sx, s.sy, s.sz);
    rock.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    rock.castShadow = true;
    g.add(rock);
  }

  // a ring of jagged boulders around the equator for silhouette
  const BOULDER_GEO = new THREE.IcosahedronGeometry(1.0, 0);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + (Math.random() - 0.5) * 0.35;
    const r = ISLAND_R - 1.0 + (Math.random() - 0.3) * 1.4;
    const stone = new THREE.Mesh(
      BOULDER_GEO,
      i & 1 ? STONE_LIGHT : STONE_DARK,
    );
    stone.position.set(
      Math.cos(a) * r,
      -1.5 - Math.random() * 1.2,
      Math.sin(a) * r,
    );
    stone.scale.set(
      1.2 + Math.random() * 2.0,
      1.4 + Math.random() * 2.0,
      1.2 + Math.random() * 2.0,
    );
    stone.rotation.set(
      Math.random() * Math.PI,
      Math.random() * Math.PI,
      Math.random() * Math.PI,
    );
    stone.castShadow = true;
    g.add(stone);
  }

  /* ---- floor hieroglyphics: blue-glowing symbols inscribed on the surface.
   *
   * Layout (outward → inward):
   *   R 16.2  outer perimeter band — 36 alternating block marks
   *   R 13.8  thick ring separator
   *   R 11.0  8 hieroglyphic symbols, each in a cartouche frame
   *   R  9.2  ring separator
   *   R  6.5  8 small chevron marks (inner guard ring)
   *   R  5.1→9.5  double-line spokes with diamond accents (×8)
   *   R  4.8  inner ring separator
   *   R  0    central Eye of Ra
   * --------------------------------------------------------- */
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

  // pale, washed-out ancient-stone blue — ghostly rather than electric
  const mBright = makeRuneMat(0xd0e8ff, 0.60);   // pale ice blue
  const mMid    = makeRuneMat(0x9ab8dd, 0.46);   // dusty periwinkle
  const mDeep   = makeRuneMat(0x6688aa, 0.34);   // worn stone blue
  const mAccent = makeRuneMat(0xe8f4ff, 0.72);   // near-white highlight

  // ── floor geometry helpers ─────────────────────────────────────────────────
  function fPlane(w, d) {
    const geo = new THREE.PlaneGeometry(w, d); geo.rotateX(-Math.PI / 2); return geo;
  }
  function fRing(inner, outer, segs = 64) {
    const geo = new THREE.RingGeometry(inner, outer, segs); geo.rotateX(-Math.PI / 2); return geo;
  }
  function fCircle(r, segs = 16) {
    const geo = new THREE.CircleGeometry(r, segs); geo.rotateX(-Math.PI / 2); return geo;
  }
  function fm(geo, mat) { return new THREE.Mesh(geo, mat); }

  // ── three structural separator rings ─────────────────────────────────────
  for (const [r, thick, mat] of [
    [13.8, 0.26, mMid],
    [ 9.2, 0.20, mMid],
    [ 4.8, 0.20, mBright],
  ]) {
    const ring = fm(fRing(r - thick * 0.4, r + thick * 0.6), mat);
    ring.position.y = RUNE_Y;
    g.add(ring);
  }

  // ── outer perimeter: 36 alternating block marks at R ≈ 16.2 ──────────────
  for (let i = 0; i < 36; i++) {
    const a  = (i / 36) * Math.PI * 2;
    const mat = i % 3 === 0 ? mBright : mDeep;
    const bw  = i % 3 === 0 ? 0.52 : 0.30;
    const blk = fm(fPlane(bw, 0.22), mat);
    blk.position.set(Math.cos(a) * 16.2, RUNE_Y, Math.sin(a) * 16.2);
    blk.rotation.y = a;
    g.add(blk);
    // small accent dot between every fourth block
    if (i % 4 === 0) {
      const dot = fm(fCircle(0.10), mAccent);
      const da = a + Math.PI / 36;
      dot.position.set(Math.cos(da) * 15.7, RUNE_Y + 0.004, Math.sin(da) * 15.7);
      g.add(dot);
    }
  }

  // ── 8 hieroglyphic symbols in cartouches at R = 11 ───────────────────────
  // Each glyph is built from flat-floor planes/rings; symbols are composited
  // from basic strokes so they read as recognisable Egyptian forms from above.
  //
  // Glyph coordinate system: +Z = "up" of the symbol (spine direction),
  // +X = rightward.  Groups are rotated so Z points radially outward,
  // so the top of each symbol faces away from the lighthouse.
  const GLYPH_DEFS = [
    // 0 – Ankh (𓋹): narrow shaft, thin crossbar, tall oval loop
    (grp, s, ma, mb) => {
      // shaft below crossbar
      grp.add(fm(fPlane(s*.08, s*.38), ma)).position.set(0,0,-s*.10);
      // crossbar (thin, precise)
      grp.add(fm(fPlane(s*.44, s*.07), ma)).position.set(0,0, s*.10);
      // loop — taller than wide, like real ankh proportions
      const loopGrp = new THREE.Group(); loopGrp.position.set(0,0, s*.36);
      loopGrp.add(fm(fRing(s*.11, s*.18, 28), mb));
      // vertical bridge connecting loop to crossbar
      loopGrp.add(fm(fPlane(s*.07, s*.18), ma)).position.set(0,0,-s*.14);
      grp.add(loopGrp);
    },
    // 1 – Eye of Horus (𓂀): almond eye, iris, pupil, three cheek marks, kohl tail
    (grp, s, ma, mb) => {
      // upper and lower eyelid strokes meeting at corners
      for (const side of [-1, 1]) {
        for (let k = 0; k < 3; k++) {
          const t = k / 2;
          const ex = THREE.MathUtils.lerp(-s*.30, s*.30, t);
          const ez = Math.sin(t * Math.PI) * s*.14 * side;
          const seg = fm(fPlane(s*.24, s*.065), ma); seg.position.set(ex,0,ez); grp.add(seg);
        }
      }
      // iris ring + filled pupil
      grp.add(fm(fRing(s*.08, s*.13, 20), ma));
      grp.add(fm(fCircle(s*.07), mb));
      // three vertical cheek marks (the falcon stripe below)
      for (let k = 0; k < 3; k++) {
        const ck = fm(fPlane(s*.055, s*.18), ma);
        ck.position.set(-s*.12 + k*s*.12, 0, -s*.24 - k*s*.04);
        ck.rotation.y = (k-1) * 0.18;
        grp.add(ck);
      }
      // kohl extension to the right
      const kl = fm(fPlane(s*.20, s*.055), ma); kl.position.set(s*.40,0, s*.07); kl.rotation.y=-0.48; grp.add(kl);
    },
    // 2 – Ra sun disc (𓇳): filled disc, ring, alternating long/short rays
    (grp, s, ma, mb) => {
      grp.add(fm(fCircle(s*.17), mb));
      grp.add(fm(fRing(s*.20, s*.25, 32), ma));
      for (let ri = 0; ri < 8; ri++) {
        const long = ri % 2 === 0;
        const a2 = (ri / 8) * Math.PI * 2;
        const dist = long ? s*.42 : s*.34;
        const ray = fm(fPlane(s*.055, long ? s*.16 : s*.09), ma);
        ray.position.set(Math.sin(a2)*dist, 0, Math.cos(a2)*dist);
        ray.rotation.y = a2;
        grp.add(ray);
      }
    },
    // 3 – Was-sceptre (𓌀): forked base, thin shaft, animal-head top
    (grp, s, ma, mb) => {
      // thin shaft
      grp.add(fm(fPlane(s*.07, s*.72), ma));
      // animal head (Set-beast): rectangular block + two upright ears
      grp.add(fm(fPlane(s*.22, s*.13), mb)).position.set(-s*.04,0, s*.40);
      grp.add(fm(fPlane(s*.06, s*.14), ma)).position.set(-s*.14,0, s*.50);
      grp.add(fm(fPlane(s*.06, s*.10), ma)).position.set( s*.06,0, s*.48);
      // forked base — two angled prongs
      const fl = fm(fPlane(s*.17, s*.06), ma); fl.position.set(-s*.11,0,-s*.36); fl.rotation.y= 0.55; grp.add(fl);
      const fr = fm(fPlane(s*.17, s*.06), ma); fr.position.set( s*.11,0,-s*.36); fr.rotation.y=-0.55; grp.add(fr);
    },
    // 4 – Sacred ibis in profile (𓅬): horizontal body, long curved beak, legs
    (grp, s, ma, mb) => {
      // body (horizontal oval)
      grp.add(fm(fPlane(s*.48, s*.20), ma)).position.set(s*.04, 0, s*.04);
      // head
      grp.add(fm(fCircle(s*.09), mb)).position.set(-s*.18, 0, s*.20);
      // long curved beak (three angled segments tapering)
      const b1 = fm(fPlane(s*.22, s*.055), ma); b1.position.set(-s*.28,0, s*.12); b1.rotation.y= 0.65; grp.add(b1);
      const b2 = fm(fPlane(s*.16, s*.045), ma); b2.position.set(-s*.40,0,-s*.02); b2.rotation.y= 1.0;  grp.add(b2);
      // two thin legs
      grp.add(fm(fPlane(s*.055, s*.26), ma)).position.set(-s*.02, 0,-s*.22);
      grp.add(fm(fPlane(s*.055, s*.26), ma)).position.set( s*.14, 0,-s*.22);
      // feet (small horizontals)
      grp.add(fm(fPlane(s*.16, s*.05), ma)).position.set(-s*.02, 0,-s*.36);
      grp.add(fm(fPlane(s*.16, s*.05), ma)).position.set( s*.14, 0,-s*.36);
    },
    // 5 – Scarab (𓆣): oval body, spine, spread wings, six legs, antennae
    (grp, s, ma, mb) => {
      grp.add(fm(fRing(s*.09, s*.20, 20), mb)).position.set(0,0, s*.06);
      grp.add(fm(fPlane(s*.08, s*.36), ma));                              // spine
      // wings spread to each side
      const wl = fm(fPlane(s*.28, s*.08), ma); wl.position.set(-s*.22,0, s*.08); wl.rotation.y= 0.5; grp.add(wl);
      const wr = fm(fPlane(s*.28, s*.08), ma); wr.position.set( s*.22,0, s*.08); wr.rotation.y=-0.5; grp.add(wr);
      // six legs (three per side)
      for (const [lx, lz, ry] of [
        [-s*.22, s*.08, 0.75], [ s*.22, s*.08,-0.75],
        [-s*.22,-s*.01,-0.65], [ s*.22,-s*.01, 0.65],
        [-s*.20,-s*.10, 0.45], [ s*.20,-s*.10,-0.45],
      ]) { const lg = fm(fPlane(s*.18, s*.048), ma); lg.position.set(lx,0,lz); lg.rotation.y=ry; grp.add(lg); }
      // antennae
      const al = fm(fPlane(s*.055, s*.18), ma); al.position.set(-s*.10,0, s*.28); al.rotation.y= 0.4; grp.add(al);
      const ar = fm(fPlane(s*.055, s*.18), ma); ar.position.set( s*.10,0, s*.28); ar.rotation.y=-0.4; grp.add(ar);
    },
    // 6 – Ma'at feather (𓂋): spine, tapering barbs, quill, base notch
    (grp, s, ma, mb) => {
      grp.add(fm(fPlane(s*.065, s*.78), ma));                             // spine
      // barbs — longer near the middle, shorter at tip and quill
      const barbs = [
        [s*.38,  s*.27], [s*.44, s*.18], [s*.42, s*.09],
        [s*.38,  0    ], [s*.42,-s*.09], [s*.40,-s*.18],
        [s*.30, -s*.27],
      ];
      for (const [bw, bz] of barbs) {
        const b = fm(fPlane(bw, s*.052), ma); b.position.set(0,0,bz); grp.add(b);
      }
      grp.add(fm(fCircle(s*.07), mb)).position.set(0,0,-s*.37);          // quill nub
      grp.add(fm(fPlane(s*.14, s*.055), ma)).position.set(0,0,-s*.30);   // base notch
    },
    // 7 – Djed pillar (𓌀): four bands, collar, stepped base
    (grp, s, ma, mb) => {
      // four horizontal bands tapering as they rise
      for (const [bz, bw] of [[s*.22,s*.46],[s*.13,s*.38],[s*.04,s*.30],[-s*.05,s*.24]]) {
        grp.add(fm(fPlane(bw, s*.075), ma)).position.set(0,0,bz);
      }
      // collar band just below the top group
      grp.add(fm(fPlane(s*.50, s*.055), mb)).position.set(0,0, s*.30);
      // narrow neck + stepped base
      grp.add(fm(fPlane(s*.20, s*.08), ma)).position.set(0,0,-s*.12);
      grp.add(fm(fPlane(s*.30, s*.065), mb)).position.set(0,0,-s*.20);
      grp.add(fm(fPlane(s*.40, s*.06),  ma)).position.set(0,0,-s*.27);
    },
  ];

  for (let i = 0; i < 8; i++) {
    const a   = (i / 8) * Math.PI * 2;
    const gx  = Math.cos(a) * 11.0;
    const gz  = Math.sin(a) * 11.0;
    const ma  = i % 2 === 0 ? mBright : mMid;

    const grp = new THREE.Group();
    grp.position.set(gx, RUNE_Y + 0.01, gz);
    grp.rotation.y = a;   // symbol Z+ points radially outward

    // cartouche border: four sides + corner dots
    const CW = 1.08, CH = 1.38, SW = 0.065;
    for (const [bx, bz, bw, bd] of [
      [0,  CH/2, CW + SW*2, SW], [0, -CH/2, CW + SW*2, SW],
      [-CW/2, 0, SW, CH],        [ CW/2, 0, SW, CH],
    ]) {
      const side = fm(fPlane(bw, bd), mDeep);
      side.position.set(bx, 0, bz);
      grp.add(side);
    }
    for (const [cx, cz] of [[-CW/2,-CH/2],[-CW/2,CH/2],[CW/2,-CH/2],[CW/2,CH/2]]) {
      const cdot = fm(fCircle(SW * 0.85, 8), mDeep);
      cdot.position.set(cx, 0, cz);
      grp.add(cdot);
    }

    GLYPH_DEFS[i](grp, 0.55, ma, mAccent);
    g.add(grp);
  }

  // ── inner chevron markers at R = 6.5 (×8) ────────────────────────────────
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const grp = new THREE.Group();
    grp.position.set(Math.cos(a) * 6.5, RUNE_Y + 0.008, Math.sin(a) * 6.5);
    grp.rotation.y = a;
    const lv = fm(fPlane(0.28, 0.07), mBright); lv.position.set(-0.12, 0, 0.12); lv.rotation.y=-0.65; grp.add(lv);
    const rv = fm(fPlane(0.28, 0.07), mBright); rv.position.set( 0.12, 0, 0.12); rv.rotation.y= 0.65; grp.add(rv);
    const sv = fm(fPlane(0.08, 0.30), mMid);   sv.position.set(0, 0, -0.06); grp.add(sv);
    g.add(grp);
  }

  // ── double-line spokes with diamond accents (×8) ─────────────────────────
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const inner = 5.1, outer = 9.5, len = outer - inner;
    const midR  = (inner + outer) / 2;
    const perp  = a + Math.PI / 2;

    for (const offset of [-0.09, 0.09]) {
      const lx = Math.cos(a) * midR + Math.cos(perp) * offset;
      const lz = Math.sin(a) * midR + Math.sin(perp) * offset;
      const ln = fm(fPlane(0.055, len), mDeep);
      ln.position.set(lx, RUNE_Y + 0.003, lz);
      ln.rotation.y = a;
      g.add(ln);
    }
    // rotated square (diamond) accent at mid-spoke
    const dm = fm(fPlane(0.20, 0.20), mAccent);
    dm.position.set(Math.cos(a) * midR, RUNE_Y + 0.005, Math.sin(a) * midR);
    dm.rotation.y = a + Math.PI / 4;
    g.add(dm);
  }

  // ── central Eye of Ra ─────────────────────────────────────────────────────
  {
    const ey = new THREE.Group();
    ey.position.y = RUNE_Y + 0.02;
    g.add(ey);

    // iris + pupil
    ey.add(Object.assign(fm(fRing(0.34, 0.52, 40), makeRuneMat(0x66aaff, 0.72)), {}));
    ey.add(Object.assign(fm(fCircle(0.22), makeRuneMat(0xaaddff, 0.90)), {}));

    // almond outline: 5 overlapping plane segments per arc side
    for (const side of [-1, 1]) {
      for (let k = 0; k < 5; k++) {
        const t  = k / 4;
        const ex = THREE.MathUtils.lerp(-1.05, 1.05, t);
        const ez = Math.sin(t * Math.PI) * 0.42 * side;
        const seg = fm(fPlane(0.48, 0.09), mBright);
        seg.position.set(ex, 0, ez);
        ey.add(seg);
      }
    }

    // kohl tails extending from each corner
    const kt1 = fm(fPlane(0.52, 0.08), mMid); kt1.position.set( 1.22, 0,-0.12); kt1.rotation.y= 0.32; ey.add(kt1);
    const kt2 = fm(fPlane(0.52, 0.08), mMid); kt2.position.set(-1.22, 0,-0.12); kt2.rotation.y=-0.32; ey.add(kt2);
  }

  // soft glow disc at lighthouse base
  {
    const emblemGeo = new THREE.CircleGeometry(1.4, 24);
    emblemGeo.rotateX(-Math.PI / 2);
    const emblem = new THREE.Mesh(emblemGeo, makeRuneMat(0x99ccff, 0.38));
    emblem.position.y = RUNE_Y + 0.015;
    g.add(emblem);
  }

  /* ---- lighthouse tower at the centre ---- */
  const tower = new THREE.Group();
  tower.position.y = TOP_THICK / 2;
  g.add(tower);

  // procedural stone block texture — mortared courses baked into a canvas
  const _stoneTex = (() => {
    const W = 512, H = 1024;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#9e8e74';
    ctx.fillRect(0, 0, W, H);
    const id = ctx.getImageData(0, 0, W, H);
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() - 0.5) * 30;
      d[i]   = Math.min(255, Math.max(0, d[i]   + n));
      d[i+1] = Math.min(255, Math.max(0, d[i+1] + n * 0.85));
      d[i+2] = Math.min(255, Math.max(0, d[i+2] + n * 0.65));
    }
    ctx.putImageData(id, 0, 0);
    ctx.strokeStyle = 'rgba(62,48,32,0.62)';
    ctx.lineWidth = 2.5;
    const CH = 36;
    for (let y = 0; y <= H; y += CH) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    ctx.lineWidth = 1.8;
    const BW = 70;
    for (let yi = 0; yi * CH <= H + CH; yi++) {
      const off = (yi % 2 === 0) ? 0 : BW * 0.5;
      const y0 = yi * CH, y1 = y0 + CH;
      for (let x = off; x <= W + BW; x += BW) {
        ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
      }
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 2.5);
    return tex;
  })();

  const towerStoneMat = new THREE.MeshStandardMaterial({
    color: 0xc8b89e,
    map: _stoneTex,
    roughness: 0.90,
  });
  const towerDarkMat  = new THREE.MeshStandardMaterial({ color: 0x5c4a38, roughness: 0.92 });
  const ironMat       = new THREE.MeshStandardMaterial({ color: 0x26201c, roughness: 0.52, metalness: 0.72 });

  // ---- two-tier stepped plinth ----
  const plinthBase = new THREE.Mesh(
    new THREE.CylinderGeometry(3.0, 3.4, 0.55, 32),
    towerDarkMat,
  );
  plinthBase.position.y = 0.275;
  plinthBase.castShadow = true;
  plinthBase.receiveShadow = true;
  tower.add(plinthBase);

  const plinthTop = new THREE.Mesh(
    new THREE.CylinderGeometry(2.5, 3.0, 0.5, 32),
    towerStoneMat,
  );
  plinthTop.position.y = 0.8;
  plinthTop.castShadow = true;
  tower.add(plinthTop);

  // ---- shaft (tapers from base to gallery) ----
  const SHAFT_BOT_R = 2.38, SHAFT_TOP_R = 1.42;
  const SHAFT_BOT_Y = 1.05, SHAFT_TOP_Y = 9.45;
  const shaftH = SHAFT_TOP_Y - SHAFT_BOT_Y;
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(SHAFT_TOP_R, SHAFT_BOT_R, shaftH, 32, 6),
    towerStoneMat,
  );
  shaft.position.y = (SHAFT_BOT_Y + SHAFT_TOP_Y) / 2;
  shaft.castShadow = true;
  tower.add(shaft);

  // five decorative stone bands proud of the shaft surface
  for (const bandY of [2.4, 3.9, 5.4, 6.9, 8.4]) {
    const tRel = (bandY - SHAFT_BOT_Y) / shaftH;
    const r = THREE.MathUtils.lerp(SHAFT_BOT_R, SHAFT_TOP_R, tRel) + 0.17;
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, 0.30, 28),
      towerDarkMat,
    );
    band.position.y = bandY;
    tower.add(band);
  }

  // ---- narrow window slots: 4 directions × 2 heights ----
  const windowMat = new THREE.MeshStandardMaterial({ color: 0x08070a, roughness: 1 });
  const archMat   = new THREE.MeshStandardMaterial({ color: 0x4a3c2c, roughness: 0.92 });
  for (const winY of [3.7, 7.0]) {
    const tRel = (winY - SHAFT_BOT_Y) / shaftH;
    const surfR = THREE.MathUtils.lerp(SHAFT_BOT_R, SHAFT_TOP_R, tRel);
    const WW = 0.26, WH = 0.88;
    for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      const ry = Math.PI / 2 - a;
      const rx = Math.cos(a) * (surfR + 0.07);
      const rz = Math.sin(a) * (surfR + 0.07);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(WW, WH), windowMat);
      face.position.set(Math.cos(a) * (surfR + 0.015), winY, Math.sin(a) * (surfR + 0.015));
      face.rotation.y = ry;
      tower.add(face);
      const sill = new THREE.Mesh(new THREE.BoxGeometry(WW + 0.18, 0.09, 0.13), archMat);
      sill.position.set(rx, winY - WH / 2, rz);
      sill.rotation.y = ry;
      tower.add(sill);
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(WW + 0.18, 0.12, 0.11), archMat);
      lintel.position.set(rx, winY + WH / 2, rz);
      lintel.rotation.y = ry;
      tower.add(lintel);
      for (const side of [-1, 1]) {
        const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.10, WH + 0.06, 0.11), archMat);
        jamb.position.set(
          rx + (-Math.sin(a)) * side * (WW / 2 + 0.05),
          winY,
          rz + Math.cos(a) * side * (WW / 2 + 0.05),
        );
        jamb.rotation.y = ry;
        tower.add(jamb);
      }
    }
  }

  // ---- corbels beneath gallery floor ----
  const corbelMat = new THREE.MeshStandardMaterial({ color: 0x7a6a54, roughness: 0.88 });
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const corbel = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.44, 0.30), corbelMat);
    corbel.position.set(Math.cos(a) * 2.04, 9.36, Math.sin(a) * 2.04);
    corbel.rotation.y = Math.PI / 2 - a;
    tower.add(corbel);
  }

  // ---- gallery platform ----
  const galleryFloor = new THREE.Mesh(
    new THREE.CylinderGeometry(2.15, 1.98, 0.35, 32),
    towerDarkMat,
  );
  galleryFloor.position.y = 9.625;
  galleryFloor.castShadow = true;
  tower.add(galleryFloor);

  // 24 thin iron posts + 3 horizontal rail rings
  const RAIL_R = 1.96;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.036, 0.036, 0.70, 6),
      ironMat,
    );
    post.position.set(Math.cos(a) * RAIL_R, 10.13, Math.sin(a) * RAIL_R);
    tower.add(post);
  }
  for (const railY of [9.84, 10.15, 10.46]) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(RAIL_R, railY < 10.4 ? 0.044 : 0.054, 8, 32),
      ironMat,
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = railY;
    tower.add(ring);
  }

  // ---- transition collar: gallery → lantern room ----
  const LAMP_Y      = 11.25;
  const PANE_H      = 1.70;
  const LAMP_R      = 1.35;
  const LANTERN_BOT = LAMP_Y - PANE_H / 2;

  const collar = new THREE.Mesh(
    new THREE.CylinderGeometry(LAMP_R + 0.08, 2.02, LANTERN_BOT - 9.8, 24),
    towerDarkMat,
  );
  collar.position.y = (9.8 + LANTERN_BOT) / 2;
  tower.add(collar);

  // ---- 12-sided glass lantern room ----
  const PANE_COUNT = 12;
  const PANE_INSET = LAMP_R * Math.cos(Math.PI / PANE_COUNT);
  const PANE_W     = 2 * LAMP_R * Math.sin(Math.PI / PANE_COUNT) - 0.07;

  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xfff6d0,
    emissive: 0xffcc44,
    emissiveIntensity: 0.22,
    transparent: true,
    opacity: 0.40,
    roughness: 0.02,
    metalness: 0.12,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  // 4 iron frame rings (bottom, lower-mid, upper-mid, top)
  for (const fy of [
    LAMP_Y - PANE_H / 2,
    LAMP_Y - PANE_H / 6,
    LAMP_Y + PANE_H / 6,
    LAMP_Y + PANE_H / 2,
  ]) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(LAMP_R + 0.02, 0.052, 8, 22),
      ironMat,
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = fy;
    tower.add(ring);
  }

  for (let i = 0; i < PANE_COUNT; i++) {
    const a    = (i / PANE_COUNT) * Math.PI * 2;
    const aMid = a + Math.PI / PANE_COUNT;

    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.050, 0.050, PANE_H + 0.08, 6),
      ironMat,
    );
    post.position.set(Math.cos(a) * LAMP_R, LAMP_Y, Math.sin(a) * LAMP_R);
    tower.add(post);

    const pane = new THREE.Mesh(new THREE.PlaneGeometry(PANE_W, PANE_H), glassMat);
    pane.position.set(Math.cos(aMid) * PANE_INSET, LAMP_Y, Math.sin(aMid) * PANE_INSET);
    pane.rotation.y = -(aMid + Math.PI / 2);
    tower.add(pane);

    // horizontal mid-bar mullion
    const midBar = new THREE.Mesh(
      new THREE.BoxGeometry(PANE_W - 0.01, 0.040, 0.030),
      ironMat,
    );
    midBar.position.set(Math.cos(aMid) * PANE_INSET, LAMP_Y, Math.sin(aMid) * PANE_INSET);
    midBar.rotation.y = -(aMid + Math.PI / 2);
    tower.add(midBar);
  }

  // ---- geometric light crystal ----
  const lampMat = new THREE.MeshBasicMaterial({
    color: 0xffe9b8,
    transparent: true,
    opacity: 0.88,
    fog: false,
  });
  const lamp = new THREE.Mesh(new THREE.IcosahedronGeometry(0.72, 2), lampMat);
  lamp.position.y = LAMP_Y;
  lamp.rotation.y = Math.PI / 5;
  tower.add(lamp);

  const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
  const coreMesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.32, 1), coreMat);
  coreMesh.position.y = LAMP_Y;
  tower.add(coreMesh);

  const haloMat = new THREE.MeshBasicMaterial({
    color: 0xfff0c4,
    transparent: true,
    opacity: 0.22,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  haloMat.userData.baseOpacity = 0.22;
  const halo = new THREE.Mesh(new THREE.SphereGeometry(1.62, 24, 18), haloMat);
  halo.position.y = LAMP_Y;
  tower.add(halo);

  // ---- roof: iron skirt band + 24-sided cone + 12 iron ribs + spike finial ----
  const ROOF_BASE_Y = LAMP_Y + PANE_H / 2;

  const roofBand = new THREE.Mesh(
    new THREE.CylinderGeometry(1.50, 1.50, 0.24, 24),
    ironMat,
  );
  roofBand.position.y = ROOF_BASE_Y + 0.12;
  tower.add(roofBand);

  const ROOF_H = 2.8;
  const CONE_R = 1.56;
  const roofCone = new THREE.Mesh(
    new THREE.ConeGeometry(CONE_R, ROOF_H, 24),
    towerDarkMat,
  );
  roofCone.position.y = ROOF_BASE_Y + 0.24 + ROOF_H / 2;
  roofCone.castShadow = true;
  tower.add(roofCone);

  // 12 iron ribs aligned with the cone slope using quaternion
  {
    const CONE_BASE_Y = ROOF_BASE_Y + 0.24;
    const CONE_TIP_Y  = CONE_BASE_Y + ROOF_H;
    const slopeLen = Math.hypot(ROOF_H, CONE_R);
    const _yAxis = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const rib = new THREE.Mesh(
        new THREE.CylinderGeometry(0.020, 0.032, slopeLen, 4),
        ironMat,
      );
      rib.position.set(
        Math.cos(a) * CONE_R * 0.50,
        (CONE_BASE_Y + CONE_TIP_Y) / 2,
        Math.sin(a) * CONE_R * 0.50,
      );
      const slopeDir = new THREE.Vector3(
        -Math.cos(a) * CONE_R, ROOF_H, -Math.sin(a) * CONE_R,
      ).normalize();
      rib.quaternion.setFromUnitVectors(_yAxis, slopeDir);
      tower.add(rib);
    }
  }

  const SPIKE_H = 0.72;
  const spike = new THREE.Mesh(
    new THREE.ConeGeometry(0.052, SPIKE_H, 6),
    ironMat,
  );
  spike.position.y = ROOF_BASE_Y + 0.24 + ROOF_H + SPIKE_H / 2;
  tower.add(spike);

  const finialMat = new THREE.MeshStandardMaterial({
    color: 0xffd28a,
    emissive: 0xffd28a,
    emissiveIntensity: 0.7,
    roughness: 0.28,
    metalness: 0.25,
  });
  const finial = new THREE.Mesh(new THREE.SphereGeometry(0.145, 16, 12), finialMat);
  finial.position.y = ROOF_BASE_Y + 0.24 + ROOF_H + SPIKE_H;
  tower.add(finial);

  return { group: g, runeMats, haloMat, lampMat, lampMesh: lamp, coreMesh };
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
