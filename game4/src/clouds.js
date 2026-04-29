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
  // 1400m × 1400m — still well past the cliff edge & fog far-plane,
  // but a third the fill-rate of the previous 2400² plane.
  const planeGeo = new THREE.PlaneGeometry(1400, 1400, 1, 1);
  planeGeo.rotateX(-Math.PI / 2);

  const planeMat = new THREE.ShaderMaterial({
    transparent: false,
    fog: false,
    side: THREE.DoubleSide,
    uniforms: {
      uTime:    { value: 0.0 },
      uPart:    partFactor,                                  // shared ref
      uSunDir:  { value: new THREE.Vector3(0.18, 0.12, -0.96).normalize() },
      // muted sunrise hint — used very sparingly so the abyss stays dim
      uSunCol:  { value: new THREE.Color("#7a5a48") },
      // mysterious deep fog palette: cool indigo body, near-black undersides,
      // a faint dusky bluish top so the cloud-sea reads as atmospheric haze
      // rather than lit cotton.
      uTopCol:  { value: new THREE.Color("#3e3a52") },        // dim bluish crests
      uMidCol:  { value: new THREE.Color("#1c1a2c") },        // shadow body
      uLowCol:  { value: new THREE.Color("#08070f") },        // near-black undersides
      // cool deep fog colour blended in close to the camera so the cliff
      // bottom melts into mystery instead of showing surfaces clearly
      uFogCol:  { value: new THREE.Color("#0c0c18") },
      // far horizon haze — kept warm but heavily desaturated/darkened so
      // the sunrise still tints the distance without lighting the abyss
      uHazeCol: { value: new THREE.Color("#3a2c30") },
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
      uniform vec3 uFogCol;
      uniform vec3 uHazeCol;
      varying vec3 vWorldPos;

      float h11(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vn(vec2 p){
        vec2 i = floor(p); vec2 f = fract(p);
        vec2 u = f*f*(3.0-2.0*f);
        return mix(mix(h11(i), h11(i+vec2(1,0)), u.x),
                   mix(h11(i+vec2(0,1)), h11(i+vec2(1,1)), u.x), u.y);
      }
      // 3-octave FBM is plenty for the cloud sea — most pixels are far
      // and the per-pixel cost adds up across a 2400m plane.
      float fbm(vec2 p){
        float v = 0.0; float a = 0.5;
        for (int i = 0; i < 3; i++) {
          v += a * vn(p);
          p = p * 2.07 + 1.3;
          a *= 0.5;
        }
        return v;
      }

      void main() {
        // drift the cloud field slowly along +x
        vec2 p = vWorldPos.xz * 0.0030 + vec2(uTime * 0.012, uTime * -0.005);
        float cloud = fbm(p);
        // wide coverage range — most of the surface should read as dense
        // mist, not discrete puffs. Pulls the field toward "almost solid".
        cloud = smoothstep(0.18, 0.95, cloud);
        // wispy second layer drifting at a different rate for slow churn
        float wisp = vn(p * 1.7 + vec2(uTime * 0.022, uTime * 0.014));
        cloud = max(cloud, wisp * 0.82);
        // single-octave crest detail (was a second 6-octave fbm — way too costly)
        float crest = vn(p * 4.5 + vec2(uTime * 0.04, 0.0));
        crest = smoothstep(0.66, 0.94, crest) * cloud;

        // distance from camera to this cloud-sea pixel
        float dist = length(cameraPosition - vWorldPos);

        // base body color from cloud density — already dim by palette
        vec3 col = mix(uLowCol, uMidCol, cloud);
        // crests catch only a whisper of the dusky top tone (was 0.85,
        // which made foam read like sunlit cotton). Keep this low so the
        // surface stays moody.
        col = mix(col, uTopCol, crest * 0.22);
        // sunrise glaze toward the sun azimuth — heavily reduced so the
        // abyss never reads as warm/bright. Falls off with depth too:
        // pixels far below camera receive almost none of the glaze.
        vec2 sunHoriz = normalize(uSunDir.xz);
        vec2 worldHoriz = normalize(vWorldPos.xz - cameraPosition.xz);
        float sunBias = clamp(dot(sunHoriz, worldHoriz), 0.0, 1.0);
        float depth   = clamp((cameraPosition.y - vWorldPos.y) * 0.025, 0.0, 1.0);
        col += uSunCol * sunBias * 0.025 * cloud * (1.0 - depth);

        // ---- thick volumetric mist over the cloud sea ----
        // The cliff bottom should look like dense fog you could lose
        // yourself in. Three contributing factors:
        //   nearFog  — pixels close to the camera (i.e. just below the
        //              cliff edge) blend almost entirely into deep mist
        //   downFog  — looking down increases fog density (atmospheric
        //              build-up over the abyss)
        //   bodyFog  — denser cloud regions are fog themselves
        vec3 viewDir = normalize(vWorldPos - cameraPosition);
        float downness = clamp(-viewDir.y, 0.0, 1.0);
        float nearFog  = smoothstep(380.0, 18.0, dist);      // 1 close, 0 far
        float downFog  = smoothstep(0.05, 0.75, downness);   // 1 looking down
        float bodyFog  = cloud * 0.40;
        // capped lower so cloud-shape detail is visible from above
        float fogMix   = clamp(nearFog * 0.78 + downFog * 0.45 + bodyFog, 0.0, 0.92);
        col = mix(col, uFogCol, fogMix);

        // distant horizon: melt into a desaturated dusky haze (kept warm
        // but dark — sunrise hint, not a beach)
        float horizonFade = clamp((dist - 260.0) / 900.0, 0.0, 1.0);
        col = mix(col, uHazeCol, horizonFade * 0.7);

        // finale "parting" — sink visibility of the cloud field as uPart -> 1
        float aliveFactor = 1.0 - smoothstep(0.0, 1.0, uPart);
        col = mix(uHazeCol, col, aliveFactor);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  const plane = new THREE.Mesh(planeGeo, planeMat);
  // raised closer to the cliff so the mist swallows the view immediately
  // when peering over the edge — abyss reads as a thick rolling cloud
  plane.position.y = -22;
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
    // dim cool tint so the puffs read as drifting fog tendrils against
    // the new mysterious cloud-sea, not bright cream pillows
    color: 0x4a4658,
    transparent: true,
    opacity: 0.55,
    fog: false,
    depthWrite: false,
  });

  // Share ONE puff material across all sprites — the older code cloned
  // it 14× which means 14 unique materials, 14 shader uses, and a much
  // higher per-frame uniform-upload cost.
  const puffs = [];
  const PUFF_COUNT = 10;
  for (let i = 0; i < PUFF_COUNT; i++) {
    const ang = (i / PUFF_COUNT) * Math.PI * 2 + Math.random() * 0.4;
    const r = 220 + Math.random() * 320;
    const x = Math.cos(ang) * r;
    const z = Math.sin(ang) * r;
    const y = -22 + Math.random() * 14;
    const sprite = new THREE.Sprite(puffMat);
    const s = 80 + Math.random() * 90;
    sprite.scale.set(s * 1.4, s, 1);
    sprite.position.set(x, y, z);
    sprite.userData = {
      driftAng: Math.random() * Math.PI * 2,
      driftSpeed: 1.2 + Math.random() * 1.5,
      bobPhase: Math.random() * Math.PI * 2,
      baseY: y,
    };
    group.add(sprite);
    puffs.push(sprite);
  }

  // ------------------------------------------------------------
  // (c) Cliff-rim cloud bank
  // ------------------------------------------------------------
  // A dense ring of soft puffs hugging the island just below the cliff
  // edge. From the cliff vantage these read as a thick rolling layer of
  // clouds underneath you, hiding everything below — like looking down
  // from an airplane through the cloud deck.
  const rimMat = new THREE.SpriteMaterial({
    map: puffTex,
    // slightly lighter than the deep-fog puffs so the layer is readable
    // as a distinct cloud bank rather than blending into the abyss
    color: 0x6a6678,
    transparent: true,
    opacity: 0.85,
    fog: false,
    depthWrite: false,
  });

  const rimPuffs = [];
  // Three concentric overlapping rings at different altitudes for volume.
  // Each ring is dense enough that gaps between sprites are smaller than
  // a sprite width — so from above the layer looks continuous.
  const RIM_RINGS = [
    { count: 26, r0: 95,  r1: 130, y0: -8,  y1: -16, scale: 70 },
    { count: 30, r0: 130, r1: 180, y0: -12, y1: -22, scale: 86 },
    { count: 22, r0: 180, r1: 230, y0: -16, y1: -26, scale: 96 },
  ];
  for (const ring of RIM_RINGS) {
    for (let i = 0; i < ring.count; i++) {
      const ang = (i / ring.count) * Math.PI * 2
                + (Math.random() - 0.5) * (Math.PI / ring.count);
      const r = ring.r0 + Math.random() * (ring.r1 - ring.r0);
      const x = Math.cos(ang) * r;
      const z = Math.sin(ang) * r;
      const y = ring.y0 + Math.random() * (ring.y1 - ring.y0);
      const sprite = new THREE.Sprite(rimMat);
      const s = ring.scale + Math.random() * ring.scale * 0.5;
      sprite.scale.set(s * 1.5, s * 0.95, 1);
      sprite.position.set(x, y, z);
      sprite.userData = {
        driftAng: ang,
        driftSpeed: 0.4 + Math.random() * 0.6,
        bobPhase: Math.random() * Math.PI * 2,
        baseY: y,
        baseR: r,
      };
      group.add(sprite);
      rimPuffs.push(sprite);
    }
  }

  return { group, plane, planeMat, puffs, rimPuffs, rimMat, partFactor };
}

export function updateClouds(clouds, dt, t) {
  // animate cloud-sea shader time
  clouds.planeMat.uniforms.uTime.value = t;

  const part = clouds.partFactor.value;

  // single shared opacity for all puffs (we share the same SpriteMaterial)
  if (clouds.puffs.length) {
    const baseOp = 0.40 + Math.sin(t * 0.2) * 0.04;
    clouds.puffs[0].material.opacity = baseOp * (1.0 - part * 0.85);
  }
  for (const p of clouds.puffs) {
    p.userData.driftAng += dt * 0.005;
    const speed = p.userData.driftSpeed;
    p.position.x += Math.cos(p.userData.driftAng) * speed * dt;
    p.position.z += Math.sin(p.userData.driftAng) * speed * dt;
    p.position.y = p.userData.baseY + Math.sin(t * 0.18 + p.userData.bobPhase) * 1.4;
    const r = Math.hypot(p.position.x, p.position.z);
    if (r > 700) {
      const a = Math.atan2(p.position.z, p.position.x);
      p.position.x = Math.cos(a) * 200;
      p.position.z = Math.sin(a) * 200;
    }
  }

  // ---- cliff-rim cloud bank: tangential drift around the island ----
  if (clouds.rimMat) {
    const baseOp = 0.85 + Math.sin(t * 0.18) * 0.05;
    // when the finale parts the clouds, this layer thins so the reveal
    // can show the abyss/island clearly
    clouds.rimMat.opacity = baseOp * (1.0 - part * 0.92);
  }
  if (clouds.rimPuffs) {
    for (const p of clouds.rimPuffs) {
      // glide slowly around the island at constant radius
      p.userData.driftAng += dt * p.userData.driftSpeed * 0.025;
      const r = p.userData.baseR;
      p.position.x = Math.cos(p.userData.driftAng) * r;
      p.position.z = Math.sin(p.userData.driftAng) * r;
      p.position.y = p.userData.baseY + Math.sin(t * 0.22 + p.userData.bobPhase) * 0.9;
    }
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
