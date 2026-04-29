import * as THREE from "three";
import { LightProbeGenerator } from "three/addons/lights/LightProbeGenerator.js";
import { SkyShader } from "./shaders.js";
import { buildVox } from "./vox.js";

/* -----------------------------------------------------------
 * World layout
 *   The terrain is centred at origin. The mysterious tower is
 *   far north on the Z axis. Player spawns at origin facing -Z.
 *   Smaller ruins (broken pillars, stones) line the route as
 *   wordless waypoints toward the tower.
 * --------------------------------------------------------- */

export const ARCH_POSITION = new THREE.Vector3(0, 0, -340);  // tower position (kept name for compat)
export const TOWER_POSITION = ARCH_POSITION;
export const SPAWN_POSITION = new THREE.Vector3(0, 0, -200);

const SUN_DIR = new THREE.Vector3(0.42, 0.16, -0.9).normalize();

/* Heightmap: a sum of broad sine dunes plus medium ridges plus
 * small surface waves. Pure analytical so we can sample at any
 * (x, z) for player + particle queries without texture reads. */
export function getTerrainHeight(x, z) {
  // broad north-south rolling dunes
  const broad =
    Math.sin(x * 0.018 + Math.cos(z * 0.011) * 1.4) * 6.5 +
    Math.sin(z * 0.022 + 0.8) * 5.5;
  // medium dune ridges (oriented roughly east-west, the wind line)
  const medium =
    Math.sin(x * 0.06 + 1.3) * 1.6 +
    Math.sin(z * 0.045 + Math.sin(x * 0.03) * 2.0) * 2.4;
  // small wind ripples
  const small =
    Math.sin(x * 0.32 + z * 0.15) * 0.18 +
    Math.sin(x * 0.55 - z * 0.21) * 0.12;
  // a gentle bowl near spawn so the player has a calm starting basin
  const sdx = x - SPAWN_POSITION.x;
  const sdz = z - SPAWN_POSITION.z;
  const sdist2 = sdx * sdx + sdz * sdz;
  const bowl = -Math.exp(-sdist2 / (60 * 60)) * 4.0;
  // a rising plateau toward the tower (negative Z), so the destination
  // feels uphill / earned
  const towardArch = THREE.MathUtils.smoothstep(-z, -20, 320) * 6.0;

  // a small flat plaza around the tower so the steps & base land cleanly
  const dx = x - TOWER_POSITION.x;
  const dz = z - TOWER_POSITION.z;
  const plazaR2 = dx * dx + dz * dz;
  const plaza = Math.exp(-plazaR2 / (30 * 30)) * 1.2;

  return broad + medium + small + bowl + towardArch + plaza;
}

// kept for compat
export const getHeight = getTerrainHeight;

/* Approximate normal via finite differences. Reuses a shared TMP
 * so this can be hammered every frame without allocations. The
 * caller must consume / copy the result before calling again. */
const _NORMAL_TMP = new THREE.Vector3();
export function getNormal(x, z, eps = 0.6) {
  const hL = getTerrainHeight(x - eps, z);
  const hR = getTerrainHeight(x + eps, z);
  const hD = getTerrainHeight(x, z - eps);
  const hU = getTerrainHeight(x, z + eps);
  _NORMAL_TMP.set(hL - hR, 2 * eps, hD - hU).normalize();
  return _NORMAL_TMP;
}

/* Slope from 0 (flat) to 1 (vertical), useful for slide detection. */
export function getSlope(x, z) {
  const n = getNormal(x, z);
  return 1 - Math.max(0, n.y);
}

export function buildWorld(scene, renderer) {
  const root = new THREE.Group();
  scene.add(root);

  // ---- sky dome ----
  const skyGeo = new THREE.SphereGeometry(900, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: THREE.UniformsUtils.clone(SkyShader.uniforms),
    vertexShader: SkyShader.vertexShader,
    fragmentShader: SkyShader.fragmentShader,
    depthWrite: false,
  });
  skyMat.uniforms.uSunDir.value.copy(SUN_DIR);
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.renderOrder = -1;
  root.add(sky);

  // ---- lighting (probe-based, like the lightprobes example) ----
  // Bake the sky shader into a cube render target, then derive both:
  //   1. scene.environment — IBL for PBR materials (specular + diffuse)
  //   2. a LightProbe (L2 SH) — directionally-aware ambient that knows
  //      the sky is warm/bright above and the sand bounce comes from below.
  // This replaces the flat HemisphereLight + fill setup with proper GI
  // from the sky itself, which is what gives the lightprobes example
  // its grounded, soft, position-aware shading.
  if (renderer) {
    // small inline scene with sky + a faint ground plate so the lower
    // hemisphere of the probe gets warm-sand bounce, not pure black.
    const probeScene = new THREE.Scene();
    const probeSky = new THREE.Mesh(skyGeo.clone(), skyMat);
    probeScene.add(probeSky);
    const groundDisc = new THREE.Mesh(
      new THREE.CircleGeometry(800, 24),
      new THREE.MeshBasicMaterial({ color: 0xc8a06a, side: THREE.DoubleSide }),
    );
    groundDisc.rotation.x = -Math.PI / 2;
    groundDisc.position.y = -2;
    probeScene.add(groundDisc);

    const cubeRT = new THREE.WebGLCubeRenderTarget(256, {
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
    });
    const cubeCam = new THREE.CubeCamera(1, 2000, cubeRT);
    cubeCam.position.set(0, 6, 0);
    cubeCam.update(renderer, probeScene);

    // PMREM for IBL — gives correct specular + diffuse on standard mats
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envRT = pmrem.fromCubemap(cubeRT.texture);
    scene.environment = envRT.texture;
    // Keep IBL specular but quieter on diffuse so the SH probe drives
    // the ambient look (we don't want both stacking into a wash).
    if ("environmentIntensity" in scene) scene.environmentIntensity = 0.45;
    pmrem.dispose();

    // SH light probe — proper directional ambient
    const probe = LightProbeGenerator.fromCubeRenderTarget(renderer, cubeRT);
    probe.intensity = 0.75;
    root.add(probe);

    cubeRT.dispose();
  } else {
    // fallback if no renderer was passed (shouldn't happen) — a hemi
    // is the closest cheap approximation
    root.add(new THREE.HemisphereLight(0xffe4b8, 0x6b3a18, 0.42));
  }

  // direct sun — softened so the probe-based ambient does most of the
  // contour work (this is what makes the lightprobes example feel
  // "lit" rather than "spotlit")
  const sun = new THREE.DirectionalLight(0xffd28a, 0.95);
  sun.position.copy(SUN_DIR).multiplyScalar(120);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sShadow = 55;
  sun.shadow.camera.left = -sShadow;
  sun.shadow.camera.right = sShadow;
  sun.shadow.camera.top = sShadow;
  sun.shadow.camera.bottom = -sShadow;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 280;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.06;
  // soften the shadow edge — the lightprobes example uses a large
  // shadow.radius to get that diffuse, ambient feel
  sun.shadow.radius = 4.0;
  sun.shadow.blurSamples = 16;
  root.add(sun);
  root.add(sun.target);

  // ---- terrain ----
  const TERRAIN_SIZE = 900;
  const TERRAIN_SEGS = 260;
  const terrainGeo = new THREE.PlaneGeometry(
    TERRAIN_SIZE,
    TERRAIN_SIZE,
    TERRAIN_SEGS,
    TERRAIN_SEGS,
  );
  terrainGeo.rotateX(-Math.PI / 2);

  const posAttr = terrainGeo.attributes.position;
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const z = posAttr.getZ(i);
    posAttr.setY(i, getTerrainHeight(x, z));
  }
  posAttr.needsUpdate = true;
  terrainGeo.computeVertexNormals();

  const sandMat = makeSandMaterial();
  const terrain = new THREE.Mesh(terrainGeo, sandMat);
  terrain.receiveShadow = true;
  root.add(terrain);

  // a footprint decal layer rendered just above the sand
  const footprintLayer = makeFootprintLayer();
  footprintLayer.mesh.position.copy(terrain.position);
  root.add(footprintLayer.mesh);

  // ---- distant mountain ring ----
  // Big silhouettes far past the fog, with their own atmospheric tint
  // baked into vertex colors (fog disabled on the material so they
  // don't dissolve at this distance).
  root.add(buildDistantMountains());

  // ---- destination: tower ----
  const towerY = getTerrainHeight(TOWER_POSITION.x, TOWER_POSITION.z);
  const towerBuild = buildTower();
  const tower = towerBuild.group;
  tower.position.copy(TOWER_POSITION);
  tower.position.y = towerY;
  root.add(tower);

  // step colliders (world space)
  const stairColliders = towerBuild.steps.map((s) => ({
    x: TOWER_POSITION.x + s.x,
    z: TOWER_POSITION.z + s.z,
    y: towerY + s.y,
    halfW: s.halfW,
    halfD: s.halfD,
    cos: s.cos,
    sin: s.sin,
  }));

  // a giant base cylinder collider (so the player can't walk through the tower)
  const TOWER_BASE_RADIUS = towerBuild.baseRadius;
  const TOWER_TOP_TRIGGER_Y = towerY + towerBuild.totalHeight - 4.0;

  // ---- waypoints: ancient pillars ----
  const ruins = buildRuins();
  root.add(ruins);

  // ---- spawn lamp ----
  const lamp = buildLamp();
  const lampX = SPAWN_POSITION.x + 4.0, lampZ = SPAWN_POSITION.z - 2.0;
  lamp.position.set(lampX, getTerrainHeight(lampX, lampZ), lampZ);
  root.add(lamp);

  // ---- distant silhouette range ----
  const range = buildDistantRange();
  root.add(range);

  // ---- hidden trigger sphere at tower foot ----
  const archTrigger = new THREE.Vector3().copy(TOWER_POSITION);
  archTrigger.y = towerY;

  /* World height query that includes stair colliders. The player
   * uses this for ground collision so they can walk up the spiral
   * stairs. fromY caps which steps are eligible (you can't snap up
   * onto a step that's far above your head). */
  function surfaceY(x, z, fromY) {
    let y = getTerrainHeight(x, z);
    if (fromY === undefined) return y;

    // fast cull: if not near tower, skip stair check entirely
    const dx = x - TOWER_POSITION.x;
    const dz = z - TOWER_POSITION.z;
    const r2 = dx * dx + dz * dz;
    if (r2 > 40 * 40) return y;

    for (let i = 0; i < stairColliders.length; i++) {
      const s = stairColliders[i];
      // step is small; only test if close in xz
      const ddx = x - s.x;
      const ddz = z - s.z;
      if (ddx * ddx + ddz * ddz > 12) continue;
      // rotate into step local frame
      const lx = ddx * s.cos + ddz * s.sin;
      const lz = -ddx * s.sin + ddz * s.cos;
      if (Math.abs(lx) > s.halfW) continue;
      if (Math.abs(lz) > s.halfD) continue;
      // accept if step is within natural step-up reach (so the player
      // can walk up the spiral) or below the player (so they land on
      // it from above).
      if (s.y > fromY + 0.9) continue;
      if (s.y > y) y = s.y;
    }
    return y;
  }

  /* Returns true if (x, z) at height y hits the tower body. The tower
   * is a tapered stack so the blocking radius shrinks with altitude. */
  function blocksColumn(x, z, y) {
    const dx = x - TOWER_POSITION.x;
    const dz = z - TOWER_POSITION.z;
    const r2 = dx * dx + dz * dz;
    const yLocal = (y === undefined ? 0 : y - towerY);
    if (yLocal > towerBuild.totalHeight + 4) return false;
    const r = towerBuild.radiusAt(Math.max(0, yLocal));
    return r2 < r * r;
  }

  const world = {
    root,
    sky,
    skyMat,
    terrain,
    sandMat,
    sun,
    sunDir: SUN_DIR.clone(),
    arch: tower,        // kept name for code that referenced "arch"
    tower,
    towerInfo: towerBuild,
    ruins,
    lamp,
    archTrigger,
    towerTopY: TOWER_TOP_TRIGGER_Y,
    towerBaseRadius: TOWER_BASE_RADIUS,
    footprintLayer,
    stairColliders,
    getHeight: getTerrainHeight,
    getTerrainHeight,
    surfaceY,
    blocksColumn,
    getNormal,
    getSlope,
    unlockTowerStairs() {
      towerBuild.unlockUpperStairs(stairColliders, TOWER_POSITION);
    },
  };

  // Haze: a warm-tan-meets-teal so the dunes blend into the cooler
  // sky band overhead without losing their golden footing near the
  // horizon. Same color used for fog and the sand-shader uHaze.
  scene.background = new THREE.Color("#cfd9c2");
  scene.fog = new THREE.Fog(0xcfd9c2, 80, 360);

  // ---- voxel props (MagicaVoxel) ----
  // Loaded asynchronously; missing files are skipped gracefully so the
  // scene works even before any .vox assets are dropped in.
  world.vox = buildVox(scene, world);

  return world;
}

