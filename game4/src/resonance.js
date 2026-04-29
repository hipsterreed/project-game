import * as THREE from "three";

/* -----------------------------------------------------------
 * ResonanceSystem
 *
 *   The world responds to the Echo Walker. Each ruin cluster
 *   is given an `awakening` factor in [0, 1]. While the player
 *   is near, awakening rises; when they leave, it slowly fades.
 *
 *   The awakening factor drives:
 *     - emissive intensity on the ruin's own stone material
 *     - a glowing crystal core that hovers above the cluster
 *     - a warm point light, so neighbouring stones catch it
 *     - a stream of golden motes lifting from the cluster
 *     - flowers blooming from the sand around the cluster
 *     - a discrete chime when the ruin first wakes (per visit)
 *
 *   The cap on awake ruins keeps the cost flat: at any moment
 *   only the few clusters within RANGE of the player matter.
 * --------------------------------------------------------- */

const RANGE = 13.0;
const TMP_V = new THREE.Vector3();
const TMP_VEL = new THREE.Vector3();
const TMP_DIR = new THREE.Vector3();

export class ResonanceSystem {
  constructor({ scene, world, player, sand, flowers, audio, towerPos }) {
    this.scene = scene;
    this.world = world;
    this.player = player;
    this.sand = sand;
    this.flowers = flowers;
    this.audio = audio;
    this.towerPos = towerPos || (world.archTrigger ? world.archTrigger.clone() : new THREE.Vector3(0, 0, -340));

    this.ruins = [];

    // ONE shared point light that follows the most-awake ruin. We
    // never add per-ruin lights, because toggling lights' visibility
    // changes the lights uniform array length and forces Three.js
    // to recompile every standard material in the scene (terrain +
    // ruins + character) — which is what was causing the freeze on
    // the first chime.
    this.sharedLight = new THREE.PointLight(0xffc890, 0.0, 9.0, 1.6);
    this.sharedLight.position.set(0, 100, 0);
    scene.add(this.sharedLight);

    // ---- restoration ripple state ----
    // When the player presses E at the shrine, a wave expands outward
    // from this center, forcing each ruin/wind-stone within its band
    // to peak awakening as the wave passes through it.
    this.ripple = null;

    const clusters = world.ruins?.userData?.clusters ?? [];
    for (const cluster of clusters) {
      const meta = this._setupCluster(cluster);
      this.ruins.push(meta);
    }
  }

