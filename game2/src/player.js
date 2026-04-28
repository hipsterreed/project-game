import * as THREE from "three";

export class Player {
  constructor(camera, world) {
    this.camera = camera;
    this.world = world;

    this.yaw = 0;
    this.pitch = 0;
    this.targetYaw = 0;
    this.targetPitch = 0;

    this.position = camera.position.clone();
    this.velocity = new THREE.Vector3();
    this.targetVelocity = new THREE.Vector3();

    this.eyeHeight = 1.65;
    this.bobPhase = 0;
    this.bobAmount = 0;

    this.keys = { w: false, a: false, s: false, d: false, shift: false };
    this.locked = false;
    this.frozen = false;
    this.cinematic = null;

    this._stepTimer = 0;
    this._stepInterval = 0.5;

    this._bindInput();
  }

  _bindInput() {
    addEventListener("keydown", (e) => {
      if (e.code === "KeyW" || e.code === "ArrowUp") this.keys.w = true;
      if (e.code === "KeyA" || e.code === "ArrowLeft") this.keys.a = true;
      if (e.code === "KeyS" || e.code === "ArrowDown") this.keys.s = true;
      if (e.code === "KeyD" || e.code === "ArrowRight") this.keys.d = true;
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") this.keys.shift = true;
    });
    addEventListener("keyup", (e) => {
      if (e.code === "KeyW" || e.code === "ArrowUp") this.keys.w = false;
      if (e.code === "KeyA" || e.code === "ArrowLeft") this.keys.a = false;
      if (e.code === "KeyS" || e.code === "ArrowDown") this.keys.s = false;
      if (e.code === "KeyD" || e.code === "ArrowRight") this.keys.d = false;
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") this.keys.shift = false;
    });

    addEventListener("mousemove", (e) => {
      if (!this.locked || this.cinematic || this.frozen) return;
      const sens = 0.0022;
      this.targetYaw -= e.movementX * sens;
      this.targetPitch -= e.movementY * sens;
      this.targetPitch = Math.max(
        -Math.PI / 2 + 0.05,
        Math.min(Math.PI / 2 - 0.05, this.targetPitch),
      );
    });

    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement !== null;
    });
  }

  lock() {
    document.body.requestPointerLock?.();
  }

  cinematicLockOn(targetPos) {
    this.cinematic = {
      targetPos: targetPos.clone(),
      startPos: this.position.clone(),
      startYaw: this.yaw,
      startPitch: this.pitch,
      t: 0,
      duration: 4.5,
    };
    document.exitPointerLock?.();
  }

  update(dt, audio) {
    // smooth look
    this.yaw += (this.targetYaw - this.yaw) * Math.min(1, dt * 18);
    this.pitch += (this.targetPitch - this.pitch) * Math.min(1, dt * 18);

    // ---- cinematic ending takeover ----
    if (this.cinematic) {
      const c = this.cinematic;
      c.t = Math.min(c.t + dt, c.duration);
      const k = c.t / c.duration;
      const ease = 1 - Math.pow(1 - k, 3);

      const dx = c.targetPos.x - c.startPos.x;
      const dz = c.targetPos.z - c.startPos.z;
      // stop just short of the lantern, keep a respectful distance
      const stopDist = 1.6;
      const len = Math.sqrt(dx * dx + dz * dz);
      const nx = dx / len, nz = dz / len;
      const goalX = c.targetPos.x - nx * stopDist;
      const goalZ = c.targetPos.z - nz * stopDist;

      this.position.x = c.startPos.x + (goalX - c.startPos.x) * ease;
      this.position.z = c.startPos.z + (goalZ - c.startPos.z) * ease;
      this.position.y = this.eyeHeight + Math.sin(k * Math.PI) * 0.05;

      // look at lantern, drifting up at the end
      const desiredYaw = Math.atan2(-nx, -nz);
      this.yaw += (desiredYaw - this.yaw) * Math.min(1, dt * 1.6);
      const lookUp = ease * 0.6;
      this.pitch += (lookUp - this.pitch) * Math.min(1, dt * 1.2);

      this.camera.position.copy(this.position);
      this.camera.rotation.set(this.pitch, this.yaw, 0, "YXZ");
      return;
    }

    // ---- movement ----
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    let mx = 0, mz = 0;
    if (this.keys.w) mz += 1;
    if (this.keys.s) mz -= 1;
    if (this.keys.a) mx -= 1;
    if (this.keys.d) mx += 1;
    const moveLen = Math.hypot(mx, mz);
    const speed = this.keys.shift ? 1.6 : 2.7;

    if (moveLen > 0) {
      const inv = 1 / moveLen;
      this.targetVelocity
        .copy(forward).multiplyScalar(mz * inv * speed)
        .add(right.clone().multiplyScalar(mx * inv * speed));
    } else {
      this.targetVelocity.set(0, 0, 0);
    }

    // smooth accel
    this.velocity.lerp(this.targetVelocity, Math.min(1, dt * 6));
    this.position.addScaledVector(this.velocity, dt);

    // soft world clamp so the player doesn't wander off the path
    const maxLateral = 6 + Math.max(0, (18 - this.position.z) * 0.25);
    if (this.position.x > maxLateral) this.position.x = maxLateral;
    if (this.position.x < -maxLateral) this.position.x = -maxLateral;
    if (this.position.z > 22) this.position.z = 22;
    if (this.position.z < -34) this.position.z = -34;

    // ---- head bob ----
    const speedNorm = Math.min(1, this.velocity.length() / 2.7);
    const targetBob = speedNorm * (this.keys.shift ? 0.55 : 1);
    this.bobAmount += (targetBob - this.bobAmount) * Math.min(1, dt * 4);
    this.bobPhase += dt * (this.keys.shift ? 5.0 : 7.5) * speedNorm;

    const bobY = Math.sin(this.bobPhase * 2) * 0.045 * this.bobAmount;
    const bobX = Math.cos(this.bobPhase) * 0.03 * this.bobAmount;

    this.camera.position.x = this.position.x + bobX;
    this.camera.position.y = this.eyeHeight + bobY;
    this.camera.position.z = this.position.z;

    this.camera.rotation.set(this.pitch, this.yaw, 0, "YXZ");

    // ---- footstep events ----
    if (audio && speedNorm > 0.15) {
      this._stepInterval = this.keys.shift ? 0.65 : 0.46;
      this._stepTimer += dt;
      if (this._stepTimer >= this._stepInterval) {
        this._stepTimer = 0;
        audio.footstep(speedNorm);
      }
    } else {
      this._stepTimer = this._stepInterval; // primed for next step
    }
  }
}
