import * as THREE from "three";
import { SandParticleShader, WindStreakShader } from "./shaders.js";

/* -----------------------------------------------------------
 * Sand particle systems.
 *   We run three layers, each backed by a single instanced
 *   billboard mesh:
 *
 *   1. FootPuff: short-lived bursts at footsteps, rises and
 *      drifts with the wind.
 *   2. SlideTrail: continuous emission behind the player when
 *      sliding down a steep slope.
 *   3. AmbientDrift: long-lived, slow particles drifting across
 *      camera at all times (the wind made visible).
 *
 *   Each particle carries: position, velocity, life (0..1 where
 *   1 = dead), size, seed. Updates run on the CPU because counts
 *   are modest (a few hundred per layer at peak).
 * --------------------------------------------------------- */

const TMP_V = new THREE.Vector3();

class ParticleLayer {
  constructor({ capacity, color, sunColor, haze, blending, gravity = -1.4, drag = 1.6 }) {
    this.capacity = capacity;
    this.alive = 0;
    this.cursor = 0;
    this.gravity = gravity;
    this.drag = drag;

    // CPU buffers
    this.iPos   = new Float32Array(capacity * 3);
    this.iVel   = new Float32Array(capacity * 3);
    this.iLife  = new Float32Array(capacity);
    this.iLifeMax = new Float32Array(capacity);
    this.iSize  = new Float32Array(capacity);
    this.iSeed  = new Float32Array(capacity);
    // mark-as-dead by setting life to >= 1.0

    for (let i = 0; i < capacity; i++) this.iLife[i] = 1.5;

    // ---- geometry: a unit quad, with per-instance attributes ----
    const base = new THREE.PlaneGeometry(1, 1);
    const inst = new THREE.InstancedBufferGeometry();
    inst.index = base.index;
    inst.attributes.position = base.attributes.position;
    inst.attributes.uv = base.attributes.uv;

    const aPos = new THREE.InstancedBufferAttribute(this.iPos, 3);
    aPos.setUsage(THREE.DynamicDrawUsage);
    inst.setAttribute("iPos", aPos);

    const aLife = new THREE.InstancedBufferAttribute(this.iLife, 1);
    aLife.setUsage(THREE.DynamicDrawUsage);
    inst.setAttribute("iLife", aLife);

    const aSize = new THREE.InstancedBufferAttribute(this.iSize, 1);
    aSize.setUsage(THREE.DynamicDrawUsage);
    inst.setAttribute("iSize", aSize);

    const aSeed = new THREE.InstancedBufferAttribute(this.iSeed, 1);
    inst.setAttribute("iSeed", aSeed);

    inst.instanceCount = capacity;

    // Bounding sphere big enough to never frustum-cull mid-flight.
    inst.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.geometry = inst;
    this.aPos = aPos;
    this.aLife = aLife;
    this.aSize = aSize;
    this.aSeed = aSeed;

    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(SandParticleShader.uniforms),
      vertexShader: SandParticleShader.vertexShader,
      fragmentShader: SandParticleShader.fragmentShader,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: blending ?? THREE.NormalBlending,
    });
    if (color) this.material.uniforms.uColor.value.copy(color);
    if (sunColor) this.material.uniforms.uSunColor.value.copy(sunColor);
    if (haze) this.material.uniforms.uHaze.value.copy(haze);

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  spawn(pos, vel, life, size) {
    // find a dead slot starting from cursor
    let i = this.cursor;
    let scanned = 0;
    while (this.iLife[i] < 1.0 && scanned < this.capacity) {
      i = (i + 1) % this.capacity;
      scanned++;
    }
    if (scanned >= this.capacity) {
      // overwrite cursor anyway
      i = this.cursor;
    }
    this.cursor = (i + 1) % this.capacity;

    const i3 = i * 3;
    this.iPos[i3]     = pos.x;
    this.iPos[i3 + 1] = pos.y;
    this.iPos[i3 + 2] = pos.z;
    this.iVel[i3]     = vel.x;
    this.iVel[i3 + 1] = vel.y;
    this.iVel[i3 + 2] = vel.z;
    this.iLife[i]     = 0.0;
    this.iLifeMax[i]  = life;
    this.iSize[i]     = size;
    this.iSeed[i]     = Math.random();
  }

  update(dt, wind) {
    const cap = this.capacity;
    for (let i = 0; i < cap; i++) {
      if (this.iLife[i] >= 1.0) continue;

      const i3 = i * 3;
      // gravity (positive = rises, used for motes)
      this.iVel[i3 + 1] += this.gravity * dt;

      // wind drift
      if (wind) {
        this.iVel[i3]     += wind.x * 0.6 * dt;
        this.iVel[i3 + 1] += wind.y * 0.6 * dt;
        this.iVel[i3 + 2] += wind.z * 0.6 * dt;
      }

      // air drag
      const drag = 1.0 - this.drag * dt;
      this.iVel[i3]     *= drag;
      this.iVel[i3 + 1] *= drag;
      this.iVel[i3 + 2] *= drag;

      this.iPos[i3]     += this.iVel[i3]     * dt;
      this.iPos[i3 + 1] += this.iVel[i3 + 1] * dt;
      this.iPos[i3 + 2] += this.iVel[i3 + 2] * dt;

      // life
      this.iLife[i] += dt / Math.max(0.01, this.iLifeMax[i]);
      if (this.iLife[i] > 1.0) this.iLife[i] = 1.5; // dead
    }

    this.aPos.needsUpdate = true;
    this.aLife.needsUpdate = true;
    this.aSize.needsUpdate = true;
  }
}