/* -----------------------------------------------------------
 * Sand material: built on MeshStandardMaterial so it correctly
 * receives shadows. Tuned for a more solid base with subtle
 * surface variation rather than splotchy noise.
 * --------------------------------------------------------- */
function makeSandMaterial() {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xe8c98a,
    roughness: 0.97,
    metalness: 0.0,
  });

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime      = { value: 0 };
    shader.uniforms.uHaze      = { value: new THREE.Color("#cfd9c2") };
    shader.uniforms.uColorLow  = { value: new THREE.Color("#cca678") };
    shader.uniforms.uColorMid  = { value: new THREE.Color("#e6c693") };
    shader.uniforms.uColorHigh = { value: new THREE.Color("#f5dfae") };
    shader.uniforms.uShadow    = { value: new THREE.Color("#5b3a20") };
    shader.uniforms.uFogNear   = { value: 60.0 };
    shader.uniforms.uFogFar    = { value: 380.0 };

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vWorldPos;
        varying float vSlopeF;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      )
      .replace(
        "#include <defaultnormal_vertex>",
        `#include <defaultnormal_vertex>
        vSlopeF = 1.0 - clamp((modelMatrix * vec4(objectNormal, 0.0)).y, 0.0, 1.0);`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uTime;
        uniform vec3 uHaze;
        uniform vec3 uColorLow;
        uniform vec3 uColorMid;
        uniform vec3 uColorHigh;
        uniform vec3 uShadow;
        uniform float uFogNear;
        uniform float uFogFar;
        varying vec3 vWorldPos;
        varying float vSlopeF;
        float h11_(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vn_(vec2 p){
          vec2 i = floor(p); vec2 f = fract(p);
          vec2 u = f*f*(3.0-2.0*f);
          float a = h11_(i);
          float b = h11_(i + vec2(1.0, 0.0));
          float c = h11_(i + vec2(0.0, 1.0));
          float d = h11_(i + vec2(1.0, 1.0));
          return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
        }
        float fbm_(vec2 p){
          float v = 0.0; float a = 0.5;
          for (int i = 0; i < 4; i++) { v += a * vn_(p); p *= 2.03; a *= 0.5; }
          return v;
        }`,
      )
      .replace(
        "vec4 diffuseColor = vec4( diffuse, opacity );",
        `// ---- elevation tint ----
        float crest = smoothstep(-2.0, 14.0, vWorldPos.y);
        vec3 sandBase = mix(uColorLow, uColorMid, crest);
        sandBase = mix(sandBase, uColorHigh, smoothstep(10.0, 18.0, vWorldPos.y) * 0.35);

        // ---- macro color drift (broad warm/cool patches across the desert) ----
        vec2 np = vWorldPos.xz * 0.018;
        float macro = fbm_(np) - 0.5;
        sandBase *= 1.0 + macro * 0.11;

        // ---- mid-scale patches (sun-bleached vs damp/shaded) ----
        float patches = fbm_(vWorldPos.xz * 0.075 + 13.7);
        sandBase *= mix(0.90, 1.07, patches);

        // ---- fine grain microsurface ----
        float grain = fbm_(vWorldPos.xz * 6.0);
        sandBase *= 0.93 + grain * 0.12;

        // ---- ultra-fine grain (per-pixel) ----
        float micro = fbm_(vWorldPos.xz * 22.0);
        sandBase *= 0.96 + micro * 0.07;

        // ---- silica sparkle: rare bright specks ----
        float sparkleHash = h11_(floor(vWorldPos.xz * 240.0) + vec2(7.1, 31.3));
        float sparkle = step(0.985, sparkleHash);
        sandBase += sparkle * vec3(0.22, 0.16, 0.09);

        // ---- wind ripples: dual frequencies for crisscross dune texture ----
        float warp = fbm_(vWorldPos.xz * 0.45) * 4.5;
        float r1 = sin(vWorldPos.x * 1.55 + warp);
        float r2 = sin(vWorldPos.x * 0.55 + vWorldPos.z * 0.28 + fbm_(vWorldPos.xz * 0.3) * 3.0);
        float ripple = (r1 * 0.65 + r2 * 0.45) * 0.5 + 0.5;
        sandBase *= mix(0.88, 1.10, ripple);
        // sharp little crest highlights on the windward side
        float crestHL = smoothstep(0.80, 0.96, ripple);
        sandBase += crestHL * vec3(0.10, 0.07, 0.04);

        // ---- pebble pockets (rare darker grains) ----
        vec2 pebCell = floor(vWorldPos.xz * 11.0);
        float peb = h11_(pebCell + vec2(2.7, 5.1));
        float pebbleMask = smoothstep(0.955, 0.985, peb);
        sandBase *= mix(1.0, 0.55, pebbleMask);

        // ---- dark cracks / dirt streaks following the noise field ----
        float crack = smoothstep(0.62, 0.72, fbm_(vWorldPos.xz * 0.32 + 4.1));
        sandBase *= mix(1.0, 0.86, crack * 0.45);

        // ---- slope: steeper faces expose darker dune-rock underneath ----
        float slopeMix = smoothstep(0.42, 0.85, vSlopeF);
        sandBase = mix(sandBase, uShadow * 1.25, slopeMix * 0.55);
        // a touch of grit on slopes (more grain visible where sand spills)
        sandBase *= 1.0 - slopeMix * (1.0 - grain) * 0.18;

        vec4 diffuseColor = vec4(sandBase, opacity);`,
      )
      .replace(
        "#include <fog_fragment>",
        `// custom warm haze, replacing default fog
        float distH = length(cameraPosition - vWorldPos);
        float hf = clamp((distH - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
        hf = hf * hf * (3.0 - 2.0 * hf);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, uHaze, hf * 0.92);`,
      );

    mat.userData.shader = shader;
  };

  return mat;
}

/* -----------------------------------------------------------
 * Footprint layer: a single textured plane laid just above the
 * sand. The texture is a CanvasTexture we draw into procedurally
 * each time the player steps. This avoids per-step geometry and
 * keeps the cost flat: one extra textured plane.
 * --------------------------------------------------------- */
function makeFootprintLayer() {
  // The footprint plane covers an area centred on the player
  // and follows them. Use a power-of-two canvas for fast updates.
  const SIZE = 1024;
  const WORLD_SIZE = 80; // world meters covered by the texture
  const cvs = document.createElement("canvas");
  cvs.width = cvs.height = SIZE;
  const ctx = cvs.getContext("2d");
  ctx.clearRect(0, 0, SIZE, SIZE);

  const tex = new THREE.CanvasTexture(cvs);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;

  // we render this as a textured plane that's parented to the
  // terrain mesh. A custom shader lifts it slightly off the terrain
  // and uses the texture's alpha as a darkening multiplier.
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 1, 1);
  geo.rotateX(-Math.PI / 2);

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    uniforms: {
      tFootprints: { value: tex },
      uOrigin: { value: new THREE.Vector2(0, 0) },
      uSize: { value: WORLD_SIZE },
      uHaze: { value: new THREE.Color("#cfd9c2") },
      uFogNear: { value: 60.0 },
      uFogFar: { value: 380.0 },
    },
    vertexShader: /* glsl */`
      varying vec2 vWorldXZ;
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vWorldXZ = wp.xz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */`
      uniform sampler2D tFootprints;
      uniform vec2 uOrigin;
      uniform float uSize;
      uniform vec3 uHaze;
      uniform float uFogNear;
      uniform float uFogFar;
      varying vec2 vWorldXZ;
      varying vec3 vWorldPos;
      void main() {
        // map world xz to texture uv
        vec2 uv = (vWorldXZ - uOrigin) / uSize + 0.5;
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
        vec4 fp = texture2D(tFootprints, uv);
        // alpha holds the depression strength
        float a = fp.a;
        if (a < 0.01) discard;
        // dark inset color shaded as if pressed into sand
        vec3 col = vec3(0.32, 0.22, 0.13);
        // fade with distance haze so far footprints don't pop
        float dist = length(cameraPosition - vWorldPos);
        float hf = clamp((dist - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
        gl_FragColor = vec4(col, a * (1.0 - hf * 0.92) * 0.85);
      }
    `,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0.02;
  mesh.renderOrder = 0.5;
  mesh.frustumCulled = false;

  return {
    mesh,
    canvas: cvs,
    ctx,
    texture: tex,
    size: SIZE,
    worldSize: WORLD_SIZE,
    origin: new THREE.Vector2(0, 0),
    material: mat,
    /* draw a footprint at world (x, z) with rotation a (radians, foot
     * facing direction) and side ('L' or 'R'). Caller must call
     * texture.needsUpdate = true (we do it here). */
    stamp(x, z, angle, side, alpha = 0.65) {
      // recenter the canvas if the player has moved far from origin
      const halfWorld = this.worldSize * 0.5;
      const dx = x - this.origin.x;
      const dz = z - this.origin.y;
      if (Math.abs(dx) > halfWorld * 0.5 || Math.abs(dz) > halfWorld * 0.5) {
        // shift canvas content to keep player near centre
        const shiftPxX = Math.round((dx / this.worldSize) * this.size);
        const shiftPxY = Math.round((dz / this.worldSize) * this.size);
        const data = this.ctx.getImageData(0, 0, this.size, this.size);
        this.ctx.clearRect(0, 0, this.size, this.size);
        this.ctx.putImageData(data, -shiftPxX, -shiftPxY);
        this.origin.set(x, z);
        // update plane center
        this.mesh.position.x = x;
        this.mesh.position.z = z;
        this.material.uniforms.uOrigin.value.set(x, z);
      }
      // map (x, z) to canvas pixel
      const px = ((x - this.origin.x) / this.worldSize + 0.5) * this.size;
      const py = ((z - this.origin.y) / this.worldSize + 0.5) * this.size;
      const ctx = this.ctx;
      const FOOT_LEN_PX = (0.38 / this.worldSize) * this.size;
      const FOOT_W_PX = (0.18 / this.worldSize) * this.size;

      // ---- soft scuff halo around the print (kicked-up sand dust) ----
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(angle);
      const haloR = FOOT_LEN_PX * 1.6;
      const halo = ctx.createRadialGradient(0, 0, FOOT_LEN_PX * 0.4, 0, 0, haloR);
      halo.addColorStop(0, `rgba(60, 38, 18, ${alpha * 0.35})`);
      halo.addColorStop(1, `rgba(60, 38, 18, 0)`);
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.ellipse(0, 0, haloR * 0.85, haloR, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // ---- drag streak from the previous print to this one ----
      // gives the sand trail a continuous, scuffed look
      if (this._lastPx !== undefined) {
        const ldx = px - this._lastPx;
        const ldz = py - this._lastPy;
        const dlen = Math.hypot(ldx, ldz);
        // only connect prints that are reasonably close (same trail)
        if (dlen > 1 && dlen < FOOT_LEN_PX * 8) {
          ctx.save();
          ctx.strokeStyle = `rgba(48, 28, 14, ${alpha * 0.32})`;
          ctx.lineWidth = FOOT_W_PX * 0.55;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(this._lastPx, this._lastPy);
          ctx.lineTo(px, py);
          ctx.stroke();
          ctx.restore();
        }
      }
      this._lastPx = px;
      this._lastPy = py;

      // ---- the footprint itself ----
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(angle);
      // toe in/out for left/right
      const toe = side === "L" ? -0.12 : 0.12;
      ctx.rotate(toe);
      // sole: deeper centre for the heel-to-arch impression
      const sole = ctx.createLinearGradient(0, FOOT_LEN_PX * 0.5, 0, -FOOT_LEN_PX * 0.55);
      sole.addColorStop(0, `rgba(28, 14, 6, ${alpha})`);
      sole.addColorStop(0.5, `rgba(38, 22, 10, ${alpha * 0.95})`);
      sole.addColorStop(1, `rgba(48, 28, 14, ${alpha * 0.85})`);
      ctx.fillStyle = sole;
      ctx.beginPath();
      ctx.ellipse(0, 0, FOOT_W_PX * 0.55, FOOT_LEN_PX * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      // toe pads (3 small dots near the front)
      ctx.fillStyle = `rgba(28, 14, 6, ${alpha * 0.85})`;
      for (let i = 0; i < 3; i++) {
        const tx = (i - 1) * FOOT_W_PX * 0.32;
        const ty = -FOOT_LEN_PX * 0.55;
        ctx.beginPath();
        ctx.ellipse(tx, ty, FOOT_W_PX * 0.18, FOOT_LEN_PX * 0.20, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      // a thin highlight rim on the windward edge so the print reads as
      // a *depression* (one side bright sand pile, opposite side shadow)
      ctx.strokeStyle = `rgba(255, 232, 178, ${alpha * 0.35})`;
      ctx.lineWidth = Math.max(1, FOOT_W_PX * 0.06);
      ctx.beginPath();
      ctx.ellipse(0, 0, FOOT_W_PX * 0.55, FOOT_LEN_PX * 0.5, 0, Math.PI * 0.85, Math.PI * 1.55);
      ctx.stroke();
      ctx.restore();
      this.texture.needsUpdate = true;
    },
    /* slowly fade existing footprints over time (wind erodes them).
     * Uses destination-out compositing so the GPU does the alpha
     * subtraction — much faster than getImageData/putImageData. */
    decay(dt) {
      if (dt <= 0) return;
      const fade = Math.min(0.05, dt * 0.025);
      const ctx = this.ctx;
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = `rgba(0,0,0,${fade})`;
      ctx.fillRect(0, 0, this.size, this.size);
      ctx.restore();
      this.texture.needsUpdate = true;
    },
  };
}

/* -----------------------------------------------------------
 * Distant mountain ring — a low-poly silhouette ridge encircling
 * the world far beyond the fog, with vertex colors that fake
 * atmospheric perspective. Two ridges (a darker near range, a
 * lighter far range) give a sense of layered depth.
 * --------------------------------------------------------- */
function buildDistantMountains() {
  const group = new THREE.Group();

  /* -----------------------------------------------------------
   * Each ring is a lofty triangle strip whose top edge follows a
   * multi-octave pseudo-noise function around the unit circle.
   * The geometry is a simple base→peak strip with a vertex-color
   * gradient; the silhouette is what carries the detail, so we
   * push the angular resolution and pile on extra octaves to give
   * the skyline lots of fine crags and sub-peaks.
   * --------------------------------------------------------- */
  function buildRidge({
    radius, segs, baseY, peakLow, peakHigh, baseColor, peakColor,
    radialJitter = 0.06,
    octaves = [
      { freq: 1.4,  amp: 0.55 },
      { freq: 4.7,  amp: 0.26 },
      { freq: 13.7, amp: 0.12 },
      { freq: 31.0, amp: 0.05 },
      { freq: 67.0, amp: 0.02 },
    ],
    seed = 0,
  }) {
    const positions = [];
    const colors = [];
    const indices = [];
    const cBase = new THREE.Color(baseColor);
    const cPeak = new THREE.Color(peakColor);

    function peakAt(a) {
      let n = 0;
      let amp = 0;
      for (const o of octaves) {
        // mix sin & cos at slightly different harmonics so the
        // skyline doesn't repeat with the period of the lowest octave
        n += (Math.sin(a * o.freq + seed)
            + Math.cos(a * o.freq * 0.73 + seed * 1.31)) * o.amp;
        amp += o.amp * 2;
      }
      const t = (n / amp) * 0.5 + 0.5; // 0..1
      return THREE.MathUtils.lerp(peakLow, peakHigh, t);
    }

    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const r = radius * (
        1
        + Math.sin(a * 2.3 + seed) * radialJitter * 0.6
        + Math.sin(a * 0.7 + seed * 1.1) * radialJitter
      );
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const h = peakAt(a);
      // base vertex
      positions.push(x, baseY, z);
      colors.push(cBase.r, cBase.g, cBase.b);
      // peak vertex
      positions.push(x, baseY + h, z);
      colors.push(cPeak.r, cPeak.g, cPeak.b);
    }

    for (let i = 0; i < segs; i++) {
      const a0 = i * 2;
      const a1 = ((i + 1) % segs) * 2;
      // wind so the inward face is front
      indices.push(a0, a1 + 1, a0 + 1);
      indices.push(a0, a1, a1 + 1);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      fog: false,
      side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    m.renderOrder = -2; // behind everything else
    return m;
  }

  // farthest range — biggest, palest, melts into the sky
  group.add(buildRidge({
    radius: 1020,
    segs: 720,
    baseY: -14,
    peakLow: 140,
    peakHigh: 320,
    baseColor: "#9c8898",
    peakColor: "#e3d5c4",
    radialJitter: 0.04,
    octaves: [
      { freq: 1.2,  amp: 0.55 },
      { freq: 3.7,  amp: 0.26 },
      { freq: 9.3,  amp: 0.14 },
      { freq: 23.1, amp: 0.07 },
      { freq: 53.0, amp: 0.035 },
      { freq: 113.0, amp: 0.018 },
    ],
    seed: 0.913,
  }));

  // far range — taller, paler/hazier, blue-shifted
  group.add(buildRidge({
    radius: 760,
    segs: 600,
    baseY: -8,
    peakLow: 90,
    peakHigh: 220,
    baseColor: "#7e6a72",
    peakColor: "#cdb89c",
    radialJitter: 0.05,
    octaves: [
      { freq: 1.4,  amp: 0.55 },
      { freq: 4.7,  amp: 0.26 },
      { freq: 11.3, amp: 0.14 },
      { freq: 27.0, amp: 0.07 },
      { freq: 63.0, amp: 0.03 },
      { freq: 137.0, amp: 0.015 },
    ],
    seed: 1.234,
  }));

  // near range — shorter, warmer, slightly closer in
  group.add(buildRidge({
    radius: 540,
    segs: 520,
    baseY: -6,
    peakLow: 36,
    peakHigh: 110,
    baseColor: "#5e4a40",
    peakColor: "#a5856a",
    radialJitter: 0.07,
    octaves: [
      { freq: 2.1,  amp: 0.50 },
      { freq: 5.3,  amp: 0.27 },
      { freq: 13.1, amp: 0.15 },
      { freq: 31.0, amp: 0.07 },
      { freq: 71.0, amp: 0.035 },
      { freq: 153.0, amp: 0.018 },
    ],
    seed: 5.678,
  }));

  return group;
}

/* -----------------------------------------------------------
 * Tower: a tall, stepped sun-temple silhouette with a spiraling
 * external staircase. The middle section of the stair is missing
 * until the player solves a small puzzle at the base — three
 * glyph plates that must each be activated. Returns:
 *   - group, steps[], baseRadius, totalHeight, accentMeshes,
 *     spire/core/glow (animation hooks), radiusAt(y),
 *   - plates[]: puzzle glyph plates (local pos, mesh, light, lit)
 *   - unlockUpperStairs(stairColliders, towerPos): reveals the
 *     missing middle section and adds its colliders.
 * --------------------------------------------------------- */
function buildTower() {
  const g = new THREE.Group();

  // ---- materials ----
  const stoneMat = new THREE.MeshStandardMaterial({
    color: 0x9d7148, roughness: 0.92, metalness: 0.0,
  });
  const accentStoneMat = new THREE.MeshStandardMaterial({
    color: 0x4a2a18, roughness: 0.85, metalness: 0.05,
  });
  const stepMat = new THREE.MeshStandardMaterial({
    color: 0x8a5d3a, roughness: 0.95, metalness: 0.0,
  });

  // ---- stepped square tiers (sun-temple silhouette) — 5 tiers, taller ----
  // hw = half-width (tier is a square of side 2*hw).
  const tiers = [
    { hw: 8.0, h: 24, yBase: 0,   bandColor: 0x6cbcc8 },
    { hw: 6.6, h: 22, yBase: 24,  bandColor: 0x8edae0 },
    { hw: 5.4, h: 22, yBase: 46,  bandColor: 0xb8e6e8 },
    { hw: 4.2, h: 20, yBase: 68,  bandColor: 0xcfeef0 },
    { hw: 3.0, h: 16, yBase: 88,  bandColor: 0xe0f4f6 },
  ];
  // collision radius (inscribed circle of the base — the player can
  // walk into the corner pockets, which feels right for a square temple)
  const baseRadius = tiers[0].hw * 0.95;
  const totalHeight = tiers[tiers.length - 1].yBase + tiers[tiers.length - 1].h;

  const accentMeshes = [];

  for (let t = 0; t < tiers.length; t++) {
    const tier = tiers[t];

    // shaft: solid square block
    const shaftGeo = new THREE.BoxGeometry(tier.hw * 2, tier.h, tier.hw * 2);
    const shaft = new THREE.Mesh(shaftGeo, stoneMat);
    shaft.position.y = tier.yBase + tier.h * 0.5;
    shaft.castShadow = true;
    shaft.receiveShadow = true;
    g.add(shaft);

    // cap slab on top — slightly wider, like temple lintel stones
    const capH = 0.9;
    const capW = tier.hw * 2 + 0.7;
    const cap = new THREE.Mesh(new THREE.BoxGeometry(capW, capH, capW), stoneMat);
    cap.position.y = tier.yBase + tier.h - capH * 0.5;
    cap.castShadow = true;
    cap.receiveShadow = true;
    g.add(cap);

    // dark inset frieze band just under the cap
    const bandH = 0.55;
    const bandW = tier.hw * 2 + 0.25;
    const band = new THREE.Mesh(
      new THREE.BoxGeometry(bandW, bandH, bandW),
      accentStoneMat,
    );
    band.position.y = tier.yBase + tier.h - capH - bandH * 0.5;
    band.castShadow = true;
    band.receiveShadow = true;
    g.add(band);

    // glyphs on the frieze: 2 per face, glow band color
    for (let f = 0; f < 4; f++) {
      const ang = f * (Math.PI / 2);
      const nx = Math.cos(ang);
      const nz = Math.sin(ang);
      // outward normal direction; tangent for placing two glyphs per face
      const tx = -nz, tz = nx;
      for (let k = -1; k <= 1; k += 2) {
        const offset = k * tier.hw * 0.45;
        const gx = nx * (tier.hw + 0.06) + tx * offset;
        const gz = nz * (tier.hw + 0.06) + tz * offset;
        const glyph = new THREE.Mesh(
          new THREE.PlaneGeometry(0.5, 0.65),
          new THREE.MeshBasicMaterial({
            color: tier.bandColor,
            transparent: true,
            opacity: 0.7,
            side: THREE.DoubleSide,
          }),
        );
        glyph.position.set(gx, tier.yBase + tier.h - capH - bandH * 0.5, gz);
        glyph.lookAt(gx + nx, glyph.position.y, gz + nz);
        g.add(glyph);
        accentMeshes.push({ mesh: glyph, mat: glyph.material, baseColor: tier.bandColor });
      }
    }
  }

  // ---- stepped pyramid finial above the top tier ----
  let finialY = totalHeight;
  for (let i = 0; i < 3; i++) {
    const w = 2.6 - i * 0.7;
    const h = 0.7;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), stoneMat);
    slab.position.y = finialY + h * 0.5;
    slab.castShadow = true;
    slab.receiveShadow = true;
    g.add(slab);
    finialY += h;
  }

  // crowning spire (elongated diamond)
  const spireGeo = new THREE.OctahedronGeometry(2.0, 0);
  spireGeo.scale(0.6, 2.2, 0.6);
  const spireMat = new THREE.MeshStandardMaterial({
    color: 0xe0f4f6,
    roughness: 0.4,
    metalness: 0.2,
    emissive: 0x2a6a78,
    emissiveIntensity: 0.6,
  });
  const spire = new THREE.Mesh(spireGeo, spireMat);
  spire.position.y = finialY + 1.8;
  spire.castShadow = true;
  g.add(spire);

  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.85, 1),
    new THREE.MeshBasicMaterial({ color: 0xffe4b8 }),
  );
  core.position.y = spire.position.y;
  g.add(core);

  const glow = new THREE.PointLight(0xa0e4ec, 8.0, 90, 1.6);
  glow.position.y = spire.position.y;
  g.add(glow);

  // ---- spiral staircase wrapping the square tower ----
  // Spiral radius at height y = tier corner-distance + gap, so the
  // spiral hugs the silhouette as it tapers.
  function towerHalfWidthAt(y) {
    if (y <= 0) return tiers[0].hw;
    for (let k = 0; k < tiers.length; k++) {
      const tk = tiers[k];
      if (y >= tk.yBase && y < tk.yBase + tk.h) return tk.hw;
    }
    return tiers[tiers.length - 1].hw * 0.6;
  }
  const STEP_GAP = 1.0;
  function spiralRadiusAt(y) {
    return towerHalfWidthAt(y) * Math.SQRT2 + STEP_GAP;
  }

  const steps = [];
  const stepGeo = new THREE.BoxGeometry(2.2, 0.28, 1.55);
  const STEP_COUNT = 150;                                  // taller tower → more steps
  const STEP_RISE = (totalHeight - 8) / STEP_COUNT;        // ≈ 0.65 m / step
  const STEP_ANGLE_PER = 0.115;                            // ≈ 6.6° / step

  // The puzzle gap: a missing middle section. Until the puzzle is
  // solved these steps are invisible AND have no collider, so the
  // player physically can't continue past it.
  const PUZZLE_GAP_START = 60;
  const PUZZLE_GAP_END   = 78;

  const skipPattern = (i) => {
    if (i < 4) return false;
    if (i % 11 === 0) return true;
    if (i % 17 === 0) return true;
    return false;
  };
  const isPuzzleStep = (i) => i >= PUZZLE_GAP_START && i < PUZZLE_GAP_END;

  const _kept = [];
  for (let i = 0; i < STEP_COUNT; i++) {
    if (skipPattern(i)) continue;
    _kept.push(i);
  }

  const stepMesh = new THREE.InstancedMesh(stepGeo, stepMat, _kept.length);
  stepMesh.castShadow = false;
  stepMesh.receiveShadow = true;

  const _stepMat = new THREE.Matrix4();
  const _stepQ = new THREE.Quaternion();
  const _stepP = new THREE.Vector3();
  const _stepS = new THREE.Vector3(1, 1, 1);
  const _hideS = new THREE.Vector3(0.0001, 0.0001, 0.0001);
  const Y_AXIS = new THREE.Vector3(0, 1, 0);

  // glow strips
  const stripGeo = new THREE.BoxGeometry(2.05, 0.04, 0.04);
  const stripMat = new THREE.MeshBasicMaterial({
    color: 0x9be0e8, transparent: true, opacity: 0.8,
  });
  const stripCount = Math.ceil(_kept.length / 3);
  const stripMesh = new THREE.InstancedMesh(stripGeo, stripMat, stripCount);
  let stripIdx = 0;

  // stash per-instance info so we can re-enable puzzle steps later
  const stepInfo = [];   // [{ instanceIdx, srcIdx, x, y, z, yawY, isPuzzle, stripIdx? }]

  for (let n = 0; n < _kept.length; n++) {
    const i = _kept[n];
    const ang = i * STEP_ANGLE_PER;
    const y = i * STEP_RISE + 0.5;
    const rT = spiralRadiusAt(y);
    const x = Math.cos(ang) * rT;
    const z = Math.sin(ang) * rT;
    const yawY = -ang + Math.PI / 2;
    const puzzle = isPuzzleStep(i);

    _stepP.set(x, y, z);
    _stepQ.setFromAxisAngle(Y_AXIS, yawY);
    _stepMat.compose(_stepP, _stepQ, puzzle ? _hideS : _stepS);
    stepMesh.setMatrixAt(n, _stepMat);

    if (!puzzle) {
      steps.push({
        x, z,
        y: y + 0.14,
        halfW: 1.1,
        halfD: 0.78,
        cos: Math.cos(yawY),
        sin: Math.sin(yawY),
      });
    }

    let myStrip = -1;
    if (i % 3 === 0) {
      const sx = x + Math.cos(ang) * 0.65;
      const sz = z + Math.sin(ang) * 0.65;
      _stepP.set(sx, y + 0.16, sz);
      _stepMat.compose(_stepP, _stepQ, puzzle ? _hideS : _stepS);
      stripMesh.setMatrixAt(stripIdx, _stepMat);
      myStrip = stripIdx;
      stripIdx++;
    }

    stepInfo.push({ instanceIdx: n, srcIdx: i, x, y, z, yawY, isPuzzle: puzzle, stripIdx: myStrip });
  }
  for (let k = stripIdx; k < stripCount; k++) {
    _stepP.set(0, -10000, 0);
    _stepMat.compose(_stepP, _stepQ, _stepS);
    stripMesh.setMatrixAt(k, _stepMat);
  }
  stepMesh.instanceMatrix.needsUpdate = true;
  stripMesh.instanceMatrix.needsUpdate = true;
  g.add(stepMesh);
  g.add(stripMesh);
  accentMeshes.push({ mesh: stripMesh, mat: stripMat, baseColor: 0x9be0e8 });

  // top platform
  const topY = STEP_COUNT * STEP_RISE + 0.5;
  const topR = towerHalfWidthAt(topY);
  const platR = topR * Math.SQRT2 + STEP_GAP + 0.4;
  const plat = new THREE.Mesh(
    new THREE.CylinderGeometry(platR, platR, 0.4, 24),
    stepMat,
  );
  plat.position.y = topY;
  plat.castShadow = false;
  plat.receiveShadow = true;
  g.add(plat);
  steps.push({
    x: 0, z: 0, y: topY + 0.2,
    halfW: platR, halfD: platR,
    cos: 1, sin: 0,
  });

  // base stones around the foot
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const r = baseRadius + 2.0 + Math.random() * 1.6;
    const sx = Math.cos(a) * r;
    const sz = Math.sin(a) * r;
    const stoneGeo = new THREE.BoxGeometry(
      1.2 + Math.random() * 1.4,
      0.7 + Math.random() * 0.5,
      1.2 + Math.random() * 1.4,
    );
    const stone = new THREE.Mesh(stoneGeo, stoneMat);
    stone.position.set(sx, 0.1, sz);
    stone.rotation.y = Math.random() * Math.PI;
    stone.castShadow = true;
    stone.receiveShadow = true;
    g.add(stone);
  }

  // ---- 3 puzzle plates around the base ----
  // Spaced 120° apart. The first one faces the player's approach
  // direction (+z toward spawn) so it's discoverable; the other
  // two require walking around the tower.
  const plates = [];
  const plateBaseAngle = Math.PI / 2; // +z direction
  for (let i = 0; i < 3; i++) {
    const ang = plateBaseAngle + i * (Math.PI * 2 / 3);
    const r = baseRadius + 4.5;
    const px = Math.cos(ang) * r;
    const pz = Math.sin(ang) * r;

    const plateGroup = new THREE.Group();
    plateGroup.position.set(px, 0, pz);
    plateGroup.rotation.y = -ang + Math.PI / 2; // glyph faces outward

    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(1.05, 1.2, 0.45, 18),
      new THREE.MeshStandardMaterial({ color: 0x6e4e2c, roughness: 0.95 }),
    );
    pedestal.position.y = 0.22;
    pedestal.castShadow = true;
    pedestal.receiveShadow = true;
    plateGroup.add(pedestal);

    // glyph disc on top
    const glyphMat = new THREE.MeshBasicMaterial({
      color: 0x2a4a4e,
      transparent: true,
      opacity: 0.92,
    });
    const glyph = new THREE.Mesh(new THREE.CircleGeometry(0.7, 28), glyphMat);
    glyph.rotation.x = -Math.PI / 2;
    glyph.position.y = 0.451;
    plateGroup.add(glyph);

    // small inscribed cross on the glyph (purely decorative)
    const crossMat = new THREE.MeshBasicMaterial({
      color: 0x1a2a2e,
      transparent: true,
      opacity: 0.6,
    });
    const cBar1 = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.06), crossMat);
    cBar1.rotation.x = -Math.PI / 2;
    cBar1.position.y = 0.452;
    plateGroup.add(cBar1);
    const cBar2 = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.9), crossMat);
    cBar2.rotation.x = -Math.PI / 2;
    cBar2.position.y = 0.452;
    plateGroup.add(cBar2);

    // dim point light, brightens when activated
    const light = new THREE.PointLight(0xa0e4ec, 0, 9, 2);
    light.position.y = 1.2;
    plateGroup.add(light);

    g.add(plateGroup);

    plates.push({
      x: px, z: pz,
      group: plateGroup,
      glyphMat,
      light,
      lit: false,
      activatedAt: 0,
    });
  }

  // ---- unlock: reveal the puzzle stair section + push colliders ----
  let upperStairsUnlocked = false;
  function unlockUpperStairs(stairColliders, towerPos) {
    if (upperStairsUnlocked) return;
    upperStairsUnlocked = true;

    for (const info of stepInfo) {
      if (!info.isPuzzle) continue;
      _stepP.set(info.x, info.y, info.z);
      _stepQ.setFromAxisAngle(Y_AXIS, info.yawY);
      _stepMat.compose(_stepP, _stepQ, _stepS);
      stepMesh.setMatrixAt(info.instanceIdx, _stepMat);

      if (info.stripIdx >= 0) {
        const ang = info.srcIdx * STEP_ANGLE_PER;
        const sx = info.x + Math.cos(ang) * 0.65;
        const sz = info.z + Math.sin(ang) * 0.65;
        _stepP.set(sx, info.y + 0.16, sz);
        _stepMat.compose(_stepP, _stepQ, _stepS);
        stripMesh.setMatrixAt(info.stripIdx, _stepMat);
      }

      stairColliders.push({
        x: towerPos.x + info.x,
        z: towerPos.z + info.z,
        y: info.y + 0.14,
        halfW: 1.1, halfD: 0.78,
        cos: Math.cos(info.yawY),
        sin: Math.sin(info.yawY),
      });
    }
    stepMesh.instanceMatrix.needsUpdate = true;
    stripMesh.instanceMatrix.needsUpdate = true;
  }

  return {
    group: g,
    steps,
    baseRadius,
    totalHeight,
    accentMeshes,
    spire,
    spireMat,
    core,
    glow,
    radiusAt: towerHalfWidthAt,
    plates,
    unlockUpperStairs,
    isUnlocked: () => upperStairsUnlocked,
    puzzleGapY: PUZZLE_GAP_START * STEP_RISE + 0.5,
  };
}

