import * as THREE from "three";

export function buildFireflies(scene) {
  const COUNT = 140;
  const positions = new Float32Array(COUNT * 3);
  const seeds = new Float32Array(COUNT);
  const phases = new Float32Array(COUNT);

  for (let i = 0; i < COUNT; i++) {
    const r = 4 + Math.random() * 30;
    const a = Math.random() * Math.PI * 2;
    positions[i * 3] = Math.cos(a) * r;
    positions[i * 3 + 1] = 0.4 + Math.random() * 2.6;
    positions[i * 3 + 2] = Math.sin(a) * r - 6;
    seeds[i] = Math.random();
    phases[i] = Math.random() * Math.PI * 2;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("seed", new THREE.BufferAttribute(seeds, 1));
  geo.setAttribute("phase", new THREE.BufferAttribute(phases, 1));

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color("#ffd28a") },
      uSize: { value: 22 * window.devicePixelRatio },
      uPixelRatio: { value: window.devicePixelRatio },
    },
    vertexShader: `
      attribute float seed;
      attribute float phase;
      uniform float uTime;
      uniform float uSize;
      varying float vGlow;
      void main(){
        vec3 p = position;
        float t = uTime + phase;
        p.x += sin(t * 0.6 + seed * 6.28) * 0.6;
        p.y += sin(t * 0.9 + seed * 3.14) * 0.5 + sin(t * 0.21) * 0.3;
        p.z += cos(t * 0.5 + seed * 2.0) * 0.6;

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float pulse = 0.5 + 0.5 * sin(t * 2.4 + seed * 9.0);
        vGlow = pulse;
        gl_PointSize = uSize * (0.4 + pulse * 0.8) / max(-mv.z, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      varying float vGlow;
      void main(){
        vec2 q = gl_PointCoord - 0.5;
        float d = length(q);
        if (d > 0.5) discard;
        float a = smoothstep(0.5, 0.0, d);
        a *= 0.4 + vGlow * 0.8;
        gl_FragColor = vec4(uColor * (1.2 + vGlow), a * 0.9);
      }
    `,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);

  return {
    points,
    update: (dt, t) => {
      mat.uniforms.uTime.value = t;
    },
  };
}

export function buildDust(scene, sunDir) {
  const COUNT = 280;
  const positions = new Float32Array(COUNT * 3);
  const seeds = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 30;
    positions[i * 3 + 1] = Math.random() * 6 + 0.4;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 30 - 5;
    seeds[i] = Math.random();
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("seed", new THREE.BufferAttribute(seeds, 1));

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color("#ffe9c2") },
      uSunDir: { value: sunDir },
      uCamPos: { value: new THREE.Vector3() },
    },
    vertexShader: `
      attribute float seed;
      uniform float uTime;
      uniform vec3 uCamPos;
      varying float vBright;
      varying float vDist;
      void main(){
        vec3 p = position;
        float t = uTime * 0.07;
        p.x += sin(t + seed * 6.28) * 0.7;
        p.y += sin(t * 1.5 + seed * 3.14) * 0.3;
        p.z += cos(t + seed * 2.0) * 0.7;

        // wrap around the camera
        vec3 toCam = p - uCamPos;
        if (length(toCam.xz) > 18.0) {
          vec2 dir = normalize(toCam.xz);
          p.xz -= dir * 36.0;
        }
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;

        vDist = -mv.z;
        vBright = 0.6 + 0.4 * sin(uTime * 0.4 + seed * 12.0);
        gl_PointSize = (1.4 + seed * 1.4) * (12.0 / max(-mv.z, 1.0));
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      varying float vBright;
      varying float vDist;
      void main(){
        vec2 q = gl_PointCoord - 0.5;
        float d = length(q);
        if (d > 0.5) discard;
        float a = smoothstep(0.5, 0.0, d);
        // fade with distance
        float fade = smoothstep(0.0, 14.0, vDist) * (1.0 - smoothstep(14.0, 28.0, vDist));
        gl_FragColor = vec4(uColor * vBright, a * 0.18 * fade);
      }
    `,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);

  return {
    points,
    update: (dt, t, camPos) => {
      mat.uniforms.uTime.value = t;
      mat.uniforms.uCamPos.value.copy(camPos);
    },
  };
}