/* -----------------------------------------------------------
 * Wind streak layer: like ParticleLayer, but each instance also
 * carries a velocity attribute so the shader can stretch the
 * billboard along the wind direction. Used to make the wind
 * legible as long, thin dust streaks drifting through the air.
 * --------------------------------------------------------- */
class WindStreakLayer {
  constructor({ capacity, color, haze, opacity = 0.55 }) {
    this.capacity = capacity;
    this.cursor = 0;

    this.iPos  = new Float32Array(capacity * 3);
    this.iVel  = new Float32Array(capacity * 3);
    this.iLife = new Float32Array(capacity);
    this.iLifeMax = new Float32Array(capacity);
    this.iSize = new Float32Array(capacity);
    this.iSeed = new Float32Array(capacity);
    for (let i = 0; i < capacity; i++) this.iLife[i] = 1.5;

    const base = new THREE.PlaneGeometry(1, 1);
    const inst = new THREE.InstancedBufferGeometry();
    inst.index = base.index;
    inst.attributes.position = base.attributes.position;
    inst.attributes.uv = base.attributes.uv;

    const aPos  = new THREE.InstancedBufferAttribute(this.iPos, 3);
    aPos.setUsage(THREE.DynamicDrawUsage);
    inst.setAttribute("iPos", aPos);

    const aVel  = new THREE.InstancedBufferAttribute(this.iVel, 3);
    aVel.setUsage(THREE.DynamicDrawUsage);
    inst.setAttribute("iVel", aVel);

    const aLife = new THREE.InstancedBufferAttribute(this.iLife, 1);
    aLife.setUsage(THREE.DynamicDrawUsage);
    inst.setAttribute("iLife", aLife);

    const aSize = new THREE.InstancedBufferAttribute(this.iSize, 1);
    aSize.setUsage(THREE.DynamicDrawUsage);
    inst.setAttribute("iSize", aSize);

    const aSeed = new THREE.InstancedBufferAttribute(this.iSeed, 1);
    inst.setAttribute("iSeed", aSeed);

    inst.instanceCount = capacity;
    inst.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.geometry = inst;
    this.aPos = aPos;
    this.aVel = aVel;
    this.aLife = aLife;
    this.aSize = aSize;

    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(WindStreakShader.uniforms),
      vertexShader: WindStreakShader.vertexShader,
      fragmentShader: WindStreakShader.fragmentShader,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
    });
    if (color) this.material.uniforms.uColor.value.copy(color);
    if (haze) this.material.uniforms.uHaze.value.copy(haze);
    this.material.uniforms.uOpacity.value = opacity;

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
  }

  spawn(pos, vel, life, size) {
    let i = this.cursor;
    let scanned = 0;
    while (this.iLife[i] < 1.0 && scanned < this.capacity) {
      i = (i + 1) % this.capacity;
      scanned++;
    }
    if (scanned >= this.capacity) i = this.cursor;
    this.cursor = (i + 1) % this.capacity;

    const i3 = i * 3;
    this.iPos[i3]     = pos.x;
    this.iPos[i3 + 1] = pos.y;
    this.iPos[i3 + 2] = pos.z;
    this.iVel[i3]     = vel.x;
    this.iVel[i3 + 1] = vel.y;
    this.iVel[i3 + 2] = vel.z;
    this.iLife[i]     = 0.0;
    this.iLifeMax[i]  = life;
    this.iSize[i]     = size;
    this.iSeed[i]     = Math.random();
  }

  update(dt, wind) {
    const cap = this.capacity;
    for (let i = 0; i < cap; i++) {
      if (this.iLife[i] >= 1.0) continue;

      const i3 = i * 3;

      // Ease the streak's velocity toward the current wind so the
      // streaks all sweep coherently as the wind shifts.
      if (wind) {
        const k = 1.4 * dt;
        this.iVel[i3]     += (wind.x - this.iVel[i3])     * k;
        this.iVel[i3 + 1] += (wind.y - this.iVel[i3 + 1]) * k * 0.6;
        this.iVel[i3 + 2] += (wind.z - this.iVel[i3 + 2]) * k;
      }

      this.iPos[i3]     += this.iVel[i3]     * dt;
      this.iPos[i3 + 1] += this.iVel[i3 + 1] * dt;
      this.iPos[i3 + 2] += this.iVel[i3 + 2] * dt;

      this.iLife[i] += dt / Math.max(0.01, this.iLifeMax[i]);
      if (this.iLife[i] > 1.0) this.iLife[i] = 1.5;
    }

    this.aPos.needsUpdate = true;
    this.aVel.needsUpdate = true;
    this.aLife.needsUpdate = true;
    this.aSize.needsUpdate = true;
  }
}