/* -----------------------------------------------------------
 * Spawn lamp: a tall hooked pole with a hanging warm orb,
 * placed near the player's spawn. Approach to read lore.
 * --------------------------------------------------------- */
function buildLamp() {
  const g = new THREE.Group();

  const stoneMat = new THREE.MeshStandardMaterial({
    color: 0x6e4a30,
    roughness: 0.9,
    metalness: 0.05,
  });

  // base
  const baseGeo = new THREE.CylinderGeometry(0.18, 0.24, 0.3, 8);
  const base = new THREE.Mesh(baseGeo, stoneMat);
  base.position.y = 0.15;
  base.castShadow = true;
  base.receiveShadow = true;
  g.add(base);

  // pole
  const poleGeo = new THREE.CylinderGeometry(0.04, 0.05, 2.2, 6);
  const pole = new THREE.Mesh(poleGeo, stoneMat);
  pole.position.y = 1.4;
  pole.castShadow = true;
  g.add(pole);

  // hook (a quarter torus)
  const hookGeo = new THREE.TorusGeometry(0.22, 0.025, 6, 12, Math.PI * 0.6);
  const hook = new THREE.Mesh(hookGeo, stoneMat);
  hook.rotation.z = Math.PI;
  hook.position.set(0.22, 2.5, 0);
  hook.castShadow = true;
  g.add(hook);

  // chain (small group of slim cylinders)
  for (let i = 0; i < 3; i++) {
    const cgeo = new THREE.TorusGeometry(0.04, 0.008, 5, 8);
    const c = new THREE.Mesh(cgeo, stoneMat);
    c.position.set(0.42, 2.42 - i * 0.07, 0);
    c.rotation.x = (i % 2) * Math.PI / 2;
    g.add(c);
  }

  // glass body of the lantern
  const glassGeo = new THREE.OctahedronGeometry(0.16, 0);
  glassGeo.scale(1, 1.4, 1);
  const glassMat = new THREE.MeshBasicMaterial({
    color: 0xffe4b8,
    transparent: true,
    opacity: 0.85,
  });
  const glass = new THREE.Mesh(glassGeo, glassMat);
  glass.position.set(0.42, 2.05, 0);
  g.add(glass);

  // hot core
  const coreGeo = new THREE.SphereGeometry(0.05, 8, 6);
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xfff1c4 });
  const core = new THREE.Mesh(coreGeo, coreMat);
  core.position.copy(glass.position);
  g.add(core);

  // warm point light
  const light = new THREE.PointLight(0xffd9a0, 1.6, 12, 1.6);
  light.position.copy(glass.position);
  g.add(light);

  g.userData.glass = glass;
  g.userData.glassMat = glassMat;
  g.userData.core = core;
  g.userData.light = light;

  return g;
}

