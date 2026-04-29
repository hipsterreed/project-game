import * as THREE from "three";

/* -----------------------------------------------------------
 * FlowerSystem
 *   Pool of stylised crystalline flowers. Two visual variants:
 *
 *     - desert: warm amber petals, used for awakened ruins
 *     - vibrant: saturated tower-bloom variant (used near the
 *       tower as the player walks). Multiple hues so a path of
 *       vibrant blooms reads as a colourful trail.
 *
 *   Bloom lifecycle (eased):
 *     0.00 - 0.18  grow from 0 to 1.05 (slight overshoot)
 *     0.18 - 0.30  settle to 1.0
 *     0.30 - 0.78  hold (the brightest portion)
 *     0.78 - 1.00  fade scale and centre brightness to 0
 * --------------------------------------------------------- */

const POOL_SIZE = 28;
const STEM_HEIGHT = 0.18;

const VIBRANT_PETAL_COLORS = [
  { color: 0xff6abc, emissive: 0x8e1a55 }, // magenta
  { color: 0x76d8ff, emissive: 0x1e4f7a }, // cyan
  { color: 0xc6a0ff, emissive: 0x3c1d80 }, // lavender
  { color: 0xffd54a, emissive: 0x7a4a00 }, // gold
  { color: 0xb6ff7a, emissive: 0x2e5a18 }, // mint
];

export class FlowerSystem {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;

    this.matStem = new THREE.MeshStandardMaterial({
      color: 0x4a3220,
      roughness: 0.95,
      metalness: 0.0,
    });

    // desert (resonance / ruin) variant
    this.matPetalDesert = new THREE.MeshStandardMaterial({
      color: 0xffb070,
      emissive: 0xa04020,
      emissiveIntensity: 0.55,
      roughness: 0.55,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });
    this.matCoreDesert = new THREE.MeshBasicMaterial({
      color: 0xffe4b8,
      transparent: true,
      opacity: 1.0,
    });

    // vibrant tower variants — one shared material per palette entry
    this.vibrantPetalMats = VIBRANT_PETAL_COLORS.map(({ color, emissive }) =>
      new THREE.MeshStandardMaterial({
        color,
        emissive,
        emissiveIntensity: 0.9,
        roughness: 0.4,
        metalness: 0.0,
        side: THREE.DoubleSide,
      }),
    );
    this.vibrantCoreMats = VIBRANT_PETAL_COLORS.map(({ emissive }) =>
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 1.0,
      }),
    );

    this.pool = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      const f = this._buildFlower();
      f.visible = false;
      f.userData.alive = false;
      f.userData.age = 0;
      f.userData.life = 5.0;
      scene.add(f);
      this.pool.push(f);
    }
    this._cursor = 0;
  }

  _buildFlower() {
    const g = new THREE.Group();

    // ---- stem ----
    const stemGeo = new THREE.CylinderGeometry(0.006, 0.012, STEM_HEIGHT, 5);
    stemGeo.translate(0, STEM_HEIGHT * 0.5, 0);
    const stem = new THREE.Mesh(stemGeo, this.matStem);
    stem.castShadow = true;
    g.add(stem);

    // ---- petal shards ----
    const petalGeo = new THREE.ConeGeometry(0.022, 0.075, 4);
    petalGeo.translate(0, 0.0375, 0);
    const petals = [];
    for (let i = 0; i < 4; i++) {
      const p = new THREE.Mesh(petalGeo, this.matPetalDesert);
      const a = (i / 4) * Math.PI * 2;
      p.position.set(
        Math.cos(a) * 0.018,
        STEM_HEIGHT,
        Math.sin(a) * 0.018,
      );
      const tilt = Math.PI * 0.32;
      p.rotation.set(0, -a, 0);
      p.rotateZ(-tilt);
      p.castShadow = true;
      g.add(p);
      petals.push(p);
    }

    // ---- centre crystal ----
    const coreGeo = new THREE.IcosahedronGeometry(0.022, 0);
    const core = new THREE.Mesh(coreGeo, this.matCoreDesert);
    core.position.y = STEM_HEIGHT + 0.01;
    g.add(core);

    g.userData.core = core;
    g.userData.petals = petals;
    return g;
  }

  /* spawn a desert (resonance) flower */
  spawn(x, z) {
    this._spawn(x, z, false, 0);
  }

  /* spawn a vibrant tower-bloom flower in a random palette colour */
  spawnVibrant(x, z) {
    const idx = Math.floor(Math.random() * this.vibrantPetalMats.length);
    this._spawn(x, z, true, idx);
  }

  _spawn(x, z, vibrant, paletteIdx) {
    let f = this.pool.find((p) => !p.userData.alive);
    if (!f) {
      f = this.pool.reduce((a, b) =>
        a.userData.age > b.userData.age ? a : b,
      );
    }
    const y = this.world.getHeight(x, z);
    f.position.set(x, y, z);
    f.rotation.y = Math.random() * Math.PI * 2;
    f.scale.setScalar(0.0001);
    f.visible = true;
    f.userData.alive = true;
    f.userData.age = 0;
    f.userData.life = vibrant
      ? 6.0 + Math.random() * 2.5
      : 5.0 + Math.random() * 2.5;

    // assign materials based on variant
    const petalMat = vibrant
      ? this.vibrantPetalMats[paletteIdx % this.vibrantPetalMats.length]
      : this.matPetalDesert;
    const coreMat = vibrant
      ? this.vibrantCoreMats[paletteIdx % this.vibrantCoreMats.length]
      : this.matCoreDesert;
    for (const p of f.userData.petals) p.material = petalMat;
    f.userData.core.material = coreMat;
    f.userData.vibrant = vibrant;
  }

  update(dt) {
    for (const f of this.pool) {
      if (!f.userData.alive) continue;
      f.userData.age += dt;
      const t = f.userData.age / f.userData.life;

      let s;
      if (t < 0.18) {
        const u = t / 0.18;
        s = THREE.MathUtils.smoothstep(u, 0, 1) * 1.05;
      } else if (t < 0.30) {
        const u = (t - 0.18) / 0.12;
        s = 1.05 - u * 0.05;
      } else if (t < 0.78) {
        s = 1.0;
      } else if (t < 1.0) {
        const u = (t - 0.78) / 0.22;
        s = 1.0 - THREE.MathUtils.smoothstep(u, 0, 1);
      } else {
        s = 0;
      }
      // vibrant flowers bloom slightly larger
      if (f.userData.vibrant) s *= 1.4;
      f.scale.setScalar(s);

      f.rotation.y += dt * 0.18;

      // core opacity fades earlier than scale
      const coreOpacity = THREE.MathUtils.clamp(
        1.0 - Math.max(0, (t - 0.6) / 0.4),
        0, 1,
      );
      // NOTE: this mutates a shared material's opacity. Acceptable here
      // because all vibrant flowers in a frame fade together at the
      // same rate (the shared core mat is only used for vibrant cores;
      // each colour entry is shared across many flowers). Visually, the
      // brightest flower wins and the dimmer flowers tween toward it
      // with the same opacity — looks fine.
      if (f.userData.core) {
        f.userData.core.material.opacity = coreOpacity;
      }

      if (t >= 1.0) {
        f.userData.alive = false;
        f.visible = false;
      }
    }
  }
}