  _setupCluster(cluster) {
    // The shared stone material was attached to the cluster as
    // userData.stoneMaterial in scene.js. Drive emissive on it.
    const stoneMat = cluster.userData.stoneMaterial;
    const engMat = cluster.userData.engravingMaterial;
    const engGroup = cluster.userData.engravingGroup;
    const engravings = cluster.userData.engravings || [];
    const pillarTopY = cluster.userData.pillarTopY || 4.0;

    // glow core: a small crystal hovering above the broken pillar.
    // Hidden by default; the resonance loop reveals it only when
    // the ruin actually awakens, so distant ruins cost nothing.
    const coreGeo = new THREE.IcosahedronGeometry(0.085, 1);
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xffd9a0,
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
    });
    const core = new THREE.Mesh(coreGeo, coreMat);
    core.position.set(0, 4.0, 0);
    core.visible = false;
    cluster.add(core);

    // halo (outer translucent shell)
    const haloGeo = new THREE.IcosahedronGeometry(0.18, 1);
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0xffb060,
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
    });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.position.copy(core.position);
    halo.visible = false;
    cluster.add(halo);

    // No per-ruin point light here. A single scene-level shared
    // light is moved to the most-awake ruin each frame, keeping the
    // lights uniform stable and avoiding shader recompiles.

    // world-space pivot for distance checks (cluster.position is
    // already in world coords because the ruins parent group is at
    // origin)
    const worldPos = cluster.position.clone();

    return {
      cluster,
      stoneMat,
      engMat,
      engGroup,
      engravings,
      pillarTopY,
      core,
      halo,
      worldPos,
      awakening: 0,
      targetAwakening: 0,
      flowerTimer: 0,
      moteTimer: 0,
      streamTimer: 0,
      lastChimeT: -1e6,
      hasChimedThisVisit: false,
      // identifying offset for chime variation (so different ruins
      // play different notes)
      seed: (worldPos.x * 13.7 + worldPos.z * 7.3) | 0,
    };
  }

  triggerRipple(center, opts = {}) {
    this.ripple = {
      cx: center.x, cy: center.y, cz: center.z,
      speed: opts.speed ?? 36,
      maxRadius: opts.maxRadius ?? 200,
      bandHalf: opts.bandHalf ?? 6,
      radius: 0,
      done: false,
      onComplete: opts.onComplete,
      onCompleteFiredOnce: false,
    };
    // reset per-visit chime latch on every ruin so they can ring again
    for (const r of this.ruins) {
      r.hasChimedThisVisit = false;
      // also clear any awakening so the ripple drives the light up
      r.awakening = Math.max(r.awakening, 0.0);
    }
  }

  update(dt, t) {
    const playerPos = this.player.position;
    // Squared cull distance: anything beyond this AND already
    // fully dark is skipped wholesale.
    const CULL_R2 = (RANGE * 1.5) * (RANGE * 1.5);

    // Track the most-awake ruin so we can place the single shared
    // light at it each frame.
    let bestRuin = null;
    let bestA = 0;

    // ---- advance the restoration ripple, if any ----
    let ripple = this.ripple;
    if (ripple && !ripple.done) {
      ripple.radius += ripple.speed * dt;
      if (ripple.radius >= ripple.maxRadius) {
        ripple.done = true;
        if (!ripple.onCompleteFiredOnce) {
          ripple.onCompleteFiredOnce = true;
          ripple.onComplete?.();
        }
      }
    }

    for (const ruin of this.ruins) {
      const dx = playerPos.x - ruin.worldPos.x;
      const dz = playerPos.z - ruin.worldPos.z;
      const d2 = dx * dx + dz * dz;

      // Fast cull: far away AND already at zero awakening — nothing
      // to update or render.
      if (d2 > CULL_R2 && ruin.awakening < 0.005) {
        if (ruin.core.visible) {
          ruin.core.visible = false;
          ruin.halo.visible = false;
          if (ruin.engGroup) ruin.engGroup.visible = false;
          ruin.stoneMat.emissiveIntensity = 0;
          if (ruin.engMat) ruin.engMat.opacity = 0;
        }
        continue;
      }

      const d = Math.sqrt(d2);
      const u = THREE.MathUtils.clamp(1 - d / RANGE, 0, 1);
      let targetA = u * u * (3 - 2 * u);

      // ---- restoration ripple override ----
      // If the ripple band passes through this ruin right now, drive
      // its target to 1 so it lights up like a stadium wave.
      if (ripple) {
        const rdx = ruin.worldPos.x - ripple.cx;
        const rdz = ruin.worldPos.z - ripple.cz;
        const rd = Math.hypot(rdx, rdz);
        const inBand = Math.abs(rd - ripple.radius) < ripple.bandHalf;
        const passed = rd < ripple.radius;
        if (inBand) targetA = 1.0;
        // once passed, hold the awakening at a strong baseline so the
        // world stays lit after the wave moves on
        else if (passed) targetA = Math.max(targetA, 0.55);
      }
      ruin.targetAwakening = targetA;

      // asymmetric lerp: rises faster, fades slower
      const speed = ruin.targetAwakening > ruin.awakening ? 1.6 : 0.45;
      ruin.awakening = THREE.MathUtils.damp(
        ruin.awakening, ruin.targetAwakening, speed, dt,
      );

      const a = ruin.awakening;

      // toggle the per-ruin meshes' visibility (cheap — Mesh.visible
      // is a render flag, not a shader parameter, so no recompile)
      const wantVisible = a > 0.02;
      if (ruin.core.visible !== wantVisible) {
        ruin.core.visible = wantVisible;
        ruin.halo.visible = wantVisible;
        if (ruin.engGroup) ruin.engGroup.visible = wantVisible;
        if (!wantVisible) {
          ruin.stoneMat.emissiveIntensity = 0;
          if (ruin.engMat) ruin.engMat.opacity = 0;
        }
      }
      if (!wantVisible) continue;

      // remember the leader for the shared light
      if (a > bestA) {
        bestA = a;
        bestRuin = ruin;
      }

      // ---- visuals ----
      // pulse: per-ruin phase so they don't all breathe in sync
      const phase = ruin.seed * 0.001;
      const pulse = 0.65 + Math.sin(t * 1.8 + phase) * 0.35;

      // The stone itself stays unlit — only the engravings glow.
      // (Leave emissive at 0 so the pillar body reads as plain stone
      // catching the shared warm point light below.)
      ruin.stoneMat.emissiveIntensity = 0;

      // engravings glow with the awakening (additive material — opacity
      // here drives source intensity, so 1.0 is the punchy upper limit).
      // Pushed up since the stone no longer carries any of the glow.
      if (ruin.engMat) {
        ruin.engMat.opacity = a * (0.85 + pulse * 0.45);
      }

      // core sphere: opacity scales with awakening, scale gently pulses
      const coreScale = 0.6 + a * 0.6 + pulse * 0.18 * a;
      ruin.core.scale.setScalar(coreScale);
      ruin.core.material.opacity = a * (0.55 + pulse * 0.4);

      // halo larger and softer
      ruin.halo.scale.setScalar(0.7 + a * 0.9 + pulse * 0.3 * a);
      ruin.halo.material.opacity = a * (0.10 + pulse * 0.10);

      // ---- mote emission ----
      if (a > 0.18) {
        ruin.moteTimer += dt;
        const interval = THREE.MathUtils.lerp(0.12, 0.04, a);
        while (ruin.moteTimer >= interval) {
          ruin.moteTimer -= interval;
          this._emitMote(ruin);
        }
        // light particles streaming toward the tower
        ruin.streamTimer += dt;
        const streamInterval = THREE.MathUtils.lerp(0.18, 0.06, a);
        while (ruin.streamTimer >= streamInterval) {
          ruin.streamTimer -= streamInterval;
          this._emitStreamMote(ruin);
        }
      } else {
        ruin.moteTimer = 0;
        ruin.streamTimer = 0;
      }

      // ---- flower spawn ----
      if (a > 0.45) {
        ruin.flowerTimer += dt;
        // faster bloom rate the more awake the ruin is
        const interval = THREE.MathUtils.lerp(1.6, 0.55, a);
        if (ruin.flowerTimer >= interval) {
          ruin.flowerTimer = 0;
          this._spawnFlower(ruin);
        }
      } else {
        ruin.flowerTimer = 0;
      }

      // ---- chime once per visit, when crossing 0.5 awakening ----
      if (a > 0.5 && !ruin.hasChimedThisVisit) {
        ruin.hasChimedThisVisit = true;
        ruin.lastChimeT = t;
        this.audio?.playRuinChime?.(ruin.seed);
      }
      // reset the per-visit latch when the ruin fully fades back
      if (ruin.targetAwakening < 0.05 && a < 0.08) {
        ruin.hasChimedThisVisit = false;
      }
    }

    // ---- drive the shared light from the leader ruin ----
    // Position is moved continuously (no light add/remove) so the
    // lights uniform array length never changes -> no recompile.
    if (bestRuin) {
      this.sharedLight.position.set(
        bestRuin.worldPos.x,
        bestRuin.worldPos.y + 4.0,
        bestRuin.worldPos.z,
      );
      // ease the intensity so it doesn't snap when the leader changes
      const target = bestA * 2.4;
      this.sharedLight.intensity = THREE.MathUtils.damp(
        this.sharedLight.intensity, target, 6, dt,
      );
    } else {
      this.sharedLight.intensity = THREE.MathUtils.damp(
        this.sharedLight.intensity, 0, 4, dt,
      );
    }
  }

  _emitMote(ruin) {
    if (!this.sand?.motes) return;
    const angle = Math.random() * Math.PI * 2;
    const r = 0.4 + Math.random() * 1.6;
    const px = ruin.worldPos.x + Math.cos(angle) * r;
    const pz = ruin.worldPos.z + Math.sin(angle) * r;
    const groundY = this.world.getHeight(px, pz);
    const py = groundY + 0.2 + Math.random() * 0.6;
    TMP_V.set(px, py, pz);
    TMP_VEL.set(
      (Math.random() - 0.5) * 0.4,
      0.45 + Math.random() * 0.7,
      (Math.random() - 0.5) * 0.4,
    );
    this.sand.motes.spawn(TMP_V, TMP_VEL, 2.6 + Math.random() * 2.0, 0.18 + Math.random() * 0.16);
  }

  /* a mote drifting from the pillar toward the tower (visually
   * linking pillar -> tower). Uses the path-following stream
   * layer so the mote arcs up and arrives at the spire instead
   * of dying mid-flight from drag. */
  _emitStreamMote(ruin) {
    if (!this.sand?.stream) return;
    const px = ruin.worldPos.x;
    const py = ruin.worldPos.y + ruin.pillarTopY + 0.4 + Math.random() * 0.4;
    const pz = ruin.worldPos.z;
    TMP_V.set(px, py, pz);

    // Destination: high up in the sunrise direction (toward The Last
    // Light). With the tower removed, motes lift up toward the sky
    // instead — visually the same intent (ascending light).
    const ang = Math.random() * Math.PI * 2;
    const r = 0.6 + Math.random() * 1.6;
    const dstX = this.towerPos.x + Math.cos(ang) * r;
    const dstY = this.towerPos.y + Math.random() * 8;
    const dstZ = this.towerPos.z + Math.sin(ang) * r;
    TMP_DIR.set(dstX, dstY, dstZ);

    // Mid control point: midway between pillar and tower, lifted
    // high above the line so the mote arcs upward through the air
    // rather than skimming the dunes.
    const midX = (px + dstX) * 0.5 + (Math.random() - 0.5) * 8;
    const midZ = (pz + dstZ) * 0.5 + (Math.random() - 0.5) * 8;
    const horizDist = Math.hypot(dstX - px, dstZ - pz);
    const arch = THREE.MathUtils.clamp(horizDist * 0.45, 14, 80);
    const midY = Math.max(py, dstY) + arch + Math.random() * 6;
    TMP_VEL.set(midX, midY, midZ);

    // Travel time scales with distance so far pillars don't stream
    // unrealistically fast. Particles arrive at the spire and fade.
    const life = 4.5 + horizDist / 55;
    this.sand.stream.spawn(
      TMP_V,
      TMP_VEL,
      TMP_DIR,
      life,
      0.18 + Math.random() * 0.12,
    );
  }

  _spawnFlower(ruin) {
    if (!this.flowers) return;
    const angle = Math.random() * Math.PI * 2;
    const r = 1.2 + Math.random() * 2.4;
    const x = ruin.worldPos.x + Math.cos(angle) * r;
    const z = ruin.worldPos.z + Math.sin(angle) * r;
    this.flowers.spawn(x, z);
  }
}
