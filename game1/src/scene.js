import * as THREE from 'three';

export function createScene() {
  const scene = new THREE.Scene();

  // Sun direction (low golden-hour angle, slightly forward and to the left of camera).
  // Camera looks toward -Z, so a sun in the -Z hemisphere is ahead of the player.
  const sunDir = new THREE.Vector3(-0.3, 0.2, -0.92).normalize();

  // -------- Custom gradient sky (full art control, warm golden-hour palette) --------
  const skyGeo = new THREE.SphereGeometry(800, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      uTopColor:    { value: new THREE.Color(0x6892b8) },   // soft blue zenith
      uMidColor:    { value: new THREE.Color(0xe6b97a) },   // warm peach
      uHorizon:     { value: new THREE.Color(0xffd49a) },   // bright warm horizon
      uGroundColor: { value: new THREE.Color(0x5a3a28) },   // warm earthy below
      uSunDir:      { value: sunDir.clone() },
      uSunColor:    { value: new THREE.Color(0xfff1c8) },
    },
    vertexShader: `
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      varying vec3 vWorldPos;
      uniform vec3 uTopColor;
      uniform vec3 uMidColor;
      uniform vec3 uHorizon;
      uniform vec3 uGroundColor;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      void main() {
        vec3 dir = normalize(vWorldPos);
        float h = dir.y;

        // Three-stop vertical gradient: ground -> horizon -> mid -> top
        vec3 col;
        if (h < 0.0) {
          col = mix(uHorizon, uGroundColor, smoothstep(0.0, -0.18, h));
        } else if (h < 0.18) {
          col = mix(uHorizon, uMidColor, smoothstep(0.0, 0.18, h));
        } else {
          col = mix(uMidColor, uTopColor, smoothstep(0.18, 0.9, h));
        }

        // Sun glow added near sun direction (toned down — bloom amplifies this)
        float sunDot = max(0.0, dot(dir, normalize(uSunDir)));
        float sunGlow = pow(sunDot, 8.0) * 0.25 + pow(sunDot, 200.0) * 0.4;
        col += uSunColor * sunGlow;

        // Slight horizon haze around sun (azimuthal warmth)
        float horizonHaze = (1.0 - abs(h)) * pow(sunDot, 2.0) * 0.3;
        col += uHorizon * horizonHaze * 0.4;

        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.renderOrder = -1;
  scene.add(sky);

  // Background fallback color (matches horizon)
  scene.background = new THREE.Color(0xffd49a);

  // -------- Fog (warm haze for depth) --------
  scene.fog = new THREE.FogExp2(0xf2c79a, 0.013);

  // -------- Lighting --------
  // Sunlight (key) - warm and strong
  const sun = new THREE.DirectionalLight(0xfff0d4, 3.4);
  sun.position.copy(sunDir).multiplyScalar(120);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 240;
  sun.shadow.camera.left = -100;
  sun.shadow.camera.right = 100;
  sun.shadow.camera.top = 100;
  sun.shadow.camera.bottom = -100;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  sun.shadow.radius = 6;
  scene.add(sun);
  scene.add(sun.target);

  // Hemisphere fill - warm sky / cool earth bounce, lifts shadow detail
  const hemi = new THREE.HemisphereLight(0xffd9a8, 0x4a3520, 1.4);
  scene.add(hemi);

  // Ambient floor for absolute darkest pixels
  const ambient = new THREE.AmbientLight(0xfff0e0, 0.35);
  scene.add(ambient);

  // -------- Sun disc & halo (additive sprites for sun visual) --------
  const sunGeo = new THREE.SphereGeometry(7, 32, 32);
  const sunDiscMat = new THREE.MeshBasicMaterial({
    color: 0xffd6a0,
    transparent: true,
    opacity: 0.55,
    fog: false,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const sunMesh = new THREE.Mesh(sunGeo, sunDiscMat);
  sunMesh.position.copy(sunDir).multiplyScalar(700);
  scene.add(sunMesh);

  const haloGeo = new THREE.SphereGeometry(40, 32, 32);
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0xff9050,
    transparent: true,
    opacity: 0.08,
    fog: false,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.BackSide,
  });
  const halo = new THREE.Mesh(haloGeo, haloMat);
  halo.position.copy(sunMesh.position);
  scene.add(halo);

  return { scene, sun, sunMesh, sunDir };
}