/* -----------------------------------------------------------
 * Ruins: ancient pillars with engraved bands and inset glyphs.
 *
 *   Each cluster gets its own MeshStandardMaterial so the
 *   resonance system can drive emissive intensity per cluster.
 *   Engraving meshes use a separate material so they can light
 *   up independently of the stone.
 * --------------------------------------------------------- */
function buildRuins() {
  const g = new THREE.Group();
  const rng = mulberry32(13371);
  const clusters = [];

  // distribute along the corridor from spawn toward the tower, plus
  // a handful scattered laterally near the path so the player keeps
  // discovering new ones as they travel.
  const startZ = SPAWN_POSITION.z + 25;   // a few meters in front of spawn
  const endZ = TOWER_POSITION.z + 25;     // stop short of the tower plaza
  const total = 28;

  for (let i = 0; i < total; i++) {
    const t = i / (total - 1);
    const z = THREE.MathUtils.lerp(startZ, endZ, t) + (rng() - 0.5) * 28;
    const sideRange = THREE.MathUtils.lerp(60, 26, t);
    const x = (rng() - 0.5) * sideRange * 2;

    // pick a variant — bias toward standing pillar, but mix in others
    const r = rng();
    let variant;
    if (r < 0.30) variant = "pillar";
    else if (r < 0.45) variant = "fallen";
    else if (r < 0.58) variant = "obelisk";
    else if (r < 0.70) variant = "arch";
    else if (r < 0.78) variant = "altar";
    else if (r < 0.88) variant = "gateway";
    else if (r < 0.95) variant = "statue";
    else variant = "ziggurat";

    const cluster = buildRuinCluster(rng, variant);
    cluster.position.set(x, getTerrainHeight(x, z) - 0.2, z);
    cluster.rotation.y = rng() * Math.PI * 2;
    g.add(cluster);
    clusters.push(cluster);
  }

  g.userData.clusters = clusters;
  return g;
}

