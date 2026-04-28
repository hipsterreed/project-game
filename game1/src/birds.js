import * as THREE from 'three';

/**
 * A small flock of distant birds — V-shaped silhouettes that drift across the
 * sky on slow gentle paths. Pure visual atmosphere — sound is handled by
 * AdaptiveAudio.
 */
export class BirdFlock {
  constructor(scene) {
    this.scene = scene;
    this.birds = [];

    const birdMat = new THREE.MeshBasicMaterial({
      color: 0x2a1f10,
      transparent: true,
      opacity: 0.85,
      fog: true,
      side: THREE.DoubleSide,
    });

    // Build a simple V (chevron) shape using a triangle strip
    const shape = new THREE.Shape();
    shape.moveTo(-0.6, 0);
    shape.lineTo(0, 0.18);
    shape.lineTo(0.6, 0);
    shape.lineTo(0, 0.06);
    shape.lineTo(-0.6, 0);
    const birdGeo = new THREE.ShapeGeometry(shape);

    // Spawn a flock and a few solo birds
    this._spawnFlock(birdGeo, birdMat, 7, 60, 70, -90);
    this._spawnFlock(birdGeo, birdMat, 5, -40, 50, 80);

    for (let i = 0; i < 4; i++) {
      this._spawnSolo(birdGeo, birdMat);
    }
  }

  _spawnFlock(geo, mat, count, originX, originY, originZ) {
    const baseSpeed = 1.4 + Math.random() * 0.6;
    const dir = new THREE.Vector3(
      -originX,
      0,
      -originZ
    ).normalize().multiplyScalar(baseSpeed);

    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(
        originX + (Math.random() - 0.5) * 6,
        originY + (Math.random() - 0.5) * 4,
        originZ + (Math.random() - 0.5) * 6
      );
      m.scale.setScalar(2 + Math.random() * 1.5);
      m.userData = {
        velocity: dir.clone().multiplyScalar(0.9 + Math.random() * 0.2),
        flapPhase: Math.random() * Math.PI * 2,
        flapSpeed: 6 + Math.random() * 3,
        wander: Math.random(),
      };
      this.scene.add(m);
      this.birds.push(m);
    }
  }

  _spawnSolo(geo, mat) {
    const m = new THREE.Mesh(geo, mat);
    const angle = Math.random() * Math.PI * 2;
    const r = 80 + Math.random() * 40;
    m.position.set(Math.cos(angle) * r, 30 + Math.random() * 20, Math.sin(angle) * r);
    m.scale.setScalar(1.4 + Math.random());
    const vAngle = angle + Math.PI + (Math.random() - 0.5) * 0.6;
    const speed = 1.0 + Math.random() * 0.5;
    m.userData = {
      velocity: new THREE.Vector3(Math.cos(vAngle), 0, Math.sin(vAngle)).multiplyScalar(speed),
      flapPhase: Math.random() * Math.PI * 2,
      flapSpeed: 5 + Math.random() * 2,
      wander: Math.random(),
    };
    this.scene.add(m);
    this.birds.push(m);
  }

  update(time, dt) {
    for (const b of this.birds) {
      const v = b.userData.velocity;
      b.position.x += v.x * dt;
      b.position.z += v.z * dt;

      // Slow drift up/down
      b.position.y += Math.sin(time * 0.3 + b.userData.wander * 5) * 0.05;

      // Wing flap = scale.y oscillation
      const flap = Math.sin(time * b.userData.flapSpeed + b.userData.flapPhase);
      b.rotation.x = flap * 0.4;
      b.rotation.y = Math.atan2(v.x, v.z);

      // Wrap-around: if off the playing field, respawn on the opposite side
      if (Math.abs(b.position.x) > 130 || Math.abs(b.position.z) > 130) {
        const a = Math.random() * Math.PI * 2;
        const r = 110 + Math.random() * 20;
        b.position.x = Math.cos(a) * r;
        b.position.z = Math.sin(a) * r;
        b.position.y = 30 + Math.random() * 30;
        const va = a + Math.PI + (Math.random() - 0.5) * 0.4;
        const speed = 1.0 + Math.random() * 0.6;
        b.userData.velocity.set(Math.cos(va), 0, Math.sin(va)).multiplyScalar(speed);
      }
    }
  }
}
