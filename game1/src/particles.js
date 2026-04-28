import * as THREE from 'three';

/**
 * Two systems:
 *   - ambientPollen : drifts gently, follows the camera so the world is always alive
 *   - burstMotes    : on-demand emitter for the arrival moment
 */
export class ParticleSystem {
  constructor(scene) {
    this.scene = scene;

    // Ambient pollen / dust motes
    const POLLEN_COUNT = 600;
    const positions = new Float32Array(POLLEN_COUNT * 3);
    const phases = new Float32Array(POLLEN_COUNT);

    for (let i = 0; i < POLLEN_COUNT; i++) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * 60;
      positions[i * 3 + 1] = Math.random() * 12 + 0.5;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 60;
      phases[i] = Math.random() * Math.PI * 2;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('phase', new THREE.BufferAttribute(phases, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0xffe0a0) },
        uSize: { value: 12.0 },
      },
      vertexShader: `
        attribute float phase;
        uniform float uTime;
        uniform float uSize;
        varying float vAlpha;
        void main() {
          vec3 pos = position;
          // Slow drift
          pos.x += sin(uTime * 0.3 + phase) * 1.2;
          pos.y += sin(uTime * 0.5 + phase * 1.3) * 0.6;
          pos.z += cos(uTime * 0.25 + phase * 0.7) * 1.2;
          vec4 mv = modelViewMatrix * vec4(pos, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uSize / -mv.z;
          vAlpha = 0.15 + 0.4 * (0.5 + 0.5 * sin(uTime * 0.6 + phase));
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          if (d > 0.5) discard;
          float falloff = pow(1.0 - d * 2.0, 2.0);
          gl_FragColor = vec4(uColor, vAlpha * falloff);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.pollen = new THREE.Points(geo, mat);
    scene.add(this.pollen);
    this.pollenMat = mat;

    // Burst motes (for arrival)
    const BURST = 220;
    const burstPos = new Float32Array(BURST * 3);
    const burstVel = new Float32Array(BURST * 3);
    const burstLife = new Float32Array(BURST);
    for (let i = 0; i < BURST; i++) burstLife[i] = -1; // dead

    const bgeo = new THREE.BufferGeometry();
    bgeo.setAttribute('position', new THREE.BufferAttribute(burstPos, 3));

    const bmat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(0xffd47a) },
        uSize: { value: 30.0 },
      },
      vertexShader: `
        uniform float uSize;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uSize / -mv.z;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          if (d > 0.5) discard;
          float falloff = pow(1.0 - d * 2.0, 2.0);
          gl_FragColor = vec4(uColor, falloff);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.burst = new THREE.Points(bgeo, bmat);
    scene.add(this.burst);
    this.burstPos = burstPos;
    this.burstVel = burstVel;
    this.burstLife = burstLife;
    this.burstGeo = bgeo;
    this.burstActive = 0;
  }

  burstAt(x, y, z) {
    const N = this.burstLife.length;
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 1.5;
      this.burstPos[i * 3 + 0] = x + Math.cos(a) * r;
      this.burstPos[i * 3 + 1] = y + Math.random() * 1.0;
      this.burstPos[i * 3 + 2] = z + Math.sin(a) * r;

      this.burstVel[i * 3 + 0] = (Math.random() - 0.5) * 0.6;
      this.burstVel[i * 3 + 1] = 0.6 + Math.random() * 1.2;
      this.burstVel[i * 3 + 2] = (Math.random() - 0.5) * 0.6;

      this.burstLife[i] = 4 + Math.random() * 4;
    }
    this.burstGeo.attributes.position.needsUpdate = true;
    this.burstActive = N;
  }

  update(time, dt, cameraPos) {
    this.pollenMat.uniforms.uTime.value = time;

    // Keep pollen field around the camera so it never runs out
    const pos = this.pollen.geometry.attributes.position;
    const RANGE = 30;
    for (let i = 0; i < pos.count; i++) {
      const dx = pos.getX(i) - cameraPos.x;
      const dz = pos.getZ(i) - cameraPos.z;
      if (Math.abs(dx) > RANGE) {
        pos.setX(i, cameraPos.x + (Math.random() - 0.5) * RANGE * 2);
      }
      if (Math.abs(dz) > RANGE) {
        pos.setZ(i, cameraPos.z + (Math.random() - 0.5) * RANGE * 2);
      }
    }
    pos.needsUpdate = true;

    // Update burst particles
    if (this.burstActive > 0) {
      const bpos = this.burstGeo.attributes.position;
      let active = 0;
      for (let i = 0; i < this.burstLife.length; i++) {
        if (this.burstLife[i] <= 0) continue;
        active++;
        this.burstLife[i] -= dt;
        bpos.array[i * 3 + 0] += this.burstVel[i * 3 + 0] * dt;
        bpos.array[i * 3 + 1] += this.burstVel[i * 3 + 1] * dt;
        bpos.array[i * 3 + 2] += this.burstVel[i * 3 + 2] * dt;
        // Slight horizontal drift
        this.burstVel[i * 3 + 0] += Math.sin(time + i) * 0.05 * dt;
        this.burstVel[i * 3 + 2] += Math.cos(time + i) * 0.05 * dt;
        // Decay vertical
        this.burstVel[i * 3 + 1] *= (1 - 0.2 * dt);
      }
      bpos.needsUpdate = true;
      this.burstActive = active;
    }
  }
}
