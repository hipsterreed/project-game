import * as THREE from "three";
import { CloakShader } from "./shaders.js";

/* -----------------------------------------------------------
 * Verlet-cloth cloak.
 *   A grid of points pinned along the top row to shoulder
 *   anchors that follow the character. Constraints between
 *   neighbours hold the cloth together; gravity, wind and a
 *   damping term shape the motion. Each frame we update vertex
 *   positions on a PlaneGeometry to render the cloth.
 *
 *   Pinning detail: the top row is anchored to a horizontal arc
 *   centred on `anchor` (the shoulder anchor on the body), with
 *   the arc curving slightly forward on the sides so the cloth
 *   wraps around the player rather than hanging behind in a flat
 *   sheet.
 *
 *   The forward direction of the anchor (where the back of the
 *   cloak lives) is anchor.matrixWorld -Z basis.
 * --------------------------------------------------------- */

const TMP_V = new THREE.Vector3();
const TMP_V2 = new THREE.Vector3();
const ANCHOR_FWD = new THREE.Vector3();
const ANCHOR_RIGHT = new THREE.Vector3();
const ANCHOR_UP = new THREE.Vector3();
const ANCHOR_POS = new THREE.Vector3();

export class Cloak {
  constructor({
    width = 1.4,
    height = 1.55,
    cols = 9,
    rows = 11,
    anchor,
    // pin profile — controls how relaxed/draped the top edge looks. Default
    // pins the entire top row in a flat line (rigid rectangle). Reduce
    // `pinCols` to leave outer columns dangling, and `pinScale` < 1 to
    // pinch the pinned region toward the centre.
    pinCols = cols,
    pinScale = 1.0,
  }) {
    this.width = width;
    this.height = height;
    this.cols = cols;
    this.rows = rows;
    this.anchor = anchor;
    this.pinCols = Math.min(pinCols, cols);
    this.pinScale = pinScale;

    this.spacingX = width / (cols - 1);
    this.spacingY = height / (rows - 1);

    // ---- particles ----
    // arrays of length cols*rows
    const N = cols * rows;
    this.pos = new Float32Array(N * 3);
    this.prev = new Float32Array(N * 3);
    this.pinned = new Uint8Array(N);

    // ---- constraints (structural) ----
    // each entry: [aIdx, bIdx, restLen]
    this.constraints = [];
    const idx = (c, r) => r * cols + c;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (c < cols - 1) this.constraints.push([idx(c, r), idx(c + 1, r), this.spacingX]);
        if (r < rows - 1) this.constraints.push([idx(c, r), idx(c, r + 1), this.spacingY]);
        // cheap shear (diag) for shape stability
        if (c < cols - 1 && r < rows - 1) {
          const d = Math.hypot(this.spacingX, this.spacingY);
          this.constraints.push([idx(c, r), idx(c + 1, r + 1), d]);
          this.constraints.push([idx(c + 1, r), idx(c, r + 1), d]);
        }
        // sparse bend constraints (every 2 cells)
        if (c < cols - 2) this.constraints.push([idx(c, r), idx(c + 2, r), this.spacingX * 2]);
        if (r < rows - 2) this.constraints.push([idx(c, r), idx(c, r + 2), this.spacingY * 2]);
      }
    }

    // pin only the central top-row columns. Outer columns hang from their
    // pinned neighbours via constraints, which lets gravity drape the
    // shoulders naturally instead of forcing a flat rigid top edge.
    const pinStart = Math.floor((cols - this.pinCols) / 2);
    const pinEnd = pinStart + this.pinCols;
    for (let c = pinStart; c < pinEnd; c++) this.pinned[idx(c, 0)] = 1;

    // ---- mesh ----
    // PlaneGeometry positioned in cloak-local space; we update
    // its position attribute to the simulated points each frame.
    this.geo = new THREE.PlaneGeometry(width, height, cols - 1, rows - 1);
    // PlaneGeometry centres at origin; we want top row at y=0 and
    // hangs down to y=-height. Translate.
    this.geo.translate(0, -height * 0.5, 0);

    // initialise positions to the rest layout (in world space).
    this._initRestPositions();

    // material
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(CloakShader.uniforms),
      vertexShader: CloakShader.vertexShader,
      fragmentShader: CloakShader.fragmentShader,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;

    // a normal attribute we update each frame
    this.normalAttr = this.geo.attributes.normal;
    this.posAttr = this.geo.attributes.position;
  }

  _initRestPositions() {
    // place all points at anchor's world position pointing back/down
    // (we'll re-pin top row immediately on first update anyway)
    if (this.anchor) this.anchor.getWorldPosition(ANCHOR_POS);
    else ANCHOR_POS.set(0, 1.3, 0);
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const i = (r * this.cols + c) * 3;
        const x = (c - (this.cols - 1) * 0.5) * this.spacingX;
        const y = -r * this.spacingY;
        const z = 0.05;
        this.pos[i + 0] = ANCHOR_POS.x + x;
        this.pos[i + 1] = ANCHOR_POS.y + y;
        this.pos[i + 2] = ANCHOR_POS.z + z;
        this.prev[i + 0] = this.pos[i + 0];
        this.prev[i + 1] = this.pos[i + 1];
        this.prev[i + 2] = this.pos[i + 2];
      }
    }
  }

  reset(anchor) {
    this.anchor = anchor || this.anchor;
    this._initRestPositions();
  }

  /* -----------------------------------------------------------
   * Compute the current pin positions for the top row given the
   * anchor's world transform. The pins curve slightly forward at
   * the edges to wrap around shoulders.
   * --------------------------------------------------------- */
  _writePinPositions(out) {
    // anchor world basis
    this.anchor.updateWorldMatrix(true, false);
    const m = this.anchor.matrixWorld.elements;
    ANCHOR_RIGHT.set(m[0], m[1], m[2]).normalize();
    ANCHOR_UP.set(m[4], m[5], m[6]).normalize();
    ANCHOR_FWD.set(m[8], m[9], m[10]).normalize(); // local +Z
    this.anchor.getWorldPosition(ANCHOR_POS);

    // The cloak hangs behind the body, so its "back surface" faces
    // forward (camera-on-back view). We want the top row arranged
    // along the right axis, slightly behind the body, curving
    // forward at the sides like a real cape.
    const back = TMP_V.copy(ANCHOR_FWD).multiplyScalar(0.18); // back offset
    const halfW = this.width * 0.5;

    // pinScale pinches the pin row toward the centre so the top of the
    // cape reads as a draped shoulder line, not a rigid horizontal beam.
    const pinScale = this.pinScale ?? 1.0;
    for (let c = 0; c < this.cols; c++) {
      const t = c / (this.cols - 1) - 0.5; // -0.5..0.5
      const sideOffset = t * this.width * pinScale;
      // wrap: edges curve forward (toward -anchor.fwd)
      const wrap = (1 - Math.abs(t) * 2) * 0.0; // 0 = no wrap; positive = pulls back
      const forwardCurl = Math.pow(Math.abs(t) * 2, 2) * 0.18 * pinScale;

      const px =
        ANCHOR_POS.x +
        ANCHOR_RIGHT.x * sideOffset +
        ANCHOR_FWD.x * (back.length() + forwardCurl);
      const py =
        ANCHOR_POS.y +
        ANCHOR_RIGHT.y * sideOffset +
        ANCHOR_FWD.y * (back.length() + forwardCurl);
      const pz =
        ANCHOR_POS.z +
        ANCHOR_RIGHT.z * sideOffset +
        ANCHOR_FWD.z * (back.length() + forwardCurl);

      out[c * 3 + 0] = px;
      out[c * 3 + 1] = py;
      out[c * 3 + 2] = pz;
      // suppress unused
      if (false) wrap;
    }
  }

  /* -----------------------------------------------------------
   * One simulation step.
   * --------------------------------------------------------- */
  update(dt, anchor, velocity, wind, world) {
    if (anchor) this.anchor = anchor;

    // Use a fixed sub-step for stability if dt is large.
    const subSteps = dt > 1 / 50 ? 2 : 1;
    const sdt = dt / subSteps;
    for (let s = 0; s < subSteps; s++) {
      this._step(sdt, velocity, wind, world);
    }

    this._writeMesh();
  }

  _step(dt, velocity, wind, world) {
    const N = this.cols * this.rows;
    const pos = this.pos;
    const prev = this.prev;

    // -------- 1. compute pin positions for top row --------
    const pins = this._tmpPins || (this._tmpPins = new Float32Array(this.cols * 3));
    this._writePinPositions(pins);

    // -------- 2. integrate (Verlet) for unpinned points --------
    const gravity = -9.0;
    // damping pulls velocity toward 0, simulating air drag
    const damping = 0.985;

    for (let i = 0; i < N; i++) {
      if (this.pinned[i]) {
        const c = i % this.cols;
        pos[i * 3 + 0] = pins[c * 3 + 0];
        pos[i * 3 + 1] = pins[c * 3 + 1];
        pos[i * 3 + 2] = pins[c * 3 + 2];
        prev[i * 3 + 0] = pos[i * 3 + 0];
        prev[i * 3 + 1] = pos[i * 3 + 1];
        prev[i * 3 + 2] = pos[i * 3 + 2];
        continue;
      }

      const ix = i * 3;
      const px = pos[ix], py = pos[ix + 1], pz = pos[ix + 2];
      const vx = (px - prev[ix]) * damping;
      const vy = (py - prev[ix + 1]) * damping;
      const vz = (pz - prev[ix + 2]) * damping;

      // forces -> acceleration
      // wind acts on cloth; multiply by per-vertex factor that
      // grows toward bottom rows (more billow lower)
      const r = Math.floor(i / this.cols) / (this.rows - 1);
      const windScale = 0.35 + r * 1.2;

      const ax = wind.x * windScale * dt;
      const ay = (wind.y * windScale + gravity) * dt;
      const az = wind.z * windScale * dt;

      // turbulence: small per-particle noise oscillation
      const t = performance.now() * 0.001;
      const tx = Math.sin(t * 2.1 + i * 0.7) * 0.06 * r;
      const tz = Math.cos(t * 1.7 + i * 1.3) * 0.06 * r;

      prev[ix] = px;
      prev[ix + 1] = py;
      prev[ix + 2] = pz;

      pos[ix] = px + vx + ax * dt + tx * dt;
      pos[ix + 1] = py + vy + ay * dt;
      pos[ix + 2] = pz + vz + az * dt + tz * dt;
    }

    // -------- 3. constraint solve --------
    const iters = 4;
    for (let it = 0; it < iters; it++) {
      for (let k = 0; k < this.constraints.length; k++) {
        const con = this.constraints[k];
        const a = con[0], b = con[1], rest = con[2];
        const ax3 = a * 3, bx3 = b * 3;
        const dx = pos[bx3] - pos[ax3];
        const dy = pos[bx3 + 1] - pos[ax3 + 1];
        const dz = pos[bx3 + 2] - pos[ax3 + 2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 === 0) continue;
        const d = Math.sqrt(d2);
        const diff = (d - rest) / d;
        const halfDx = dx * 0.5 * diff;
        const halfDy = dy * 0.5 * diff;
        const halfDz = dz * 0.5 * diff;
        const aPinned = this.pinned[a];
        const bPinned = this.pinned[b];
        if (!aPinned && !bPinned) {
          pos[ax3]     += halfDx;
          pos[ax3 + 1] += halfDy;
          pos[ax3 + 2] += halfDz;
          pos[bx3]     -= halfDx;
          pos[bx3 + 1] -= halfDy;
          pos[bx3 + 2] -= halfDz;
        } else if (!aPinned && bPinned) {
          pos[ax3]     += halfDx * 2;
          pos[ax3 + 1] += halfDy * 2;
          pos[ax3 + 2] += halfDz * 2;
        } else if (aPinned && !bPinned) {
          pos[bx3]     -= halfDx * 2;
          pos[bx3 + 1] -= halfDy * 2;
          pos[bx3 + 2] -= halfDz * 2;
        }
      }
    }

    // -------- 4. world collision: keep cloth above terrain --------
    if (world && world.getHeight) {
      for (let i = 0; i < N; i++) {
        if (this.pinned[i]) continue;
        const ix = i * 3;
        const ground = world.getHeight(pos[ix], pos[ix + 2]) + 0.02;
        if (pos[ix + 1] < ground) {
          pos[ix + 1] = ground;
          // friction: pull prev toward pos so velocity damps tangentially
          prev[ix] = pos[ix] + (pos[ix] - prev[ix]) * 0.25;
          prev[ix + 2] = pos[ix + 2] + (pos[ix + 2] - prev[ix + 2]) * 0.25;
        }
      }
    }
  }

  _writeMesh() {
    const N = this.cols * this.rows;
    const arr = this.posAttr.array;

    // PlaneGeometry vertex order: row-major, top row first.
    // Our (c, r=0) is the top row already. Match.
    for (let i = 0; i < N; i++) {
      arr[i * 3 + 0] = this.pos[i * 3 + 0];
      arr[i * 3 + 1] = this.pos[i * 3 + 1];
      arr[i * 3 + 2] = this.pos[i * 3 + 2];
    }
    this.posAttr.needsUpdate = true;
    this.geo.computeVertexNormals();
  }
}