function buildRuinCluster(rng, variant = "pillar") {
  const c = new THREE.Group();
  // unique stone material per cluster so emissive can be driven per ruin
  const mat = new THREE.MeshStandardMaterial({
    color: 0xc7976a,
    roughness: 0.92,
    metalness: 0.0,
    emissive: 0x000000,
    emissiveIntensity: 0.0,
  });
  c.userData.stoneMaterial = mat;

  // engraving material — additive blending so the glyphs read as
  // light, not paint. They glow on top of the stone when activated.
  const engMat = new THREE.MeshBasicMaterial({
    color: 0x9ee8ff,
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    fog: true,
  });
  c.userData.engravingMaterial = engMat;
  c.userData.engravings = [];
  const engGroup = new THREE.Group();
  engGroup.visible = false;
  c.add(engGroup);
  c.userData.engravingGroup = engGroup;

  // dispatch to the variant builder; each one populates the cluster
  // and reports back the height used for the particle stream origin.
  let pillarTopY = 4.0;
  switch (variant) {
    case "fallen":   pillarTopY = buildFallenPillar(c, mat, engMat, engGroup, rng); break;
    case "obelisk":  pillarTopY = buildObelisk(c, mat, engMat, engGroup, rng); break;
    case "arch":     pillarTopY = buildStoneArch(c, mat, engMat, engGroup, rng); break;
    case "altar":    pillarTopY = buildAltar(c, mat, engMat, engGroup, rng); break;
    case "gateway":  pillarTopY = buildGateway(c, mat, engMat, engGroup, rng); break;
    case "statue":   pillarTopY = buildStatue(c, mat, engMat, engGroup, rng); break;
    case "ziggurat": pillarTopY = buildZiggurat(c, mat, engMat, engGroup, rng); break;
    default:         pillarTopY = buildStandingPillar(c, mat, engMat, engGroup, rng); break;
  }

  // ---- half-buried stones nearby (shared across all variants) ----
  const stoneCount = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < stoneCount; i++) {
    const sx = (rng() - 0.5) * 6;
    const sz = (rng() - 0.5) * 6;
    const sGeo = new THREE.BoxGeometry(
      0.7 + rng() * 1.0,
      0.4 + rng() * 0.4,
      0.7 + rng() * 1.0,
    );
    const s = new THREE.Mesh(sGeo, mat);
    s.position.set(sx, 0.15, sz);
    s.rotation.y = rng() * Math.PI;
    s.castShadow = true;
    s.receiveShadow = true;
    c.add(s);
  }

  c.userData.pillarTopY = pillarTopY;
  return c;
}

/* Standing broken pillar with engraved bands AND a vertical
 * cartouche of stacked hieroglyph-like glyphs running down the
 * front face. */