/* -----------------------------------------------------------
 * Stream layer: path-following motes that follow a quadratic
 * Bezier from a source point to a destination point. Used for
 * the pillar -> tower-top stream so motes actually travel the
 * full distance regardless of how far the pillar is from the
 * tower (physics-based motes get slowed by drag and never
 * arrived at the spire).
 * --------------------------------------------------------- */
class StreamLayer {
  constructor({ capacity, color, sunColor, haze }) {
    this.capacity = capacity;
    this.cursor = 0;

    this.iSrc  = new Float32Array(capacity * 3);
    this.iMid  = new Float32Array(capacity * 3);
    this.iDst  = new Float32Array(capacity * 3);
    this.iPos  = new Float32Array(capacity * 3);
    this.iLife = new Float32Array(capacity);
    this.iLifeMax = new Float32Array(capacity);
    this.iSize = new Float32Array(capacity);
    this.iSeed = new Float32Array(capacity);
    for (let i = 0; i < capacity; i++) this.iLife[i] = 1.5;

    const base = new THREE.PlaneGeometry(1, 1);
    const inst = new THREE.InstancedBufferGeometry();
    inst.index = base.index;
    inst.attributes.position = base.attributes.position;
    inst.attributes.uv = base.attributes.uv;

    const aPos = new THREE.InstancedBufferAttribute(this.iPos, 3);
    aPos.setUsage(THREE.DynamicDrawUsage);
    inst.setAttribute("iPos", aPos);

    const aLife = new THREE.InstancedBufferAttribute(this.iLife, 1);
    aLife.setUsage(THREE.DynamicDrawUsage);
    inst.setAttribute("iLife", aLife);

    const aSize = new THREE.InstancedBufferAttribute(this.iSize, 1);
    aSize.setUsage(THREE.DynamicDrawUsage);
    inst.setAttribute("iSize", aSize);

    const aSeed = new THREE.InstancedBufferAttribute(this.iSeed, 1);
    inst.setAttribute("iSeed", aSeed);

    inst.instanceCount = capacity;
    inst.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.geometry = inst;
    this.aPos = aPos;
    this.aLife = aLife;
    this.aSize = aSize;

    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(SandParticleShader.uniforms),
      vertexShader: SandParticleShader.vertexShader,
      fragmentShader: SandParticleShader.fragmentShader,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    if (color)    this.material.uniforms.uColor.value.copy(color);
    if (sunColor) this.material.uniforms.uSunColor.value.copy(sunColor);
    if (haze)     this.material.uniforms.uHaze.value.copy(haze);

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  spawn(src, mid, dst, life, size) {
    let i = this.cursor;
    let scanned = 0;
    while (this.iLife[i] < 1.0 && scanned < this.capacity) {
      i = (i + 1) % this.capacity;
      scanned++;
    }
    if (scanned >= this.capacity) i = this.cursor;
    this.cursor = (i + 1) % this.capacity;

    const i3 = i * 3;
    this.iSrc[i3]     = src.x; this.iSrc[i3 + 1] = src.y; this.iSrc[i3 + 2] = src.z;
    this.iMid[i3]     = mid.x; this.iMid[i3 + 1] = mid.y; this.iMid[i3 + 2] = mid.z;
    this.iDst[i3]     = dst.x; this.iDst[i3 + 1] = dst.y; this.iDst[i3 + 2] = dst.z;
    // seed the rendered position at the source so the first frame
    // doesn't pop in from the origin.
    this.iPos[i3]     = src.x; this.iPos[i3 + 1] = src.y; this.iPos[i3 + 2] = src.z;
    this.iLife[i]     = 0.0;
    this.iLifeMax[i]  = life;
    this.iSize[i]     = size;
    this.iSeed[i]     = Math.random();
  }

  update(dt) {
    const cap = this.capacity;
    for (let i = 0; i < cap; i++) {
      if (this.iLife[i] >= 1.0) continue;

      this.iLife[i] += dt / Math.max(0.01, this.iLifeMax[i]);
      if (this.iLife[i] > 1.0) {
        this.iLife[i] = 1.5;
        continue;
      }

      // Smoothstep so the mote slows near the endpoints and
      // accelerates through the middle of the arc.
      const t = this.iLife[i];
      const u = t * t * (3 - 2 * t);
      const ou = 1 - u;
      const i3 = i * 3;

      this.iPos[i3]     = ou * ou * this.iSrc[i3]     + 2 * ou * u * this.iMid[i3]     + u * u * this.iDst[i3];
      this.iPos[i3 + 1] = ou * ou * this.iSrc[i3 + 1] + 2 * ou * u * this.iMid[i3 + 1] + u * u * this.iDst[i3 + 1];
      this.iPos[i3 + 2] = ou * ou * this.iSrc[i3 + 2] + 2 * ou * u * this.iMid[i3 + 2] + u * u * this.iDst[i3 + 2];
    }
    this.aPos.needsUpdate = true;
    this.aLife.needsUpdate = true;
    this.aSize.needsUpdate = true;
  }
}

/* -----------------------------------------------------------
 * Sand system: aggregates the three layers and exposes the
 * methods main / player call.
 * --------------------------------------------------------- */
export class SandSystem {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;

