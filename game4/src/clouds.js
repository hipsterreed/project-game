import * as THREE from "three";

/* -----------------------------------------------------------
 * Cloud sea — the world below The Quiet Cliffs.
 *
 *   Built from two parts:
 *     (a) one large flat plane far below the island, with a
 *         procedural FBM cloud shader. Slowly drifts; sunrise-
 *         tinted on top. This is the carpet beneath the world.
 *     (b) ~14 soft cloud-puff billboards drifting nearer to the
 *         cliff edge, providing parallax & a sense of altitude.
 *
 *   Returns: { group, plane, planeMat, puffs, partFactor (0..1) }
 *
 *   `partFactor` is the "clouds parting" value driven during
 *   the finale shot — when it rises toward 1, the cloud plane
 *   sinks and puffs fade away so The Last Light reads clean.
 * --------------------------------------------------------- */

export function buildClouds() {
  const group = new THREE.Group();
  const partFactor = { value: 0.0 };  // 0 = sealed / 1 = fully parted

  // ------------------------------------------------------------
  // (a) Cloud sea plane
  // ------------------------------------------------------------
  // Big enough that the player never sees its edge; soft sunrise tint.
  const planeGeo = new THREE.PlaneGeometry(2400, 2400, 1, 1);
  planeGeo.rotateX(-Math.PI / 2);

  const planeMat = new THREE.ShaderMaterial({
    transparent: false,
    fog: false,
    side: THREE.DoubleSide,
    uniforms: {
      uTime:    { value: 0.0 },
      uPart:    partFactor,                                  // shared ref
      uSunDir:  { value: new THREE.Vector3(0.18, 0.12, -0.96).normalize() },
      uSunCol:  { value: new THREE.Color("#ffd9a0") },
      uTopCol:  { value: new THREE.Color("#ffc69a") },        // sunlit upper crests
      uMidCol:  { value: new THREE.Color("#d6a89c") },        // pink-warm body
      uLowCol:  { value: new THREE.Color("#5a4a5e") },        // cool shadow undersides
    },
    vertexShader: /* glsl */`
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform float uPart;
      uniform vec3 uSunDir;
      uniform vec3 uSunCol;
      uniform vec3 uTopCol;
      uniform vec3 uMidCol;
      uniform vec3 uLowCol;
      varying vec3 vWorldPos;

      float h11(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vn(vec2 p){
        vec2 i = floor(p); vec2 f = fract(p);
        vec2 u = f*f*(3.0-2.0*f);
        return mix(mix(h11(i), h11(i+vec2(1,0)), u.x),
                   mix(h11(i+vec2(0,1)), h11(i+vec2(1,1)), u.x), u.y);
      }
      float fbm(vec2 p){
        float v = 0.0; float a = 0.5;
        for (int i = 0; i < 6; i++) {
          v += a * vn(p);
          p = p * 2.07 + 1.3;
          a *= 0.5;
        }
        return v;
      }

      void main() {
        // drift the cloud field slowly along +x, with a slow vertical
        // shimmer so it doesn't read as a tiled plane
        vec2 p = vWorldPos.xz * 0.0030 + vec2(uTime * 0.012, uTime * -0.005);
        float cloud = fbm(p);
        // crank up the contrast a bit so we get distinct cloud shapes
        cloud = smoothstep(0.42, 0.85, cloud);

        // a second high-frequency layer for crests / detail
        float crest = fbm(p * 4.5 + vec2(uTime * 0.04, 0.0));
        crest = smoothstep(0.55, 0.85, crest) * cloud;

        // distance fade: as we look out, blend toward warm horizon haze
        float dist = length(cameraPosition - vWorldPos);
        float fade = clamp(1.0 - (dist - 200.0) / 1200.0, 0.0, 1.0);

        // base body color from cloud density
        vec3 col = mix(uLowCol, uMidCol, cloud);
        // sunlit crests pick up the sun direction
        col = mix(col, uTopCol, crest * 0.85);
        // sunrise glaze: warm bias toward the sun azimuth
        vec2 sunHoriz = normalize(uSunDir.xz);
        vec2 worldHoriz = normalize(vWorldPos.xz - cameraPosition.xz);
        float sunBias = clamp(dot(sunHoriz, worldHoriz), 0.0, 1.0);
        col += uSunCol * sunBias * 0.10 * cloud;

        // distance to horizon: melt cloud-sea into the sky haze
        col = mix(vec3(0.96, 0.78, 0.66), col, fade);

        // finale "parting" — sink visibility of the cloud field as uPart -> 1
        float aliveFactor = 1.0 - smoothstep(0.0, 1.0, uPart);
        col = mix(vec3(0.96, 0.82, 0.70), col, aliveFactor);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  const plane = new THREE.Mesh(planeGeo, planeMat);
  plane.position.y = -42;        // far below the cliff edge
  plane.renderOrder = -1.5;       // before terrain, after sky
  plane.frustumCulled = false;
  group.add(plane);

  // ------------------------------------------------------------
  // (b) Soft cloud puffs (billboards) for parallax
  // ------------------------------------------------------------
  // Build a soft radial-gradient texture once and reuse it.
  const puffTex = makeSoftCloudTexture();
  const puffMat = new THREE.SpriteMaterial({
    map: puffTex,
    color: 0xffe2c0,
    transparent: true,
    opacity: 0.85,
    fog: false,
    depthWrite: false,
  });

  const puffs = [];
  const PUFF_COUNT = 14;
  for (let i = 0; i < PUFF_COUNT; i++) {
    const ang = (i / PUFF_COUNT) * Math.PI * 2 + Math.random() * 0.4;
    const r = 220 + Math.random() * 320;
    const x = Math.cos(ang) * r;
    const z = Math.sin(ang) * r;
    const y = -22 + Math.random() * 14;
    const sprite = new THREE.Sprite(puffMat.clone());
    const s = 80 + Math.random() * 90;
    sprite.scale.set(s * 1.4, s, 1);
    sprite.position.set(x, y, z);
    sprite.material.opacity = 0.55 + Math.random() * 0.35;
    sprite.userData = {
      driftAng: Math.random() * Math.PI * 2,
      driftSpeed: 1.2 + Math.random() * 1.5,
      bobPhase: Math.random() * Math.PI * 2,
      baseY: y,
    };
    group.add(sprite);
    puffs.push(sprite);
  }

  return { group, plane, planeMat, puffs, partFactor };
}

export function updateClouds(clouds, dt, t) {
  // animate cloud-sea shader time
  clouds.planeMat.uniforms.uTime.value = t;

  // drift cloud puffs slowly tangentially, with subtle bob
  for (const p of clouds.puffs) {
    p.userData.driftAng += dt * 0.005;
    const speed = p.userData.driftSpeed;
    p.position.x += Math.cos(p.userData.driftAng) * speed * dt;
    p.position.z += Math.sin(p.userData.driftAng) * speed * dt;
    p.position.y = p.userData.baseY + Math.sin(t * 0.18 + p.userData.bobPhase) * 1.4;
    // wrap so puffs don't wander off forever
    const r = Math.hypot(p.position.x, p.position.z);
    if (r > 700) {
      const a = Math.atan2(p.position.z, p.position.x);
      p.position.x = Math.cos(a) * 200;
      p.position.z = Math.sin(a) * 200;
    }
    // fade out as the clouds part during the finale
    const part = clouds.partFactor.value;
    const baseOp = 0.55 + Math.sin(t * 0.2 + p.userData.bobPhase) * 0.05;
    p.material.opacity = baseOp * (1.0 - part * 0.85);
  }
}

/* helper — paint a soft round cloud into a small canvas, reuse as texture */
function makeSoftCloudTexture() {
  const SIZE = 256;
  const cvs = document.createElement("canvas");
  cvs.width = cvs.height = SIZE;
  const ctx = cvs.getContext("2d");
  // soft radial gradient
  const grd = ctx.createRadialGradient(SIZE / 2, SIZE / 2, 8, SIZE / 2, SIZE / 2, SIZE * 0.48);
  grd.addColorStop(0.00, "rgba(255, 240, 220, 0.95)");
  grd.addColorStop(0.40, "rgba(255, 220, 190, 0.55)");
  grd.addColorStop(0.85, "rgba(220, 180, 170, 0.10)");
  grd.addColorStop(1.00, "rgba(220, 180, 170, 0.0)");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, SIZE, SIZE);
  // a few darker undersides scribbled in for texture
  ctx.globalCompositeOperation = "multiply";
  for (let i = 0; i < 24; i++) {
    const cx = SIZE * 0.5 + (Math.random() - 0.5) * SIZE * 0.6;
    const cy = SIZE * 0.5 + (Math.random() - 0.3) * SIZE * 0.55;
    const rr = SIZE * 0.04 + Math.random() * SIZE * 0.10;
    const blob = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
    blob.addColorStop(0, "rgba(180, 150, 160, 0.85)");
    blob.addColorStop(1, "rgba(180, 150, 160, 0.0)");
    ctx.fillStyle = blob;
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