function buildStandingPillar(c, mat, engMat, engGroup, rng) {
  const h = 4.5 + rng() * 4.5;
  const w = 1.0 + rng() * 0.35;
  const segs = 8;
  const pillarGeo = new THREE.CylinderGeometry(w * 0.86, w, h, segs, 6, false);

  const pa = pillarGeo.attributes.position;
  for (let i = 0; i < pa.count; i++) {
    const y = pa.getY(i);
    const yt = (y + h * 0.5) / h;
    if (yt > 0.78) {
      const cut = rng();
      pa.setY(i, pa.getY(i) - cut * (h * 0.18));
      pa.setX(i, pa.getX(i) + (rng() - 0.5) * 0.1);
      pa.setZ(i, pa.getZ(i) + (rng() - 0.5) * 0.1);
    }
    const x = pa.getX(i);
    const z = pa.getZ(i);
    const r = Math.hypot(x, z) || 1e-5;
    const ang = Math.atan2(z, x);
    const flute = Math.cos(ang * segs) * 0.04;
    const newR = r * (1.0 + flute * 0.06);
    pa.setX(i, Math.cos(ang) * newR);
    pa.setZ(i, Math.sin(ang) * newR);
  }
  pa.needsUpdate = true;
  pillarGeo.computeVertexNormals();

  const pillar = new THREE.Mesh(pillarGeo, mat);
  pillar.position.y = h * 0.4;
  pillar.castShadow = true;
  pillar.receiveShadow = true;
  c.add(pillar);

  // ---- chamfered base (square plinth + bevel block) ----
  const baseW = w * 1.55;
  const plinth = new THREE.Mesh(
    new THREE.BoxGeometry(baseW * 1.15, 0.32, baseW * 1.15),
    mat,
  );
  plinth.position.y = 0.16;
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  c.add(plinth);
  const bevel = new THREE.Mesh(
    new THREE.CylinderGeometry(w * 1.18, baseW * 0.62, 0.34, 12),
    mat,
  );
  bevel.position.y = 0.32 + 0.17;
  bevel.castShadow = true;
  bevel.receiveShadow = true;
  c.add(bevel);

  // ---- capital on top (squared abacus + flared echinus) ----
  const echinus = new THREE.Mesh(
    new THREE.CylinderGeometry(w * 1.25, w * 0.92, 0.28, 12),
    mat,
  );
  echinus.position.y = pillar.position.y + h * 0.5 - 0.2;
  echinus.castShadow = true;
  echinus.receiveShadow = true;
  c.add(echinus);
  const abacus = new THREE.Mesh(
    new THREE.BoxGeometry(w * 2.4, 0.22, w * 2.4),
    mat,
  );
  abacus.position.y = echinus.position.y + 0.25;
  abacus.castShadow = true;
  abacus.receiveShadow = true;
  c.add(abacus);

  // ---- horizontal engraved bands ----
  const bandCount = 2 + Math.floor(rng() * 2);
  for (let b = 0; b < bandCount; b++) {
    const yt = 0.25 + b * 0.22 + rng() * 0.05;
    const bandY = pillar.position.y + (yt - 0.5) * h;

    const glyphCount = 6 + Math.floor(rng() * 3);
    for (let i = 0; i < glyphCount; i++) {
      const a = (i / glyphCount) * Math.PI * 2 + rng() * 0.08;
      const gw = 0.16 + rng() * 0.1;
      const gh = 0.30 + rng() * 0.16;
      const glyphGeo = makeGlyphGeometry(gw, gh, rng);
      const glyph = new THREE.Mesh(glyphGeo, engMat);
      const r = w * 1.02;
      glyph.position.set(Math.cos(a) * r, bandY, Math.sin(a) * r);
      glyph.lookAt(0, bandY, 0);
      engGroup.add(glyph);
      c.userData.engravings.push(glyph);
    }
    for (const dy of [-0.18, 0.18]) {
      const ringGeo = new THREE.TorusGeometry(w * 1.02, 0.012, 4, 24);
      const ring = new THREE.Mesh(ringGeo, engMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = bandY + dy;
      engGroup.add(ring);
      c.userData.engravings.push(ring);
    }
  }

  // ---- vertical cartouche on the "front" face ----
  // a column of stacked glyphs, framed by two vertical engraved lines,
  // making the pillar read as a hieroglyphic stele.
  addCartouche(engGroup, c, engMat, w, h, pillar.position.y, rng);

  return pillar.position.y + h * 0.5;
}

/* A fallen pillar lying on its side, optionally broken into a couple
 * of segments. Glyphs run along the upper visible surface. */
function buildFallenPillar(c, mat, engMat, engGroup, rng) {
  const totalLen = 5.0 + rng() * 3.0;
  const w = 0.85 + rng() * 0.25;
  // 2-3 broken segments laid end-to-end with small gaps and rotations
  const segs = 2 + Math.floor(rng() * 2);
  const orientation = rng() * Math.PI * 2;
  const cosO = Math.cos(orientation);
  const sinO = Math.sin(orientation);

  let cursor = -totalLen * 0.5;
  let topY = 0;
  for (let i = 0; i < segs; i++) {
    const segLen = (totalLen / segs) * (0.85 + rng() * 0.3);
    const segGeo = new THREE.CylinderGeometry(w * 0.92, w, segLen, 8, 2, false);
    // jaggy ends
    const sa = segGeo.attributes.position;
    for (let j = 0; j < sa.count; j++) {
      const y = sa.getY(j);
      const yt = Math.abs(y) / (segLen * 0.5);
      if (yt > 0.85) {
        sa.setY(j, sa.getY(j) + (rng() - 0.5) * 0.15);
        sa.setX(j, sa.getX(j) + (rng() - 0.5) * 0.08);
        sa.setZ(j, sa.getZ(j) + (rng() - 0.5) * 0.08);
      }
    }
    sa.needsUpdate = true;
    segGeo.computeVertexNormals();

    const seg = new THREE.Mesh(segGeo, mat);
    seg.castShadow = true;
    seg.receiveShadow = true;
    // lay on its side: rotate so the cylinder axis points along x
    seg.rotation.z = Math.PI / 2;
    seg.rotation.y = (rng() - 0.5) * 0.12; // slight twist
    // place along the orientation line, half-buried
    const cx = (cursor + segLen * 0.5);
    const wx = cosO * cx;
    const wz = sinO * cx;
    seg.position.set(wx, w * 0.7, wz);
    // rotate the whole seg around Y so it follows the orientation line
    // (we rotated around z first, so chain a y-rotation by re-parenting).
    const wrap = new THREE.Group();
    wrap.position.set(wx, w * 0.7, wz);
    wrap.rotation.y = orientation;
    seg.position.set(0, 0, 0);
    wrap.add(seg);
    c.add(wrap);

    // glyphs on the top side of the segment (local +y after rotation
    // -> world +y of the segment cylinder; we put plates skimming the
    // top in the wrap's local frame).
    const glyphCount = 3 + Math.floor(rng() * 3);
    for (let j = 0; j < glyphCount; j++) {
      const u = (j + 0.5) / glyphCount;
      const localX = (u - 0.5) * segLen * 0.85;
      const gw = 0.18 + rng() * 0.08;
      const gh = 0.28 + rng() * 0.14;
      const glyphGeo = makeGlyphGeometry(gw, gh, rng);
      const glyph = new THREE.Mesh(glyphGeo, engMat);
      // sit just above the cylinder's top surface in wrap-local space.
      // wrap is rotated around y by orientation; we want a plate facing up.
      glyph.rotation.x = -Math.PI / 2;
      glyph.position.set(localX, w + 0.01, 0);
      // rotate plate within its plane so glyphs aren't all aligned
      glyph.rotation.z = (rng() - 0.5) * 0.4;
      // attach to a child of wrap so engravings still belong to engGroup
      // (so visibility toggle works). Convert wrap-local -> cluster-local.
      const m = new THREE.Matrix4().makeRotationY(orientation);
      const pos = new THREE.Vector3(localX, w + 0.01, 0).applyMatrix4(m).add(new THREE.Vector3(wx, w * 0.7, wz));
      glyph.position.copy(pos);
      // orient: face up, then rotate around Y by orientation
      glyph.rotation.set(-Math.PI / 2, 0, orientation + (rng() - 0.5) * 0.4);
      engGroup.add(glyph);
      c.userData.engravings.push(glyph);
    }

    cursor += segLen + 0.18 + rng() * 0.18;
    topY = Math.max(topY, w * 1.6);
  }

  return topY;
}

/* A tapered four-sided obelisk with a column of glyphs running down
 * each face. Reads as a clear hieroglyphic monument. */
function buildObelisk(c, mat, engMat, engGroup, rng) {
  const h = 5.5 + rng() * 4.0;
  const wBase = 0.7 + rng() * 0.25;
  const wTop = wBase * 0.45;
  // four-sided tapered prism
  const obGeo = new THREE.CylinderGeometry(wTop, wBase, h, 4, 1, false);
  const obelisk = new THREE.Mesh(obGeo, mat);
  obelisk.position.y = h * 0.5;
  obelisk.castShadow = true;
  obelisk.receiveShadow = true;
  obelisk.rotation.y = Math.PI / 4; // diamond cross-section, faces forward
  c.add(obelisk);

  // pyramid cap
  const capGeo = new THREE.ConeGeometry(wTop * 1.12, wTop * 1.4, 4);
  const cap = new THREE.Mesh(capGeo, mat);
  cap.position.y = h + wTop * 0.7;
  cap.rotation.y = Math.PI / 4;
  cap.castShadow = true;
  c.add(cap);

  // glyph columns on each of the 4 faces
  const faceAngles = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
  for (const baseAng of faceAngles) {
    const ang = baseAng + obelisk.rotation.y;
    // face center radius mid-height — interpolate face width with height
    const colCount = 4 + Math.floor(rng() * 2);
    for (let i = 0; i < colCount; i++) {
      const yt = 0.18 + i * (0.6 / colCount);
      const localY = yt * h;
      // width of face at this height (linear taper)
      const faceW = THREE.MathUtils.lerp(wBase, wTop, yt) * 1.0;
      const gw = faceW * 0.5;
      const gh = (h * 0.6) / colCount * 0.7;
      const glyphGeo = makeGlyphGeometry(gw, gh, rng);
      const glyph = new THREE.Mesh(glyphGeo, engMat);
      const r = THREE.MathUtils.lerp(wBase, wTop, yt) * 1.02;
      glyph.position.set(Math.cos(ang) * r, localY, Math.sin(ang) * r);
      glyph.lookAt(0, localY, 0);
      engGroup.add(glyph);
      c.userData.engravings.push(glyph);
    }
  }

  return h + wTop * 1.2;
}

/* Two short pillars supporting a horizontal lintel — a stone arch.
 * Glyphs live on the keystone face. */
function buildStoneArch(c, mat, engMat, engGroup, rng) {
  const h = 3.2 + rng() * 1.6;
  const w = 0.55 + rng() * 0.2;
  const span = 2.4 + rng() * 1.0;

  for (const sx of [-span * 0.5, span * 0.5]) {
    const legGeo = new THREE.CylinderGeometry(w * 0.9, w, h, 6, 2, false);
    const leg = new THREE.Mesh(legGeo, mat);
    leg.position.set(sx, h * 0.5, 0);
    leg.castShadow = true;
    leg.receiveShadow = true;
    c.add(leg);
  }

  const lintelGeo = new THREE.BoxGeometry(span + w * 1.6, w * 1.2, w * 1.4);
  const lintel = new THREE.Mesh(lintelGeo, mat);
  lintel.position.set(0, h + w * 0.6, 0);
  lintel.castShadow = true;
  lintel.receiveShadow = true;
  c.add(lintel);

  // a row of glyphs across the front of the lintel
  const glyphCount = 4 + Math.floor(rng() * 3);
  const rowW = (span + w * 1.0);
  for (let i = 0; i < glyphCount; i++) {
    const u = (i + 0.5) / glyphCount;
    const gx = (u - 0.5) * rowW;
    const gw = 0.22 + rng() * 0.08;
    const gh = w * 0.85;
    const glyphGeo = makeGlyphGeometry(gw, gh, rng);
    const glyph = new THREE.Mesh(glyphGeo, engMat);
    glyph.position.set(gx, h + w * 0.6, w * 0.71);
    engGroup.add(glyph);
    c.userData.engravings.push(glyph);
  }
  // and a single, larger keystone glyph on top
  const kgGeo = makeGlyphGeometry(w * 0.7, w * 0.7, rng);
  const kg = new THREE.Mesh(kgGeo, engMat);
  kg.rotation.x = -Math.PI / 2;
  kg.position.set(0, h + w * 1.21, 0);
  engGroup.add(kg);
  c.userData.engravings.push(kg);

  return h + w * 1.5;
}

/* A stepped square altar / dais with an inscribed top face. */
function buildAltar(c, mat, engMat, engGroup, rng) {
  const tiers = 3;
  let y = 0;
  let w = 2.2 + rng() * 0.6;
  const tierH = 0.45;
  for (let i = 0; i < tiers; i++) {
    const tierGeo = new THREE.BoxGeometry(w, tierH, w);
    const tier = new THREE.Mesh(tierGeo, mat);
    tier.position.set(0, y + tierH * 0.5, 0);
    tier.castShadow = true;
    tier.receiveShadow = true;
    c.add(tier);
    y += tierH;
    w *= 0.78;
  }
  // top face inscribed with a circular ring of glyphs around a center sigil
  const topY = y + 0.005;
  const ringR = w * 0.55;
  const glyphCount = 8;
  for (let i = 0; i < glyphCount; i++) {
    const a = (i / glyphCount) * Math.PI * 2;
    const gw = 0.20;
    const gh = 0.28;
    const glyphGeo = makeGlyphGeometry(gw, gh, rng);
    const glyph = new THREE.Mesh(glyphGeo, engMat);
    glyph.rotation.x = -Math.PI / 2;
    glyph.rotation.z = -a;
    glyph.position.set(Math.cos(a) * ringR, topY, Math.sin(a) * ringR);
    engGroup.add(glyph);
    c.userData.engravings.push(glyph);
  }
  // central sigil
  const sigilGeo = makeGlyphGeometry(w * 0.4, w * 0.4, rng);
  const sigil = new THREE.Mesh(sigilGeo, engMat);
  sigil.rotation.x = -Math.PI / 2;
  sigil.position.set(0, topY, 0);
  engGroup.add(sigil);
  c.userData.engravings.push(sigil);
  // a thin circumscribing ring engraving
  const ringGeo = new THREE.TorusGeometry(ringR + 0.18, 0.018, 4, 32);
  const ring = new THREE.Mesh(ringGeo, engMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.set(0, topY, 0);
  engGroup.add(ring);
  c.userData.engravings.push(ring);

  return y + 0.4;
}

/* Temple gateway: two trapezoidal pylons flanking a central recessed
 * portal, joined by a heavy lintel with a winged sun-disc inset. The
 * silhouette reads as a serious piece of architecture from far away. */
function buildGateway(c, mat, engMat, engGroup, rng) {
  const h = 7.5 + rng() * 2.5;
  const pylonW = 1.6 + rng() * 0.4;
  const pylonD = 1.0 + rng() * 0.2;
  const span = 2.4 + rng() * 0.7;
  const taper = 0.78;

  // pylons: tapered trapezoidal towers using a 4-sided cylinder
  for (const sx of [-1, 1]) {
    const px = sx * (span * 0.5 + pylonW * 0.5);
    const pylonGeo = new THREE.CylinderGeometry(
      pylonW * taper * 0.5,
      pylonW * 0.5,
      h,
      4, 1, false,
    );
    // squash to make a non-square tower (deeper than wide)
    pylonGeo.scale(1.0, 1.0, pylonD / pylonW * 1.4);
    const pylon = new THREE.Mesh(pylonGeo, mat);
    pylon.rotation.y = Math.PI / 4;
    pylon.position.set(px, h * 0.5, 0);
    pylon.castShadow = true;
    pylon.receiveShadow = true;
    c.add(pylon);

    // capping cornice on top of the pylon
    const cornice = new THREE.Mesh(
      new THREE.BoxGeometry(pylonW * taper * 1.05, 0.32, pylonD * 1.4),
      mat,
    );
    cornice.position.set(px, h + 0.16, 0);
    cornice.castShadow = true;
    cornice.receiveShadow = true;
    c.add(cornice);

    // recessed engraved panel on the front face of each pylon
    const panelW = pylonW * taper * 0.65;
    const panelH = h * 0.55;
    const panelGeo = new THREE.PlaneGeometry(panelW, panelH);
    const panel = new THREE.Mesh(panelGeo, engMat);
    // place panel against the front (+z) face of the pylon
    const panelZ = pylonD * 0.71;
    panel.position.set(px, h * 0.45, panelZ);
    engGroup.add(panel);
    c.userData.engravings.push(panel);

    // a column of glyphs centered on the panel
    const colCount = 4;
    for (let i = 0; i < colCount; i++) {
      const u = (i + 0.5) / colCount;
      const gy = h * 0.45 + (u - 0.5) * panelH * 0.85;
      const gw = panelW * 0.55;
      const gh = panelH / colCount * 0.78;
      const glyphGeo = makeGlyphGeometry(gw, gh, rng);
      const glyph = new THREE.Mesh(glyphGeo, engMat);
      glyph.position.set(px, gy, panelZ + 0.005);
      engGroup.add(glyph);
      c.userData.engravings.push(glyph);
    }
  }

  // lintel spanning the two pylons
  const lintelW = span + pylonW * 1.6;
  const lintelH = 1.1;
  const lintel = new THREE.Mesh(
    new THREE.BoxGeometry(lintelW, lintelH, pylonD * 1.5),
    mat,
  );
  lintel.position.set(0, h - lintelH * 0.5, 0);
  lintel.castShadow = true;
  lintel.receiveShadow = true;
  c.add(lintel);

  // crown above the lintel — chunky cornice with a stepped top
  const crown = new THREE.Mesh(
    new THREE.BoxGeometry(lintelW * 1.04, 0.36, pylonD * 1.6),
    mat,
  );
  crown.position.set(0, h + 0.18, 0);
  crown.castShadow = true;
  crown.receiveShadow = true;
  c.add(crown);

  // winged-disc keystone on the lintel front
  const discR = lintelH * 0.42;
  const discGeo = new THREE.CircleGeometry(discR, 18);
  const disc = new THREE.Mesh(discGeo, engMat);
  disc.position.set(0, h - lintelH * 0.45, pylonD * 0.76);
  engGroup.add(disc);
  c.userData.engravings.push(disc);
  // wings: two flattened triangles flanking the disc
  for (const sx of [-1, 1]) {
    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, 0);
    wingShape.lineTo(sx * lintelW * 0.32, lintelH * 0.18);
    wingShape.lineTo(sx * lintelW * 0.30, -lintelH * 0.06);
    wingShape.lineTo(sx * lintelW * 0.18, -lintelH * 0.16);
    wingShape.closePath();
    const wingGeo = new THREE.ShapeGeometry(wingShape, 4);
    const wing = new THREE.Mesh(wingGeo, engMat);
    wing.position.set(0, h - lintelH * 0.45, pylonD * 0.76 + 0.001);
    engGroup.add(wing);
    c.userData.engravings.push(wing);
  }

  // a row of glyphs across the lintel front, beneath the disc
  const lglyphCount = 5;
  for (let i = 0; i < lglyphCount; i++) {
    const u = (i + 0.5) / lglyphCount;
    const gx = (u - 0.5) * lintelW * 0.78;
    const gw = 0.28;
    const gh = lintelH * 0.34;
    const glyphGeo = makeGlyphGeometry(gw, gh, rng);
    const glyph = new THREE.Mesh(glyphGeo, engMat);
    glyph.position.set(gx, h - lintelH * 0.85, pylonD * 0.76);
    engGroup.add(glyph);
    c.userData.engravings.push(glyph);
  }

  // a heavy threshold step at ground between the pylons
  const threshGeo = new THREE.BoxGeometry(span * 0.95, 0.18, pylonD * 1.1);
  const thresh = new THREE.Mesh(threshGeo, mat);
  thresh.position.set(0, 0.09, 0);
  thresh.castShadow = true;
  thresh.receiveShadow = true;
  c.add(thresh);

  return h + 0.4;
}

/* A broken seated colossus on a tall inscribed pedestal. Headless,
 * weathered, with folded arms — silhouette reads as a ruined statue. */
function buildStatue(c, mat, engMat, engGroup, rng) {
  // ---- pedestal: stepped block ----
  const pedH = 1.6;
  const pedW = 2.1;
  const ped = new THREE.Mesh(new THREE.BoxGeometry(pedW, pedH, pedW), mat);
  ped.position.y = pedH * 0.5;
  ped.castShadow = true;
  ped.receiveShadow = true;
  c.add(ped);
  // upper plinth
  const plinth = new THREE.Mesh(
    new THREE.BoxGeometry(pedW * 0.9, 0.22, pedW * 0.9),
    mat,
  );
  plinth.position.y = pedH + 0.11;
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  c.add(plinth);
  // lower base
  const baseB = new THREE.Mesh(
    new THREE.BoxGeometry(pedW * 1.08, 0.25, pedW * 1.08),
    mat,
  );
  baseB.position.y = 0.125;
  baseB.castShadow = true;
  baseB.receiveShadow = true;
  c.add(baseB);

  // ---- pedestal engravings: a row of glyphs on each face ----
  const pedTop = pedH;
  const faceZs = [
    { x: 0, z: pedW * 0.5 + 0.001, ry: 0 },
    { x: 0, z: -pedW * 0.5 - 0.001, ry: Math.PI },
    { x: pedW * 0.5 + 0.001, z: 0, ry: -Math.PI / 2 },
    { x: -pedW * 0.5 - 0.001, z: 0, ry: Math.PI / 2 },
  ];
  for (const f of faceZs) {
    const count = 4;
    for (let i = 0; i < count; i++) {
      const u = (i + 0.5) / count;
      const gx = (u - 0.5) * pedW * 0.7;
      const gw = 0.26;
      const gh = pedH * 0.42;
      const glyphGeo = makeGlyphGeometry(gw, gh, rng);
      const glyph = new THREE.Mesh(glyphGeo, engMat);
      const cosY = Math.cos(f.ry), sinY = Math.sin(f.ry);
      glyph.position.set(
        f.x + cosY * gx,
        pedTop * 0.55,
        f.z + -sinY * gx,
      );
      glyph.rotation.y = f.ry;
      engGroup.add(glyph);
      c.userData.engravings.push(glyph);
    }
  }

  // ---- statue: blocky throne + seated figure (torso, legs, arms) ----
  const seatY = pedTop + 0.32;
  const throne = new THREE.Mesh(
    new THREE.BoxGeometry(pedW * 0.65, 0.32, pedW * 0.55),
    mat,
  );
  throne.position.set(0, pedTop + 0.16, 0);
  throne.castShadow = true;
  throne.receiveShadow = true;
  c.add(throne);
  // throne back
  const back = new THREE.Mesh(
    new THREE.BoxGeometry(pedW * 0.65, 1.4, 0.18),
    mat,
  );
  back.position.set(0, pedTop + 0.32 + 0.7, -pedW * 0.18);
  back.castShadow = true;
  back.receiveShadow = true;
  c.add(back);

  // legs (knees forward)
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.34, 0.78),
      mat,
    );
    leg.position.set(sx * 0.22, seatY + 0.17, 0.30);
    leg.castShadow = true;
    leg.receiveShadow = true;
    c.add(leg);
  }
  // torso (slightly tapered, headless top)
  const torso = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.46, 1.05, 6, 2, false),
    mat,
  );
  torso.position.set(0, seatY + 0.34 + 0.52, 0.02);
  torso.castShadow = true;
  torso.receiveShadow = true;
  c.add(torso);
  // shoulders / arms folded across chest
  const armBar = new THREE.Mesh(
    new THREE.BoxGeometry(0.92, 0.22, 0.28),
    mat,
  );
  armBar.position.set(0, seatY + 0.78, 0.30);
  armBar.rotation.x = -0.15;
  armBar.castShadow = true;
  armBar.receiveShadow = true;
  c.add(armBar);
  // a broken-off neck stub where the head should be
  const neck = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.20, 0.16, 8),
    mat,
  );
  neck.position.set(0, seatY + 1.05, 0.02);
  neck.rotation.z = (rng() - 0.5) * 0.18;
  neck.castShadow = true;
  c.add(neck);

  // ---- a fallen "head" on the ground beside the pedestal ----
  const headGeo = new THREE.IcosahedronGeometry(0.34, 0);
  // jagged distortion for weathered look
  const ha = headGeo.attributes.position;
  for (let i = 0; i < ha.count; i++) {
    ha.setX(i, ha.getX(i) + (rng() - 0.5) * 0.04);
    ha.setY(i, ha.getY(i) + (rng() - 0.5) * 0.04);
    ha.setZ(i, ha.getZ(i) + (rng() - 0.5) * 0.04);
  }
  ha.needsUpdate = true;
  headGeo.computeVertexNormals();
  const head = new THREE.Mesh(headGeo, mat);
  head.position.set(pedW * 0.6 + 0.4, 0.34, pedW * 0.4);
  head.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
  head.castShadow = true;
  head.receiveShadow = true;
  c.add(head);

  return seatY + 1.2;
}