    const haze = new THREE.Color("#cfd9c2");
    const sun = new THREE.Color("#ffd28a");
    const warm = new THREE.Color("#f4d49a");
    const pale = new THREE.Color("#e9d2a7");

    this.foot = new ParticleLayer({ capacity: 320, color: warm, sunColor: sun, haze });
    this.slide = new ParticleLayer({ capacity: 480, color: warm, sunColor: sun, haze });
    this.ambient = new ParticleLayer({ capacity: 220, color: pale, sunColor: sun, haze });

    // Memory motes: glowing golden particles that rise around the
    // Echo Walker — additive blending + slight upward gravity so
    // they float and bloom into the warm haze.
    this.motes = new ParticleLayer({
      capacity: 240,
      color: new THREE.Color("#ffe4b8"),
      sunColor: new THREE.Color("#fff5d8"),
      haze: new THREE.Color("#ffd9a0"),
      blending: THREE.AdditiveBlending,
      gravity: 0.5,
      drag: 0.6,
    });

    // Wind streaks: long, thin billboards aligned to the wind so
    // the breeze becomes visually legible.
    this.wind = new WindStreakLayer({
      capacity: 220,
      color: new THREE.Color("#f6efde"),
      haze,
      opacity: 0.5,
    });

    // Path-following stream from each pillar to the spire of the
    // tower. Used by ResonanceSystem when a ruin awakens.
    this.stream = new StreamLayer({
      capacity: 260,
      color: new THREE.Color("#ffe4b8"),
      sunColor: new THREE.Color("#fff5d8"),
      haze: new THREE.Color("#ffd9a0"),
    });

