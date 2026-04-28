import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

const EYE_HEIGHT = 1.65;
const WALK_SPEED = 4.5;
const ACCEL = 8;
const FRICTION = 6;

export class Player {
  constructor(camera, domElement, world) {
    this.camera = camera;
    this.domElement = domElement;
    this.world = world;

    this.controls = new PointerLockControls(camera, domElement);
    this.velocity = new THREE.Vector3();
    this.move = { f: 0, b: 0, l: 0, r: 0 };

    this._tmpForward = new THREE.Vector3();
    this._tmpRight = new THREE.Vector3();
    this._tmpDir = new THREE.Vector3();

    // Head bob state
    this.bobTime = 0;
    this.bobAmount = 0;

    // Footstep cadence
    this.stepPhase = 0;
    this.lastStepPhase = 0;
    this.onStep = null;

    document.addEventListener('keydown', (e) => {
      switch (e.code) {
        case 'KeyW': case 'ArrowUp': this.move.f = 1; break;
        case 'KeyS': case 'ArrowDown': this.move.b = 1; break;
        case 'KeyA': case 'ArrowLeft': this.move.l = 1; break;
        case 'KeyD': case 'ArrowRight': this.move.r = 1; break;
      }
    });
    document.addEventListener('keyup', (e) => {
      switch (e.code) {
        case 'KeyW': case 'ArrowUp': this.move.f = 0; break;
        case 'KeyS': case 'ArrowDown': this.move.b = 0; break;
        case 'KeyA': case 'ArrowLeft': this.move.l = 0; break;
        case 'KeyD': case 'ArrowRight': this.move.r = 0; break;
      }
    });
  }

  lock() {
    try { this.controls.lock(); } catch (e) { console.warn('pointer lock:', e); }
  }

  isLocked() {
    return this.controls.isLocked;
  }

  getSpeedNormalized() {
    const horiz = Math.hypot(this.velocity.x, this.velocity.z);
    return Math.min(1, horiz / WALK_SPEED);
  }

  update(dt, active) {
    if (!active) {
      // Decay velocity even when paused
      this.velocity.multiplyScalar(Math.max(0, 1 - FRICTION * dt));
      return;
    }

    // Compute input direction in camera-local space, then in world space (xz only)
    const fwd = this.move.f - this.move.b;
    const side = this.move.r - this.move.l;

    this.camera.getWorldDirection(this._tmpForward);
    this._tmpForward.y = 0;
    this._tmpForward.normalize();
    this._tmpRight.crossVectors(this._tmpForward, this.camera.up).normalize();

    this._tmpDir.set(0, 0, 0)
      .addScaledVector(this._tmpForward, fwd)
      .addScaledVector(this._tmpRight, side);

    if (this._tmpDir.lengthSq() > 0.0001) {
      this._tmpDir.normalize();
      this.velocity.x += this._tmpDir.x * ACCEL * dt;
      this.velocity.z += this._tmpDir.z * ACCEL * dt;
    }

    // Friction
    const f = Math.max(0, 1 - FRICTION * dt);
    this.velocity.x *= f;
    this.velocity.z *= f;

    // Cap horizontal speed
    const horiz = Math.hypot(this.velocity.x, this.velocity.z);
    if (horiz > WALK_SPEED) {
      const k = WALK_SPEED / horiz;
      this.velocity.x *= k;
      this.velocity.z *= k;
    }

    // Apply
    this.camera.position.x += this.velocity.x * dt;
    this.camera.position.z += this.velocity.z * dt;

    // Soft world bounds
    const B = 100;
    this.camera.position.x = THREE.MathUtils.clamp(this.camera.position.x, -B, B);
    this.camera.position.z = THREE.MathUtils.clamp(this.camera.position.z, -B, B);

    // Stick to terrain + head bob
    const ty = this.world.heightAt(this.camera.position.x, this.camera.position.z);
    const targetEye = ty + EYE_HEIGHT;

    const speedN = this.getSpeedNormalized();
    this.bobTime += dt * (5 + speedN * 5);
    this.bobAmount = THREE.MathUtils.lerp(this.bobAmount, speedN * 0.06, 4 * dt);
    const bob = Math.sin(this.bobTime) * this.bobAmount;

    // Smooth Y to terrain
    this.camera.position.y = THREE.MathUtils.lerp(
      this.camera.position.y,
      targetEye + bob,
      Math.min(1, 10 * dt)
    );

    // FOV breathing - widens slightly with speed
    const targetFov = 62 + speedN * 4;
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, 0.05);
    this.camera.updateProjectionMatrix();

    // Footstep callback - fire on bob phase wraps
    this.stepPhase = this.bobTime;
    const STEP_INTERVAL = Math.PI; // each half cycle = one step
    if (
      speedN > 0.15 &&
      Math.floor(this.stepPhase / STEP_INTERVAL) !==
        Math.floor(this.lastStepPhase / STEP_INTERVAL)
    ) {
      if (this.onStep) this.onStep(speedN);
    }
    this.lastStepPhase = this.stepPhase;
  }
}