/* A small stepped-pyramid (ziggurat) — four square tiers with an
 * inset glowing sigil on each face and a flat sanctum on top. */
function buildZiggurat(c, mat, engMat, engGroup, rng) {
  const tierCount = 4;
  let y = 0;
  let w = 4.2 + rng() * 0.6;
  const tierH = 0.85;
  for (let i = 0; i < tierCount; i++) {
    const tier = new THREE.Mesh(
      new THREE.BoxGeometry(w, tierH, w),
      mat,
    );
    tier.position.set(0, y + tierH * 0.5, 0);
    tier.castShadow = true;
    tier.receiveShadow = true;
    c.add(tier);

    // a recessed engraved panel on each of the 4 faces
    const panelW = w * 0.45;
    const panelH = tierH * 0.6;
    const faces = [
      { x: 0, z: w * 0.5 + 0.002, ry: 0 },
      { x: 0, z: -w * 0.5 - 0.002, ry: Math.PI },
      { x: w * 0.5 + 0.002, z: 0, ry: -Math.PI / 2 },
      { x: -w * 0.5 - 0.002, z: 0, ry: Math.PI / 2 },
    ];
    for (const f of faces) {
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(panelW, panelH), engMat);
      panel.position.set(f.x, y + tierH * 0.5, f.z);
      panel.rotation.y = f.ry;
      engGroup.add(panel);
      c.userData.engravings.push(panel);

      // a glyph centered on the panel
      const glyphGeo = makeGlyphGeometry(panelW * 0.6, panelH * 0.78, rng);
      const glyph = new THREE.Mesh(glyphGeo, engMat);
      glyph.position.set(f.x, y + tierH * 0.5, f.z);
      // nudge outward slightly so it doesn't z-fight the panel
      const nudge = 0.003;
      glyph.position.x += Math.sin(f.ry) * nudge;
      glyph.position.z += Math.cos(f.ry) * nudge;
      glyph.rotation.y = f.ry;
      engGroup.add(glyph);
      c.userData.engravings.push(glyph);
    }

    y += tierH;
    w *= 0.78;
  }

  // top sanctum: a small open shrine with 4 corner posts
  const topY = y;
  const postH = 1.0;
  const postW = 0.18;
  const postR = w * 0.35;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(postW, postH, postW),
      mat,
    );
    post.position.set(sx * postR, topY + postH * 0.5, sz * postR);
    post.castShadow = true;
    post.receiveShadow = true;
    c.add(post);
  }
  // tiny central flame-stone (engraved sphere)
  const flameGeo = new THREE.IcosahedronGeometry(0.18, 0);
  const flame = new THREE.Mesh(flameGeo, engMat);
  flame.position.set(0, topY + 0.22, 0);
  engGroup.add(flame);
  c.userData.engravings.push(flame);
  // capping slab on top of posts
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(w * 0.85, 0.15, w * 0.85),
    mat,
  );
  slab.position.set(0, topY + postH + 0.075, 0);
  slab.castShadow = true;
  slab.receiveShadow = true;
  c.add(slab);

  return topY + postH + 0.4;
}

/* Vertical cartouche: a column of 3-5 stacked glyphs framed by two
 * vertical engraved lines, on the +x face of a pillar in cluster
 * local space. The pillar's own random rotation around Y means the
 * cartouche faces a random direction per pillar. */
function addCartouche(engGroup, c, engMat, w, h, pillarCenterY, rng) {
  const panelTop = pillarCenterY + h * 0.32;
  const panelBot = pillarCenterY - h * 0.18;
  const panelH = panelTop - panelBot;
  const count = 3 + Math.floor(rng() * 3);
  const r = w * 1.022;
  for (let i = 0; i < count; i++) {
    const u = (i + 0.5) / count;
    const cy = panelBot + u * panelH;
    const gw = 0.32;
    const gh = (panelH / count) * 0.78;
    const glyphGeo = makeGlyphGeometry(gw, gh, rng);
    const glyph = new THREE.Mesh(glyphGeo, engMat);
    glyph.position.set(r, cy, 0);
    glyph.lookAt(0, cy, 0);
    engGroup.add(glyph);
    c.userData.engravings.push(glyph);
  }
  // vertical frame lines
  for (const sgn of [-1, 1]) {
    const lineGeo = new THREE.BoxGeometry(0.025, panelH + 0.18, 0.012);
    const line = new THREE.Mesh(lineGeo, engMat);
    line.position.set(r, (panelTop + panelBot) * 0.5, sgn * 0.22);
    line.lookAt(0, line.position.y, sgn * 0.22);
    engGroup.add(line);
    c.userData.engravings.push(line);
  }
}

/* a small procedural glyph plate: a card with a few inset shapes
 * (geometric / runic). We pre-build shape geometry rather than run-time
 * canvas textures so glyphs can light up via a shared material's
 * opacity. */