    scene.add(this.foot.mesh);
    scene.add(this.slide.mesh);
    scene.add(this.ambient.mesh);
    scene.add(this.motes.mesh);
    scene.add(this.wind.mesh);
    scene.add(this.stream.mesh);

    // ambient particles refill timer
    this._ambientTimer = 0;
  }

  /* -----------------------------------------------------------
   * Footstep burst: a small puff of sand grains lifted at a foot,
   * biased to trail backward so the visual trail reads.
   * --------------------------------------------------------- */
  emitFootstep(footPos, vel, sprintBlend) {
    // super tiny grain kickup: a small handful of fast-fading specks at
    // the foot. Reads as "sand kicked loose" rather than a big puff.
    const count = Math.floor(THREE.MathUtils.lerp(3, 7, sprintBlend));
    const sp = Math.max(0.001, Math.hypot(vel.x, vel.z));
    const backX = -vel.x / sp;
    const backZ = -vel.z / sp;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.06;
      const p = TMP_V.set(
        footPos.x + Math.cos(a) * r,
        footPos.y + 0.015,
        footPos.z + Math.sin(a) * r,
      );
      const upBias = 0.35 + Math.random() * 0.55;
      const back = 0.25 + Math.random() * 0.45 + sprintBlend * 0.4;
      const v = new THREE.Vector3(
        backX * back + Math.cos(a) * (0.10 + Math.random() * 0.18),
        upBias,
        backZ * back + Math.sin(a) * (0.10 + Math.random() * 0.18),
      );
      this.foot.spawn(
        p,
        v,
        0.28 + Math.random() * 0.22,            // very short life
        0.05 + Math.random() * 0.05,            // tiny size
      );
    }
  }

  /* -----------------------------------------------------------
   * Continuous walking-trail dust: low-rate puffs kicked up while
   * the player is moving, so the trail behind them reads even
   * between footstep events.
   * --------------------------------------------------------- */
  emitTrail(pos, vel, dt, sprintBlend) {
    const sp = Math.hypot(vel.x, vel.z);
    if (sp < 1.0) return;
    // emit rate scales with speed; sprint adds more
    const rate = THREE.MathUtils.lerp(8, 32, Math.min(1, (sp - 1.0) / 7.0)) * (1.0 + sprintBlend);
    const expected = rate * dt;
    let n = Math.floor(expected);
    if (Math.random() < expected - n) n += 1;
    if (n <= 0) return;
    const backX = -vel.x / sp;
    const backZ = -vel.z / sp;
    // perpendicular for lateral spread (left/right of stride)
    const sideX = -backZ;
    const sideZ = backX;
    for (let i = 0; i < n; i++) {
      // emit slightly behind the player
      const back = 0.15 + Math.random() * 0.35;
      const side = (Math.random() - 0.5) * 0.45;
      const p = new THREE.Vector3(
        pos.x + backX * back + sideX * side,
        pos.y + 0.03 + Math.random() * 0.06,
        pos.z + backZ * back + sideZ * side,
      );
      const kick = 0.6 + Math.random() * 1.0 + sprintBlend * 0.8;
      const v = new THREE.Vector3(
        backX * kick + (Math.random() - 0.5) * 0.4,
        0.35 + Math.random() * 0.55,
        backZ * kick + (Math.random() - 0.5) * 0.4,
      );
      this.foot.spawn(
        p,
        v,
        1.2 + Math.random() * 0.9,
        0.30 + Math.random() * 0.22,
      );
    }
  }

  /* -----------------------------------------------------------
   * Landing impact: bigger, lower puff.
   * --------------------------------------------------------- */
  emitLanding(pos, impactSpeed) {
    const count = Math.min(36, 12 + Math.floor(impactSpeed * 2));
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.05 + Math.random() * 0.55;
      const p = TMP_V.set(
        pos.x + Math.cos(a) * r,
        pos.y + 0.05,
        pos.z + Math.sin(a) * r,
      );
      const radial = 1.4 + Math.random() * 1.6;
      const v = new THREE.Vector3(
        Math.cos(a) * radial,
        0.3 + Math.random() * 0.6,
        Math.sin(a) * radial,
      );
      this.foot.spawn(p, v, 0.9 + Math.random() * 0.8, 0.42 + Math.random() * 0.32);
    }
  }

  /* -----------------------------------------------------------
   * Slide trail: emit a stream behind the player while sliding.
   * --------------------------------------------------------- */
  emitSlide(pos, vel, dt, slope) {
    const speed = Math.hypot(vel.x, vel.z);
    if (speed < 1.2) return;
    // emission rate proportional to speed
    const rate = THREE.MathUtils.lerp(20, 90, Math.min(1, (speed - 1.2) / 8));
    const count = rate * dt;
    let n = Math.floor(count);
    if (Math.random() < count - n) n += 1;
    for (let i = 0; i < n; i++) {
      const back = TMP_V.set(-vel.x, 0, -vel.z).normalize();
      const sideX = -back.z, sideZ = back.x;
      const off = (Math.random() - 0.5) * 0.7;
      const p = new THREE.Vector3(
        pos.x + back.x * (0.2 + Math.random() * 0.4) + sideX * off,
        pos.y + 0.05 + Math.random() * 0.1,
        pos.z + back.z * (0.2 + Math.random() * 0.4) + sideZ * off,
      );
      const v = new THREE.Vector3(
        back.x * (1.5 + Math.random()) + (Math.random() - 0.5) * 0.4,
        0.4 + Math.random() * 0.5 + slope * 0.6,
        back.z * (1.5 + Math.random()) + (Math.random() - 0.5) * 0.4,
      );
      this.slide.spawn(p, v, 1.2 + Math.random() * 0.6, 0.38 + Math.random() * 0.3);
    }
  }

  /* -----------------------------------------------------------
   * Ambient: maintain ~N alive particles drifting through the
   * camera frustum. Spawn upwind of the camera and let the wind
   * carry them across.
   * --------------------------------------------------------- */
  ensureAmbient(camera, wind, dt, target = 140) {
    this._ambientTimer += dt;
    // count alive
    let alive = 0;
    const layer = this.ambient;
    for (let i = 0; i < layer.capacity; i++) {
      if (layer.iLife[i] < 1.0) alive++;
    }

    const need = target - alive;
    if (need <= 0) return;

    // spawn batch this frame
    const batch = Math.min(need, 6);
    for (let i = 0; i < batch; i++) {
      // spawn upwind of the camera (opposite wind direction)
      const wDir = TMP_V.copy(wind).normalize();
      // random point in a disc 30..70m upwind, +/- 20m vertically
      const dist = 30 + Math.random() * 40;
      const sideAng = Math.random() * Math.PI * 2;
      const sideR = Math.random() * 28;
      const right = new THREE.Vector3().crossVectors(wDir, new THREE.Vector3(0, 1, 0)).normalize();
      const up = new THREE.Vector3(0, 1, 0);

      const p = new THREE.Vector3();
      p.copy(camera.position)
        .addScaledVector(wDir, -dist)
        .addScaledVector(right, Math.cos(sideAng) * sideR)
        .addScaledVector(up, 1 + Math.sin(sideAng) * 4 + (Math.random() - 0.2) * 6);

      // ensure above ground
      const groundY = this.world.getHeight(p.x, p.z);
      if (p.y < groundY + 0.4) p.y = groundY + 0.4 + Math.random() * 2;

      const v = new THREE.Vector3(
        wDir.x * (2.0 + Math.random() * 1.2),
        (Math.random() - 0.4) * 0.4,
        wDir.z * (2.0 + Math.random() * 1.2),
      );
      layer.spawn(p, v, 3.5 + Math.random() * 2.5, 0.18 + Math.random() * 0.18);
    }
  }

  /* -----------------------------------------------------------
   * Memory motes: glowing particles that lift around the player
   * as they walk — the world responding to their resonance.
   * --------------------------------------------------------- */
  emitMotes(pos, count = 1) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.6 + Math.random() * 1.6;
      const px = pos.x + Math.cos(a) * r;
      const pz = pos.z + Math.sin(a) * r;
      const groundY = this.world.getHeight(px, pz);
      const p = TMP_V.set(px, groundY + 0.05 + Math.random() * 0.25, pz);
      const v = new THREE.Vector3(
        (Math.random() - 0.5) * 0.35,
        0.5 + Math.random() * 0.7,
        (Math.random() - 0.5) * 0.35,
      );
      this.motes.spawn(p, v, 2.2 + Math.random() * 2.4, 0.16 + Math.random() * 0.16);
    }
  }

  /* -----------------------------------------------------------
   * Maintain ~target alive wind streaks in a 3D volume biased
   * upwind of the camera. They drift on the wind and fade in
   * and out with their own life.
   * --------------------------------------------------------- */
  ensureWindStreaks(camera, wind, dt, target = 110) {
    if (!wind) return;
    const layer = this.wind;
    let alive = 0;
    for (let i = 0; i < layer.capacity; i++) {
      if (layer.iLife[i] < 1.0) alive++;
    }
    const need = target - alive;
    if (need <= 0) return;

    const wMag = Math.hypot(wind.x, wind.y, wind.z);
    if (wMag < 0.05) return;

    const wxN = wind.x / wMag;
    const wyN = wind.y / wMag;
    const wzN = wind.z / wMag;
    // right vector = wind x up
    const rxN = wzN, rzN = -wxN;

    const batch = Math.min(need, 6);
    for (let i = 0; i < batch; i++) {
      // upwind distance + sideways spread
      const dist = 18 + Math.random() * 55;
      const sideAng = Math.random() * Math.PI * 2;
      const sideR = Math.random() * 32;
      const cs = Math.cos(sideAng), sn = Math.sin(sideAng);

      const px = camera.position.x - wxN * dist + rxN * cs * sideR;
      const pz = camera.position.z - wzN * dist + rzN * cs * sideR;
      // distribute heights from near-ground up to ~12m above eye
      const heightMix = Math.random();
      let py;
      if (heightMix < 0.35) {
        // low streaks: hugging the dunes
        py = this.world.getHeight(px, pz) + 0.2 + Math.random() * 1.2;
      } else if (heightMix < 0.85) {
        // mid streaks at roughly camera height
        py = camera.position.y + (Math.random() - 0.5) * 4 + sn * 2;
      } else {
        // higher streaks above for depth
        py = camera.position.y + 4 + Math.random() * 9;
      }
      // never spawn below the ground
      const groundY = this.world.getHeight(px, pz);
      if (py < groundY + 0.15) py = groundY + 0.2;

      const speedJitter = 0.85 + Math.random() * 0.5;
      const vx = wind.x * speedJitter;
      const vy = wind.y * speedJitter + (Math.random() - 0.5) * 0.15;
      const vz = wind.z * speedJitter;

      const p = TMP_V.set(px, py, pz);
      const v = new THREE.Vector3(vx, vy, vz);
      // moderate-life streaks; size varies for visual rhythm
      layer.spawn(p, v, 3.8 + Math.random() * 2.6, 0.26 + Math.random() * 0.18);
    }
  }

  emitFootstepMotes(pos, sprintBlend) {
    const count = 1 + Math.floor(Math.random() * 2 + sprintBlend * 2);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.35;
      const p = new THREE.Vector3(
        pos.x + Math.cos(a) * r,
        pos.y + 0.12 + Math.random() * 0.15,
        pos.z + Math.sin(a) * r,
      );
      const v = new THREE.Vector3(
        (Math.random() - 0.5) * 0.4,
        0.7 + Math.random() * 0.6,
        (Math.random() - 0.5) * 0.4,
      );
      this.motes.spawn(p, v, 2.5 + Math.random() * 2.0, 0.18 + Math.random() * 0.16);
    }
  }

  update(dt, t, wind, camera, player) {
    this.foot.material.uniforms.uTime.value = t;
    this.slide.material.uniforms.uTime.value = t;
    this.ambient.material.uniforms.uTime.value = t;
    this.motes.material.uniforms.uTime.value = t;
    this.wind.material.uniforms.uTime.value = t;
    this.stream.material.uniforms.uTime.value = t;

    if (camera && wind) {
      this.ensureAmbient(camera, wind, dt, 90);
      this.ensureWindStreaks(camera, wind, dt, 110);
    }

    this.foot.update(dt, wind);
    this.slide.update(dt, wind);
    this.ambient.update(dt, wind);
    this.motes.update(dt, wind);
    this.wind.update(dt, wind);
    this.stream.update(dt);
  }
}
