import * as THREE from "three";

/* -----------------------------------------------------------
 * Ribbon: a verlet-rope chain rendered as a thin flat strip.
 *
 *   Used for the long cloth ribbons that trail behind the
 *   Echo Walker. Each ribbon is one rope (a chain of N+1 nodes
 *   with distance constraints), pinned at the anchor end and
 *   free at the trailing tip. Width is fixed; we orient the
 *   strip perpendicular to the local tangent so it flutters
 *   naturally instead of looking like a wire.
 *
 *   Material: vertex-coloured so the colour fades from a
 *   weathered cloth tone at the anchor toward a warm glow at
 *   the tip ("memory being pulled through the air").
 * --------------------------------------------------------- */

const TMP_AP = new THREE.Vector3();
const TMP_R = new THREE.Vector3();
const TMP_U = new THREE.Vector3();
const TMP_F = new THREE.Vector3();
const TMP_PIN = new THREE.Vector3();
const TMP_T = new THREE.Vector3();
const TMP_N = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

export class Ribbon {
  constructor({
    length = 2.6,
    segments = 16,
    width = 0.07,
    anchor,
    offset = new THREE.Vector3(0, 0, 0.12), // local-space offset from anchor
    topColor = new THREE.Color("#8a3a26"),
    tipColor = new THREE.Color("#ffc78a"),
  } = {}) {
    this.length = length;
    this.segments = segments;
    this.width = width;
    this.anchor = anchor;
    this.offset = offset.clone();
    this.topColor = topColor;
    this.tipColor = tipColor;
    this.segLen = length / segments;

    const N = segments + 1;
    this.N = N;
    this.pos = new Float32Array(N * 3);
    this.prev = new Float32Array(N * 3);

    this._initPositions();

    // ---- mesh ----
    // PlaneGeometry(width, length, 1, segments) gives a 2-col x
    // (segments+1)-row grid. col 0 = left edge, col 1 = right edge.
    // Vertex order: index = row * 2 + col.
    this.geo = new THREE.PlaneGeometry(width, length, 1, segments);
    this.geo.translate(0, -length * 0.5, 0); // top row sits at y=0

    // vertex colours (gradient anchor -> tip)
    const colors = new Float32Array(this.geo.attributes.position.count * 3);
    for (let row = 0; row < N; row++) {
      const t = row / (N - 1); // 0=top, 1=tip
      const c = new THREE.Color().lerpColors(topColor, tipColor, smoothstep(0, 1, t));
      for (let col = 0; col < 2; col++) {
        const idx = (row * 2 + col) * 3;
        colors[idx] = c.r;
        colors[idx + 1] = c.g;
        colors[idx + 2] = c.b;
      }
    }
    this.geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    this.material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      transparent: false,
      depthWrite: true,
    });

    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;

    this.posAttr = this.geo.attributes.position;
  }

  _initPositions() {
    const ap = TMP_AP;
    if (this.anchor) {
      this.anchor.updateWorldMatrix(true, false);
      this.anchor.getWorldPosition(ap);
    } else {
      ap.set(0, 1.2, 0);
    }
    for (let i = 0; i < this.N; i++) {
      const i3 = i * 3;
      // hang straight down from anchor on init
      this.pos[i3]     = ap.x + this.offset.x;
      this.pos[i3 + 1] = ap.y + this.offset.y - i * this.segLen;
      this.pos[i3 + 2] = ap.z + this.offset.z;
      this.prev[i3]     = this.pos[i3];
      this.prev[i3 + 1] = this.pos[i3 + 1];
      this.prev[i3 + 2] = this.pos[i3 + 2];
    }
  }

  reset(anchor) {
    if (anchor) this.anchor = anchor;
    this._initPositions();
  }

  /* -----------------------------------------------------------
   * Pin position in world space derived from the anchor's
   * world transform plus the local-space offset.
   * --------------------------------------------------------- */
  _writePin(out) {
    this.anchor.updateWorldMatrix(true, false);
    const e = this.anchor.matrixWorld.elements;
    TMP_R.set(e[0], e[1], e[2]).normalize();
    TMP_U.set(e[4], e[5], e[6]).normalize();
    TMP_F.set(e[8], e[9], e[10]).normalize();
    this.anchor.getWorldPosition(out);
    out.addScaledVector(TMP_R, this.offset.x)
       .addScaledVector(TMP_U, this.offset.y)
       .addScaledVector(TMP_F, this.offset.z);
  }

  update(dt, wind, world, options = {}) {
    // sub-step for stability with large dt
    const subSteps = dt > 1 / 50 ? 2 : 1;
    const sdt = dt / subSteps;
    for (let s = 0; s < subSteps; s++) {
      this._step(sdt, wind, world, options);
    }
    this._writeMesh();
  }

  _step(dt, wind, world, options) {
    const N = this.N;

    // 1. update pin
    this._writePin(TMP_PIN);
    this.pos[0] = TMP_PIN.x;
    this.pos[1] = TMP_PIN.y;
    this.pos[2] = TMP_PIN.z;
    this.prev[0] = this.pos[0];
    this.prev[1] = this.pos[1];
    this.prev[2] = this.pos[2];

    // 2. integrate
    const damping = 0.985;
    const gravity = options.gravity ?? -5.5; // ribbons lighter than cloak
    const t0 = performance.now() * 0.001;

    for (let i = 1; i < N; i++) {
      const i3 = i * 3;
      const r = i / (N - 1);              // 0 at root, 1 at tip
      const windScale = 0.6 + r * 2.6;    // tip catches more wind

      const px = this.pos[i3];
      const py = this.pos[i3 + 1];
      const pz = this.pos[i3 + 2];
      const vx = (px - this.prev[i3]) * damping;
      const vy = (py - this.prev[i3 + 1]) * damping;
      const vz = (pz - this.prev[i3 + 2]) * damping;

      // turbulence: per-node oscillation, more at tip
      const tu = Math.sin(t0 * 2.4 + i * 0.6) * 0.08 * r;
      const tw = Math.cos(t0 * 1.9 + i * 1.1) * 0.08 * r;

      const ax = (wind.x * windScale + tu) * dt;
      const ay = (wind.y * windScale + gravity) * dt;
      const az = (wind.z * windScale + tw) * dt;

      this.prev[i3]     = px;
      this.prev[i3 + 1] = py;
      this.prev[i3 + 2] = pz;

      this.pos[i3]     = px + vx + ax * dt;
      this.pos[i3 + 1] = py + vy + ay * dt;
      this.pos[i3 + 2] = pz + vz + az * dt;
    }

    // 3. constraint solve (distance constraints between neighbors)
    const iters = 10;
    for (let it = 0; it < iters; it++) {
      // re-pin top each iteration
      this.pos[0] = TMP_PIN.x;
      this.pos[1] = TMP_PIN.y;
      this.pos[2] = TMP_PIN.z;

      for (let i = 0; i < N - 1; i++) {
        const a = i * 3;
        const b = (i + 1) * 3;
        const dx = this.pos[b]     - this.pos[a];
        const dy = this.pos[b + 1] - this.pos[a + 1];
        const dz = this.pos[b + 2] - this.pos[a + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        const diff = (d - this.segLen) / d;
        if (i === 0) {
          // a (root) is pinned; only move b
          this.pos[b]     -= dx * diff;
          this.pos[b + 1] -= dy * diff;
          this.pos[b + 2] -= dz * diff;
        } else {
          const half = diff * 0.5;
          this.pos[a]     += dx * half;
          this.pos[a + 1] += dy * half;
          this.pos[a + 2] += dz * half;
          this.pos[b]     -= dx * half;
          this.pos[b + 1] -= dy * half;
          this.pos[b + 2] -= dz * half;
        }
      }
    }

    // 4. ground collision
    if (world && world.getHeight) {
      for (let i = 1; i < N; i++) {
        const i3 = i * 3;
        const ground = world.getHeight(this.pos[i3], this.pos[i3 + 2]) + 0.02;
        if (this.pos[i3 + 1] < ground) {
          this.pos[i3 + 1] = ground;
          // tangential friction
          this.prev[i3]     = this.pos[i3]     + (this.pos[i3]     - this.prev[i3])     * 0.4;
          this.prev[i3 + 2] = this.pos[i3 + 2] + (this.pos[i3 + 2] - this.prev[i3 + 2]) * 0.4;
        }
      }
    }
  }

  _writeMesh() {
    const arr = this.posAttr.array;
    const N = this.N;
    const halfW = this.width * 0.5;

    for (let i = 0; i < N; i++) {
      const i3 = i * 3;

      // tangent: forward difference (or backward at the tip)
      let tx, ty, tz;
      if (i < N - 1) {
        tx = this.pos[(i + 1) * 3]     - this.pos[i3];
        ty = this.pos[(i + 1) * 3 + 1] - this.pos[i3 + 1];
        tz = this.pos[(i + 1) * 3 + 2] - this.pos[i3 + 2];
      } else {
        tx = this.pos[i3]     - this.pos[(i - 1) * 3];
        ty = this.pos[i3 + 1] - this.pos[(i - 1) * 3 + 1];
        tz = this.pos[i3 + 2] - this.pos[(i - 1) * 3 + 2];
      }
      TMP_T.set(tx, ty, tz);
      const tlen = TMP_T.length();
      if (tlen > 1e-6) TMP_T.multiplyScalar(1 / tlen);

      // ribbon-right = tangent x worldUp; fall back if degenerate.
      TMP_N.crossVectors(TMP_T, WORLD_UP);
      let nlen = TMP_N.length();
      if (nlen < 0.02) {
        // tangent is roughly vertical: pick world Z as fallback
        TMP_N.set(1, 0, 0);
      } else {
        TMP_N.multiplyScalar(1 / nlen);
      }

      const leftIdx  = (i * 2 + 0) * 3;
      const rightIdx = (i * 2 + 1) * 3;

      arr[leftIdx]     = this.pos[i3]     - TMP_N.x * halfW;
      arr[leftIdx + 1] = this.pos[i3 + 1] - TMP_N.y * halfW;
      arr[leftIdx + 2] = this.pos[i3 + 2] - TMP_N.z * halfW;

      arr[rightIdx]     = this.pos[i3]     + TMP_N.x * halfW;
      arr[rightIdx + 1] = this.pos[i3 + 1] + TMP_N.y * halfW;
      arr[rightIdx + 2] = this.pos[i3 + 2] + TMP_N.z * halfW;
    }

    this.posAttr.needsUpdate = true;
    this.geo.computeVertexNormals();
  }
}

function smoothstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