function makeGlyphGeometry(w, h, rng) {
  const variant = Math.floor(rng() * 9);
  const shapes = [];
  switch (variant) {
    case 0: {
      // arrow / spear: vertical slot with a triangle tip on top
      const s = new THREE.Shape();
      s.moveTo(-w * 0.18, -h * 0.45);
      s.lineTo(w * 0.18, -h * 0.45);
      s.lineTo(w * 0.18, h * 0.20);
      s.lineTo(w * 0.40, h * 0.20);
      s.lineTo(0, h * 0.5);
      s.lineTo(-w * 0.40, h * 0.20);
      s.lineTo(-w * 0.18, h * 0.20);
      s.closePath();
      shapes.push(s);
      break;
    }
    case 1: {
      // diamond / rhombus
      const s = new THREE.Shape();
      s.moveTo(0, -h * 0.5);
      s.lineTo(w * 0.45, 0);
      s.lineTo(0, h * 0.5);
      s.lineTo(-w * 0.45, 0);
      s.closePath();
      shapes.push(s);
      break;
    }
    case 2: {
      // double-cross rune — vertical bar with TWO horizontal nicks
      const s = new THREE.Shape();
      s.moveTo(-w * 0.13, -h * 0.5);
      s.lineTo(w * 0.13, -h * 0.5);
      s.lineTo(w * 0.13, -h * 0.18);
      s.lineTo(w * 0.42, -h * 0.18);
      s.lineTo(w * 0.42, -h * 0.06);
      s.lineTo(w * 0.13, -h * 0.06);
      s.lineTo(w * 0.13, h * 0.18);
      s.lineTo(w * 0.42, h * 0.18);
      s.lineTo(w * 0.42, h * 0.30);
      s.lineTo(w * 0.13, h * 0.30);
      s.lineTo(w * 0.13, h * 0.5);
      s.lineTo(-w * 0.13, h * 0.5);
      s.lineTo(-w * 0.13, h * 0.30);
      s.lineTo(-w * 0.42, h * 0.30);
      s.lineTo(-w * 0.42, h * 0.18);
      s.lineTo(-w * 0.13, h * 0.18);
      s.lineTo(-w * 0.13, -h * 0.06);
      s.lineTo(-w * 0.42, -h * 0.06);
      s.lineTo(-w * 0.42, -h * 0.18);
      s.lineTo(-w * 0.13, -h * 0.18);
      s.closePath();
      shapes.push(s);
      break;
    }
    case 3: {
      // sun-disc with rays — center disc + 8 spike triangles
      const cx = 0, cy = 0;
      const rOuter = Math.min(w, h) * 0.42;
      const rInner = rOuter * 0.55;
      const segs = 24;
      const disc = new THREE.Shape();
      disc.moveTo(cx + rInner, cy);
      for (let i = 1; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        disc.lineTo(cx + Math.cos(a) * rInner, cy + Math.sin(a) * rInner);
      }
      disc.closePath();
      shapes.push(disc);
      const rays = 8;
      for (let i = 0; i < rays; i++) {
        const a = (i / rays) * Math.PI * 2;
        const ax = Math.cos(a), ay = Math.sin(a);
        const px = -ay, py = ax;
        const ray = new THREE.Shape();
        ray.moveTo(cx + ax * rInner * 0.95 + px * rInner * 0.18, cy + ay * rInner * 0.95 + py * rInner * 0.18);
        ray.lineTo(cx + ax * rOuter, cy + ay * rOuter);
        ray.lineTo(cx + ax * rInner * 0.95 - px * rInner * 0.18, cy + ay * rInner * 0.95 - py * rInner * 0.18);
        ray.closePath();
        shapes.push(ray);
      }
      break;
    }
    case 4: {
      // wave / zigzag — 3 chevron stripes
      for (let k = -1; k <= 1; k++) {
        const yC = k * h * 0.28;
        const s = new THREE.Shape();
        s.moveTo(-w * 0.45, yC + h * 0.04);
        s.lineTo(-w * 0.18, yC + h * 0.10);
        s.lineTo(0, yC + h * 0.04);
        s.lineTo(w * 0.18, yC + h * 0.10);
        s.lineTo(w * 0.45, yC + h * 0.04);
        s.lineTo(w * 0.45, yC - h * 0.04);
        s.lineTo(w * 0.18, yC + h * 0.02);
        s.lineTo(0, yC - h * 0.04);
        s.lineTo(-w * 0.18, yC + h * 0.02);
        s.lineTo(-w * 0.45, yC - h * 0.04);
        s.closePath();
        shapes.push(s);
      }
      break;
    }
    case 5: {
      // ladder — vertical posts + 4 rungs (single stroked outline)
      const post = (sx) => {
        const s = new THREE.Shape();
        s.moveTo(sx - w * 0.04, -h * 0.5);
        s.lineTo(sx + w * 0.04, -h * 0.5);
        s.lineTo(sx + w * 0.04, h * 0.5);
        s.lineTo(sx - w * 0.04, h * 0.5);
        s.closePath();
        return s;
      };
      shapes.push(post(-w * 0.32));
      shapes.push(post(w * 0.32));
      for (let i = 0; i < 4; i++) {
        const yR = -h * 0.36 + i * (h * 0.24);
        const r = new THREE.Shape();
        r.moveTo(-w * 0.32, yR - h * 0.025);
        r.lineTo(w * 0.32, yR - h * 0.025);
        r.lineTo(w * 0.32, yR + h * 0.025);
        r.lineTo(-w * 0.32, yR + h * 0.025);
        r.closePath();
        shapes.push(r);
      }
      break;
    }
    case 6: {
      // ankh-like: vertical bar with a loop on top + crossbar
      // (the loop is approximated by a fat short bar and small rect inside)
      const bar = new THREE.Shape();
      bar.moveTo(-w * 0.08, -h * 0.5);
      bar.lineTo(w * 0.08, -h * 0.5);
      bar.lineTo(w * 0.08, h * 0.05);
      bar.lineTo(-w * 0.08, h * 0.05);
      bar.closePath();
      shapes.push(bar);
      const cross = new THREE.Shape();
      cross.moveTo(-w * 0.42, -h * 0.05);
      cross.lineTo(w * 0.42, -h * 0.05);
      cross.lineTo(w * 0.42, h * 0.04);
      cross.lineTo(-w * 0.42, h * 0.04);
      cross.closePath();
      shapes.push(cross);
      // loop (filled disc)
      const loop = new THREE.Shape();
      const cy = h * 0.30;
      const rr = h * 0.18;
      const segs = 18;
      loop.moveTo(rr, cy);
      for (let i = 1; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        loop.lineTo(Math.cos(a) * rr, cy + Math.sin(a) * rr);
      }
      loop.closePath();
      shapes.push(loop);
      break;
    }
    case 7: {
      // eye — almond outline with a pupil disc
      const almond = new THREE.Shape();
      const segs = 18;
      almond.moveTo(-w * 0.5, 0);
      for (let i = 1; i <= segs; i++) {
        const t = i / segs;
        const x = THREE.MathUtils.lerp(-w * 0.5, w * 0.5, t);
        const y = Math.sin(t * Math.PI) * h * 0.32;
        almond.lineTo(x, y);
      }
      for (let i = 1; i <= segs; i++) {
        const t = i / segs;
        const x = THREE.MathUtils.lerp(w * 0.5, -w * 0.5, t);
        const y = -Math.sin(t * Math.PI) * h * 0.32;
        almond.lineTo(x, y);
      }
      almond.closePath();
      shapes.push(almond);
      const pupil = new THREE.Shape();
      const pr = Math.min(w, h) * 0.14;
      pupil.moveTo(pr, 0);
      for (let i = 1; i <= 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        pupil.lineTo(Math.cos(a) * pr, Math.sin(a) * pr);
      }
      pupil.closePath();
      shapes.push(pupil);
      break;
    }
    default: {
      // 5-pointed star
      const star = new THREE.Shape();
      const pts = 5;
      const rO = Math.min(w, h) * 0.5;
      const rI = rO * 0.45;
      for (let i = 0; i < pts * 2; i++) {
        const a = -Math.PI / 2 + i * (Math.PI / pts);
        const r = (i % 2 === 0) ? rO : rI;
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        if (i === 0) star.moveTo(x, y);
        else star.lineTo(x, y);
      }
      star.closePath();
      shapes.push(star);
      break;
    }
  }
  return new THREE.ShapeGeometry(shapes, 4);
}

/* -----------------------------------------------------------
 * Distant range: a low silhouette of dune cutouts far away,
 * always behind the tower. Pure backdrop for parallax.
 * --------------------------------------------------------- */
function buildDistantRange() {
  const g = new THREE.Group();

  const layers = [
    { dist: -460, scale: 1.0, color: "#c2b78c", height: 32 },
    { dist: -540, scale: 1.2, color: "#a8a684", height: 40 },
    { dist: -640, scale: 1.5, color: "#8a9988", height: 52 },
  ];

  for (const layer of layers) {
    const shape = makeDuneShape(layer.height);
    const geo = new THREE.ShapeGeometry(shape, 80);
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(layer.color),
      fog: true,
      transparent: false,
      depthWrite: false,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(0, 0, layer.dist);
    m.scale.set(layer.scale, 1.0, 1.0);
    g.add(m);
  }

  return g;
}

function makeDuneShape(maxH) {
  const shape = new THREE.Shape();
  const w = 800;
  const segs = 64;
  shape.moveTo(-w * 0.5, 0);
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const x = THREE.MathUtils.lerp(-w * 0.5, w * 0.5, t);
    const y =
      maxH * 0.55 +
      Math.sin(t * 11 + 1.3) * maxH * 0.18 +
      Math.sin(t * 23 + 0.4) * maxH * 0.10 +
      Math.sin(t * 41 - 2.1) * maxH * 0.06;
    shape.lineTo(x, y);
  }
  shape.lineTo(w * 0.5, 0);
  shape.lineTo(-w * 0.5, 0);
  return shape;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function updateWorld(world, dt, t) {
  if (world.sandMat.userData.shader) {
    world.sandMat.userData.shader.uniforms.uTime.value = t;
  }
  world.skyMat.uniforms.uTime.value = t;

  // tower top spire pulse
  const info = world.towerInfo;
  if (info) {
    const s = 1.0 + Math.sin(t * 0.9) * 0.05;
    info.core.scale.setScalar(s);
    info.glow.intensity = 7.0 + Math.sin(t * 0.9) * 1.4;
    info.spireMat.emissiveIntensity = 0.55 + Math.sin(t * 1.1) * 0.18;
    // accent rings shimmer slowly
    for (let i = 0; i < info.accentMeshes.length; i++) {
      const a = info.accentMeshes[i];
      const phase = i * 0.27;
      a.mat.opacity = 0.65 + Math.sin(t * 0.7 + phase) * 0.18;
    }
    // puzzle plates: dim while inactive, pulse warmly once lit
    if (info.plates) {
      for (const plate of info.plates) {
        if (plate.lit) {
          const k = Math.min(1, (t - plate.activatedAt) / 0.7);
          const pulse = 0.85 + Math.sin(t * 2.4) * 0.12;
          plate.light.intensity = THREE.MathUtils.lerp(0, 2.6 * pulse, k);
          plate.glyphMat.opacity = 0.92;
        } else {
          plate.glyphMat.opacity = 0.55 + Math.sin(t * 1.6) * 0.06;
        }
      }
    }
  }

  // lamp gentle flicker
  if (world.lamp?.userData?.glassMat) {
    const flicker = 0.85 + Math.sin(t * 6.0) * 0.05 + (Math.random() - 0.5) * 0.06;
    world.lamp.userData.glassMat.opacity = THREE.MathUtils.clamp(flicker, 0.7, 1.0);
    world.lamp.userData.light.intensity = 1.4 + Math.sin(t * 5.5) * 0.18 + (Math.random() - 0.5) * 0.18;
  }

  // footprint texture decay (slow)
  if (world.footprintLayer && world._fpDecayTimer === undefined) world._fpDecayTimer = 0;
  if (world.footprintLayer) {
    world._fpDecayTimer += dt;
    if (world._fpDecayTimer > 1.5) {
      world.footprintLayer.decay(world._fpDecayTimer);
      world._fpDecayTimer = 0;
    }
  }
}
