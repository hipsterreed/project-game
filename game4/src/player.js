import * as THREE from "three";
import { Ribbon } from "./ribbons.js";
import { Cloak } from "./cloak.js";

/* -----------------------------------------------------------
 * Player
 *   Third-person geometric character. Body parts:
 *     - head (octahedron)
 *     - hood (low-poly cone behind head, swings via simple bone)
 *     - shoulders (anchor for cloak top row)
 *     - arms (two thin boxes that swing during walk)
 *     - feet (two flat slabs that step during walk)
 *     - cloak (verlet cloth, see cloak.js)
 *
 *   Movement: camera-relative WASD, smooth body yaw to face
 *   velocity, gravity + jump, sprint, slide on steep slopes.
 *
 *   Camera: orbit follower. Mouse moves yaw/pitch around the
 *   player; the camera lerps toward an ideal offset.
 * --------------------------------------------------------- */

const TMP_V1 = new THREE.Vector3();
const TMP_V2 = new THREE.Vector3();
const TMP_V3 = new THREE.Vector3();
const TMP_Q = new THREE.Quaternion();
const TMP_Q2 = new THREE.Quaternion();
const _AXIS_X = new THREE.Vector3(1, 0, 0);
const _AXIS_Y = new THREE.Vector3(0, 1, 0);

export class Player {
  constructor(scene, camera, world) {
    this.scene = scene;
    this.camera = camera;
    this.world = world;

    // ---- physics state ----
    this.position = new THREE.Vector3(0, 0, 0);
    this.velocity = new THREE.Vector3(0, 0, 0);
    this.bodyYaw = 0;             // current facing angle
    this.targetYaw = 0;
    this.onGround = true;
    this.sliding = false;
    this.sprintBlend = 0;         // 0..1
    this.movingBlend = 0;         // 0..1
    this.walkPhase = 0;           // animation cycle
    this.lastFootStep = 0;        // -1 left, 1 right; for footstep events
    this.footstepTimer = 0;
    this.currentSpeed = 0;

    // ---- jump / air state ----
    this.jumpsUsed = 0;           // 0 = on ground, 1 = first jump used, 2 = double-jumped
    this._jumpHeld = false;
    this.airTime = 0;
    this.legAirBlend = 0;         // smoothed leg air pose
    this.flipAngle = 0;           // current accumulated flip rotation
    this.flipTarget = 0;          // total target rotation (multiples of 2π)
    this.bodyCompress = 1.0;      // 1 = neutral, < 1 = compressed (jump squat)

    // ---- input ----
    this.keys = new Set();
    this.mouseDx = 0;
    this.mouseDy = 0;
    this.cameraYaw = 0;
    this.cameraPitch = -0.18;
    this.cameraDist = 6.2;
    this.targetCameraDist = 6.2;
    this.lookSensitivity = 0.0022;
    this.pointerLocked = false;

    // ---- character build ----
    this.root = new THREE.Group();
    this.root.position.copy(this.position);
    scene.add(this.root);

    // body container that yaws.
    // Euler order YXZ so the flip (rotation.x) happens around the body's
    // local right axis after yaw — i.e., a front flip is always toward
    // whichever direction the body is currently facing, not the world +X.
    this.body = new THREE.Group();
    this.body.rotation.order = "YXZ";
    this.root.add(this.body);

    // shoulder anchor — child of body, slightly forward
    this.shoulderAnchor = new THREE.Group();
    this.shoulderAnchor.position.set(0, 1.3, 0.05);
    this.body.add(this.shoulderAnchor);

    // shared uniforms used by the cone-cloak AND the hood, so both flow
    // off the same wind/motion/lag state. Initialised before any builders
    // so _buildHood and _buildConeCloak can both call _installFlowShader.
    this._cloakUniforms = {
      uTime: { value: 0 },
      uWind: { value: new THREE.Vector3() },
      uMotion: { value: 0 },
      uLag: { value: new THREE.Vector3() },
      uAirborne: { value: 0 },
      uGlow: { value: new THREE.Color(0xffd9a0) },
      uPulse: { value: 0.5 },
    };
    this._cloakLagWorld = new THREE.Vector3();

    this._buildHood();        // hooded silhouette — replaces head + hat
    this._buildEyes();        // glowing eye points inside the hood
    this._buildHoodEmber();   // faint inner ember lighting the hood
    this._buildChest();       // inner emissive core + warm point light
    this._buildConeCloak();   // cone-shaped robe wrapping the body
    this._buildLegs();        // tapered leg spikes from inside cloak
    this._buildChestEmblem(); // glow on the front of the cone (heart)
    this._buildChestFragments(); // small stone/glass shards on the cone
    this._buildHeldLantern(); // small lantern carried in the right hand
    this._buildLanternArm();  // visible arm reaching from shoulder to the lantern

    // trailing ribbons (like memory pulled through the air)
    this.ribbons = this._buildRibbons();
    for (const r of this.ribbons) scene.add(r.mesh);

    // verlet-cloth trailing cape — a real flowing cloth attached to
    // the shoulders, simulated each frame. Lives in world space and is
    // added directly to the scene (not body), since its geometry holds
    // world-space positions.
    this._buildTrailingCape(scene);

    // event hooks
    this.onFootstep = null;       // (foot:'L'|'R', vel:Vector3) => void
    this.onLand = null;           // (impactSpeed) => void

    // pointer lock and inputs
    this._bindInput();

    // helpful: face -Z initially (toward arch)
    this.bodyYaw = 0;
    this.targetYaw = 0;
    this.cameraYaw = 0;

    // idle camera pan state
    this._idleTimer = 0;
    this._idlePanning = false;
  }

  _buildHood() {
    // A flowing hooded silhouette: full cloth over the top of the head,
    // draped down the back/sides, with a U-shaped face opening at the
    // front so the face is visible. We start with a closed hemisphere
    // (covers the whole crown), then per-vertex lift the lower-front rim
    // upward to carve out the face opening — gives a clean monk-hood
    // look without leaving the top exposed.
    //
    // Same flow shader as the cone cloak so the hood sways with the same
    // wind/motion/lag state.
    const hoodGeo = new THREE.SphereGeometry(
      0.28,
      22, 16,
      0, Math.PI * 2,            // full phi — closed top
      0, Math.PI * 0.88,         // drapes past the equator down the back
    );
    hoodGeo.scale(1.0, 1.30, 1.05);

    const hp = hoodGeo.attributes.position;
    for (let i = 0; i < hp.count; i++) {
      const x0 = hp.getX(i);
      const y0 = hp.getY(i);
      const z0 = hp.getZ(i);
      // t: 0 at the lower rim, 1 at the crown
      const t = THREE.MathUtils.clamp((y0 + 0.30) / 0.75, 0, 1);

      // ---- crown leans backward ----
      let nz = z0 + Math.pow(t, 1.5) * 0.10;
      let ny = y0;

      // ---- face opening: lift the lower-front rim up to brow level ----
      // phi from the front (-Z): 0 at front, ±π/2 at sides, ±π at back
      const phiFromFront = Math.atan2(x0, -nz);
      const frontness = Math.max(0, Math.cos(phiFromFront));
      const browY = 0.18;             // hood-local brow level (just above eyes)
      const wantedLift = Math.max(0, browY - y0);
      ny = y0 + wantedLift * Math.pow(frontness, 1.6);

      // ---- weathered jitter (less near the crown so the lift reads clean) ----
      const j = (Math.sin(i * 7.1) + Math.cos(i * 13.3)) * 0.5;
      const jit = j * 0.012 * (0.4 + 0.6 * (1.0 - t));
      const nx = x0 + jit;
      nz = nz + jit;

      hp.setX(i, nx);
      hp.setY(i, ny);
      hp.setZ(i, nz);
    }
    hp.needsUpdate = true;
    hoodGeo.computeVertexNormals();

    const hoodMat = new THREE.MeshStandardMaterial({
      color: 0x6c1c10,
      roughness: 0.92,
      metalness: 0.0,
      side: THREE.DoubleSide,
      emissive: 0x1c0604,
      emissiveIntensity: 0.45,
    });
    // sway with the cone cloak (smaller amplitude, since the hood is
    // anchored to the head and shouldn't whip around as much as the hem)
    this._installFlowShader(hoodMat, { ampScale: 0.45, detail: false });

    const hood = new THREE.Mesh(hoodGeo, hoodMat);
    hood.castShadow = true;
    hood.position.set(0, 1.45, 0.02);
    this.hood = hood;
    this.body.add(hood);

    // The head/face — visible through the open front of the hood. Low-poly
    // faceted form to match the rest of the character's geometric style,
    // warm muted skin tone with a touch of emissive so it reads even in
    // the dim pre-dawn light.
    const headGeo = new THREE.IcosahedronGeometry(0.15, 1);
    headGeo.scale(1.0, 1.12, 0.95);
    const headMat = new THREE.MeshStandardMaterial({
      color: 0x6e4838,
      roughness: 0.85,
      metalness: 0.0,
      emissive: 0x2a1408,
      emissiveIntensity: 0.35,
    });
    const head = new THREE.Mesh(headGeo, headMat);
    head.castShadow = true;
    head.position.set(0, 1.60, -0.02);
    this.body.add(head);
    // keep the legacy name so the rest of the code (bob updates, etc.)
    // continues to work without a rename
    this.hoodVoid = head;
  }

  _buildHoodEmber() {
    // A faint warm point light tucked inside the hood — gives the
    // interior a soft glow that catches the eyes and the inner cloth.
    const ember = new THREE.PointLight(0xffc89a, 0.55, 0.9, 1.6);
    ember.position.set(0, 1.62, -0.05);
    this.body.add(ember);
    this.hoodEmber = ember;

    // a tiny additive sphere for the visible source of the ember
    const wispGeo = new THREE.SphereGeometry(0.018, 8, 6);
    const wispMat = new THREE.MeshBasicMaterial({
      color: 0xffd9a0,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
    });
    const wisp = new THREE.Mesh(wispGeo, wispMat);
    wisp.position.copy(ember.position);
    this.body.add(wisp);
    this.hoodWisp = wisp;
  }

  _buildEyes() {
    // Two glowing spheres tucked inside the hood. MeshBasicMaterial so
    // they don't get shadowed by the hood and stay luminous. Bloom pass
    // picks them up, giving the iconic "eyes-in-shadow" silhouette.
    const eyeGeo = new THREE.SphereGeometry(0.026, 10, 8);
    const eyeMat = new THREE.MeshBasicMaterial({
      color: 0xffd9a0,
      transparent: true,
      opacity: 0.95,
    });

    this.eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    this.eyeR = new THREE.Mesh(eyeGeo.clone(), eyeMat);
    // sit on the front of the visible face, just below brow level
    this.eyeL.position.set(-0.058, 1.64, -0.155);
    this.eyeR.position.set(0.058, 1.64, -0.155);
    this.body.add(this.eyeL);
    this.body.add(this.eyeR);
  }

  /* -----------------------------------------------------------
   * Verlet-cloth cape that flows behind the player. Uses the
   * existing Cloak class (cloak.js): a grid of points pinned to a
   * shoulder anchor, integrated each frame with gravity + wind.
   * --------------------------------------------------------- */
  _buildTrailingCape(scene) {
    // Less rectangular: pinch the pin row toward the centre and leave the
    // outer columns dangling, so the shoulders drape naturally and the
    // cape reads as a relaxed cape rather than a flat sheet.
    this.trailingCape = new Cloak({
      width: 1.10,
      height: 1.60,
      cols: 13,
      rows: 14,
      anchor: this.shoulderAnchor,
      pinCols: 5,        // pin only 5 central columns (out of 13)
      pinScale: 0.42,    // pinned region spans ~42% of the cape width
    });
    scene.add(this.trailingCape.mesh);
  }

  /* -----------------------------------------------------------
   * Flow shader installer (class method). Both the cone cloak and
   * the hood call this so they read from the same uniforms and
   * sway with the same wind/motion/lag state. `detail` toggles
   * the fragment-shader detail pass (folds, runes, embroidery,
   * tatter) — used only for the outer cloak.
   * --------------------------------------------------------- */
  _installFlowShader(mat, opts = {}) {
    const ampScale = opts.ampScale ?? 1.0;
    const detail = opts.detail ?? false;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this._cloakUniforms.uTime;
      shader.uniforms.uWind = this._cloakUniforms.uWind;
      shader.uniforms.uMotion = this._cloakUniforms.uMotion;
      shader.uniforms.uLag = this._cloakUniforms.uLag;
      shader.uniforms.uAirborne = this._cloakUniforms.uAirborne;
      if (detail) {
        shader.uniforms.uGlow = this._cloakUniforms.uGlow;
        shader.uniforms.uPulse = this._cloakUniforms.uPulse;
      }
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
          uniform float uTime;
          uniform vec3 uWind;
          uniform float uMotion;
          uniform vec3 uLag;
          uniform float uAirborne;
          const float AMP = ${ampScale.toFixed(3)};
          ${detail ? "varying vec2 vCloakUv; varying float vCloakAng;" : ""}`,
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          // hemMask: ripples grow toward the hem (top is pinned to anchor)
          float hemMask = pow(1.0 - uv.y, 1.25);
          float midMask = pow(1.0 - uv.y, 0.7);

          // angular position around the cone/hood axis
          float ang = atan(transformed.x, transformed.z);
          // travelling-wave phase: ripples cascade from top to hem
          float fall = (1.0 - uv.y) * 5.0;

          // multi-octave skirt-swirl waves — different sides flow out of phase
          float w1 = sin(uTime * 1.7 + ang * 2.0 + fall * 1.6);
          float w2 = sin(uTime * 2.6 + ang * 3.5 + fall * 2.4 + 1.3);
          float w3 = cos(uTime * 1.1 + ang * 1.0 + fall * 1.0);

          vec3 tangent = vec3(cos(ang), 0.0, -sin(ang));
          vec3 outward = vec3(sin(ang), 0.0,  cos(ang));

          // tangential swirl — the dominant flowy-skirt motion
          float swirl = (w1 * 0.10 + w2 * 0.05) * AMP;
          transformed += tangent * swirl * hemMask;

          // outward billow — air catching the cloth from inside
          float billow = (cos(uTime * 1.25 + fall * 1.8 + ang * 1.5) * 0.5 + 0.5);
          transformed += outward * billow * 0.075 * AMP * hemMask;

          // directional wind push
          transformed.x += uWind.x * 0.16 * AMP * hemMask;
          transformed.z += uWind.z * 0.16 * AMP * hemMask;

          // forward sprint: hem trails back behind the runner (+Z is back)
          transformed.z += uMotion * 0.32 * hemMask;

          // ----- inertial lag: cloth pushes opposite to body motion -----
          transformed.x -= uLag.x * 0.075 * hemMask;
          transformed.z -= uLag.z * 0.075 * hemMask;
          transformed.y -= uLag.y * 0.060 * hemMask;
          float fallLift = max(-uLag.y, 0.0);
          transformed += outward * fallLift * 0.035 * hemMask;
          transformed += tangent * (w2 * 0.055 * AMP) * uAirborne * hemMask;

          // mid-body flutter so the cloth isn't rigid above the hem
          transformed += tangent * (w3 * 0.025 * AMP) * midMask;

          // vertical hem ripple — the bottom edge undulates like fabric
          transformed.y += w3 * 0.07 * AMP * pow(1.0 - uv.y, 2.2);
          ${detail ? "vCloakUv = uv; vCloakAng = ang;" : ""}`,
        );

      if (detail) {
        shader.fragmentShader = shader.fragmentShader
          .replace(
            "#include <common>",
            `#include <common>
            uniform float uTime;
            uniform vec3 uGlow;
            uniform float uPulse;
            varying vec2 vCloakUv;
            varying float vCloakAng;
            float h11_c(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
            float vn_c(vec2 p){
              vec2 i = floor(p); vec2 f = fract(p);
              vec2 u = f*f*(3.0-2.0*f);
              float a = h11_c(i);
              float b = h11_c(i + vec2(1.0, 0.0));
              float c = h11_c(i + vec2(0.0, 1.0));
              float d = h11_c(i + vec2(1.0, 1.0));
              return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
            }
            float fbm_c(vec2 p){
              float v=0.0; float a=0.5;
              for (int i=0;i<5;i++){ v+=a*vn_c(p); p*=2.07; a*=0.5; }
              return v;
            }`,
          )
          .replace(
            "vec4 diffuseColor = vec4( diffuse, opacity );",
            `// ---- mysterious cloak detail pass ----
            vec3 cloakBase = diffuse;
            float yUp = vCloakUv.y;
            float folds = sin(vCloakAng * 9.0) * 0.5 + 0.5;
            cloakBase *= mix(0.72, 1.05, folds);
            float crease = smoothstep(0.55, 0.95,
              sin(vCloakAng * 3.5 + sin(yUp * 4.2) * 0.9) * 0.5 + 0.5);
            cloakBase *= 1.0 - crease * 0.32;
            float dust = fbm_c(vec2(vCloakAng * 0.7, yUp * 1.2) * 1.6);
            cloakBase *= mix(0.78, 1.10, dust);

            vec2 vp = vec2(vCloakAng * 0.55, yUp * 1.3);
            float veinNoise = fbm_c(vp * 4.5 + vec2(uTime * 0.04, 0.0));
            float veins = smoothstep(0.62, 0.66, veinNoise);
            veins *= smoothstep(0.06, 0.45, yUp);
            float veinPulse = 0.55 + 0.45 * sin(uTime * 1.6 + yUp * 7.0);
            vec3 cloakVeinGlow = uGlow * veins * veinPulse * 0.9;
            cloakBase += cloakVeinGlow * 0.55;

            float runeAccum = 0.0;
            {
              float angD = abs(vCloakAng);
              for (int i = 0; i < 3; i++) {
                float fi = float(i);
                float yPos = 0.32 + fi * 0.22;
                float dy = yUp - yPos;
                float d = sqrt(angD*angD*1.4 + dy*dy*5.5);
                float g = exp(-d * 16.0);
                float pulse = 0.55 + 0.45 * sin(uTime * 1.4 + fi * 1.7);
                runeAccum += g * (0.7 + 0.3 * uPulse) * pulse;
              }
            }
            vec3 cloakRuneGlow = uGlow * runeAccum * 1.6;
            cloakBase += cloakRuneGlow * 0.55;

            float shoulderTrim = smoothstep(0.86, 0.93, yUp) * (1.0 - smoothstep(0.95, 0.99, yUp));
            float trimWeave = sin(vCloakAng * 16.0) * 0.5 + 0.5;
            vec3 trimColor = uGlow * 0.35 * (0.6 + 0.4 * trimWeave);
            cloakBase += shoulderTrim * trimColor;

            float hemNoise = fbm_c(vec2(vCloakAng * 6.5, yUp * 22.0));
            float hemEdge = smoothstep(0.0, 0.07, yUp);
            float tatter = 1.0 - (1.0 - hemEdge) * (0.35 + 0.65 * hemNoise);
            cloakBase *= 0.45 + 0.55 * tatter;

            float emberMask = (1.0 - smoothstep(0.0, 0.12, yUp)) * (0.4 + 0.6 * hemNoise);
            vec3 cloakEmberGlow = uGlow * emberMask * 0.35 * (0.6 + 0.4 * uPulse);
            cloakBase += cloakEmberGlow * 0.6;

            cloakBase *= 1.0 + smoothstep(0.88, 1.0, yUp) * 0.18;

            vec4 diffuseColor = vec4(cloakBase, opacity);`,
          )
          .replace(
            "#include <emissivemap_fragment>",
            `#include <emissivemap_fragment>
            totalEmissiveRadiance += cloakRuneGlow * 1.4;
            totalEmissiveRadiance += cloakVeinGlow * 0.55;
            totalEmissiveRadiance += cloakEmberGlow * 0.8;`,
          );
      }
      mat.userData.shader = shader;
    };
  }

  _buildChest() {
    // The chest glow: a small emissive core inside an outer cage of
    // dim metallic wires. Drives a real point light so the cloak's
    // interior catches a faint warm shimmer from below.
    const coreGeo = new THREE.IcosahedronGeometry(0.07, 1);
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
    const core = new THREE.Mesh(coreGeo, coreMat);
    core.position.set(0, 1.05, -0.11);
    this.body.add(core);
    this.chestCore = core;

    // outer halo sphere (additive-feel via slightly larger transparent ico)
    const haloGeo = new THREE.IcosahedronGeometry(0.13, 1);
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0xffb060,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
    });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.position.copy(core.position);
    this.body.add(halo);
    this.chestHalo = halo;

    // point light — pre-dawn: keep it subtle, just a soft glow on the
    // body itself rather than a beacon that lights the world.
    const light = new THREE.PointLight(0xffc890, 0.45, 2.6, 1.6);
    light.position.copy(core.position);
    this.body.add(light);
    this.chestLight = light;
  }

  _buildConeCloak() {
    // The main robe: a truncated cone wrapping the body. Top opens
    // narrowly so the head/hat sit above; bottom flares so the legs
    // emerge from inside.
    //
    // CylinderGeometry( radiusTop, radiusBottom, height, ...) gives
    // a clean hollow cone shell with open ends. UV.y goes 0 at the
    // bottom edge to 1 at the top edge, which we use in a vertex
    // shader hook to add gentle wind sway weighted toward the hem.
    const TOP_R = 0.19;
    const BOT_R = 0.44;
    const HEIGHT = 0.90;
    const cloakGeo = new THREE.CylinderGeometry(
      TOP_R, BOT_R, HEIGHT,
      18, 14, true,       // radial segs, height segs, open ended
    );

    // weather the hem: small inward/outward jitter on the bottom rows
    const cp = cloakGeo.attributes.position;
    for (let i = 0; i < cp.count; i++) {
      const y = cp.getY(i);
      // hem-weighted jitter
      const t = THREE.MathUtils.clamp(0.5 - y / HEIGHT, 0, 1);
      const j = (Math.sin(i * 5.3) + Math.cos(i * 11.1)) * 0.5;
      cp.setX(i, cp.getX(i) + j * 0.018 * t);
      cp.setZ(i, cp.getZ(i) + j * 0.018 * t);
    }
    cp.needsUpdate = true;
    cloakGeo.computeVertexNormals();

    const cloakMat = new THREE.MeshStandardMaterial({
      color: 0x8a2618,
      roughness: 0.88,
      metalness: 0.0,
      side: THREE.DoubleSide,
      // a touch of emissive so the cloak still reads warm in shadow
      emissive: 0x2a0c06,
      emissiveIntensity: 0.55,
    });

    // (cloak uniforms + lag state are initialised in the constructor so
    // both _buildHood and _buildConeCloak can share them.)
    this._installFlowShader(cloakMat, { ampScale: 1.25, detail: true });

    const cloak = new THREE.Mesh(cloakGeo, cloakMat);
    cloak.castShadow = true;
    cloak.receiveShadow = true;
    cloak.position.set(0, 0.55 + HEIGHT * 0.5, 0); // bottom at y=0.55
    this.coneCloak = cloak;
    this.coneCloakMat = cloakMat;
    this.body.add(cloak);

    // a darker inner-lining cone, slightly smaller, to avoid seeing
    // through to the back side via z-fighting with light. Driven by the
    // same flow shader (slightly damped) so it follows the outer cloak
    // when it billows, instead of staying behind and poking through.
    const innerGeo = new THREE.CylinderGeometry(
      TOP_R * 0.95, BOT_R * 0.95, HEIGHT * 0.99,
      18, 14, true,
    );
    const innerMat = new THREE.MeshStandardMaterial({
      color: 0x4a1308,
      roughness: 1.0,
      metalness: 0.0,
      side: THREE.BackSide,
    });
    this._installFlowShader(innerMat, { ampScale: 1.10, detail: false });
    const inner = new THREE.Mesh(innerGeo, innerMat);
    inner.position.copy(cloak.position);
    this.body.add(inner);
    this.coneCloakInner = inner;
    this.coneCloakInnerMat = innerMat;
  }

  _buildLegs() {
    // Two tapering "leg spikes": thick at the hip (inside the cone),
    // sharply pointed at the ground. CylinderGeometry with an almost-
    // zero radiusBottom gives the pointy tip.
    const LEG_LEN = 0.86;
    const legMat = new THREE.MeshStandardMaterial({
      color: 0x2c1a0e,
      roughness: 0.95,
      metalness: 0.0,
    });
    const legGeo = new THREE.CylinderGeometry(
      0.11,             // radiusTop (thick, at hip)
      0.005,            // radiusBottom (pointy, at ground)
      LEG_LEN,
      6,                // 6-sided low-poly
      1,
      false,
    );
    legGeo.translate(0, -LEG_LEN * 0.5, 0); // pivot at top
    this._legLen = LEG_LEN;

    // hip pivot inside the cone — y matches near the top of the leg's
    // visible length when standing.
    const hipY = LEG_LEN; // top of leg at this y, tip at y=0 ground

    this.legL = new THREE.Mesh(legGeo, legMat);
    this.legL.position.set(-0.09, hipY, 0.0);
    this.legL.castShadow = true;
    this.body.add(this.legL);

    this.legR = new THREE.Mesh(legGeo.clone(), legMat);
    this.legR.position.set(0.09, hipY, 0.0);
    this.legR.castShadow = true;
    this.body.add(this.legR);
  }

  _buildChestEmblem() {
    // A glowing emblem on the front of the cone, at chest level —
    // visible representation of the chest core "showing through" the
    // robe. Faceted diamond shape for the geometric look.
    const emblemGeo = new THREE.OctahedronGeometry(0.06, 0);
    emblemGeo.scale(1.0, 1.4, 0.35); // flatten so it lies near the cone surface
    const emblemMat = new THREE.MeshBasicMaterial({
      color: 0xffd9a0,
      transparent: true,
      opacity: 0.95,
    });
    const emblem = new THREE.Mesh(emblemGeo, emblemMat);
    // cone radius at chest (y=1.05): t ≈ (1.05-0.55)/0.90 = 0.556
    // r = lerp(0.44, 0.19, 0.556) ≈ 0.30
    emblem.position.set(0, 1.05, -0.30);
    emblem.rotation.set(0, 0, 0);
    this.body.add(emblem);
    this.chestEmblem = emblem;

    // soft outer halo on the cone surface
    const haloGeo = new THREE.OctahedronGeometry(0.11, 0);
    haloGeo.scale(1.0, 1.4, 0.18);
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0xffb060,
      transparent: true,
      opacity: 0.20,
      depthWrite: false,
    });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.position.copy(emblem.position);
    this.body.add(halo);
    this.chestEmblemHalo = halo;
  }

  _buildChestFragments() {
    // Small angular stone pieces fixed on the front of the cone,
    // flanking the chest emblem. They idle-rotate slightly.
    const stoneMat = new THREE.MeshStandardMaterial({
      color: 0x6e4a2a,
      roughness: 0.6,
      metalness: 0.05,
      emissive: 0x4a2410,
      emissiveIntensity: 0.4,
    });
    const glassMat = new THREE.MeshBasicMaterial({
      color: 0xffd6a0,
      transparent: true,
      opacity: 0.7,
    });

    const flankL = new THREE.Mesh(new THREE.OctahedronGeometry(0.05, 0), stoneMat);
    flankL.position.set(-0.17, 1.16, -0.28);
    flankL.rotation.set(0.3, 0.4, 0.2);
    flankL.castShadow = true;
    this.body.add(flankL);

    const flankR = new THREE.Mesh(new THREE.OctahedronGeometry(0.04, 0), stoneMat);
    flankR.position.set(0.15, 1.20, -0.28);
    flankR.rotation.set(0.1, -0.3, -0.4);
    flankR.castShadow = true;
    this.body.add(flankR);

    const shard = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.10, 4), glassMat);
    shard.position.set(-0.04, 0.94, -0.34);
    shard.rotation.set(0.2, 0.3, 0.5);
    this.body.add(shard);

    this.chestFragments = [flankL, flankR, shard];
  }

  _buildHeldLantern() {
    // A small lantern carried at the player's right side. Unlit by default
    // (dim glass, no point light). Lights up when the trail flame is taken.
    // Visually echoes the shrine lantern so the "transfer" reads cleanly.
    const ironMat = new THREE.MeshStandardMaterial({
      color: 0x3a2618,
      roughness: 0.65,
      metalness: 0.35,
    });

    // pivot group hanging from the right hand — child of body so it
    // follows yaw / lean / flip naturally. The pivot itself is the hand
    // position; the lantern hangs below it from a short chain so it can
    // dangle/swing as a pendulum.
    const armPivot = new THREE.Group();
    // hand held out forward and to the right of the body
    armPivot.position.set(0.46, 1.18, -0.32);
    this.body.add(armPivot);
    this.heldLanternArm = armPivot;

    // the swinging part — chain + lantern body. Pivots at y=0 (hand) and
    // hangs downward; a damped pendulum so jolts and turns make it dangle.
    const lantern = new THREE.Group();
    armPivot.add(lantern);
    this.heldLantern = lantern;

    // pendulum runtime state
    this._lanternPendX = 0;     // pitch (around local X)
    this._lanternPendZ = 0;     // roll (around local Z)
    this._lanternPendVX = 0;
    this._lanternPendVZ = 0;
    this._lanternPrevWorldVel = new THREE.Vector3();

    // small handle ring where the chain meets the hand
    const handle = new THREE.Mesh(
      new THREE.TorusGeometry(0.055, 0.011, 6, 14),
      ironMat,
    );
    handle.rotation.x = Math.PI / 2;
    handle.position.y = -0.02;
    lantern.add(handle);

    // short chain links hanging from the hand down to the cage
    for (let i = 0; i < 3; i++) {
      const link = new THREE.Mesh(
        new THREE.TorusGeometry(0.018, 0.0045, 5, 10),
        ironMat,
      );
      link.position.y = -0.06 - i * 0.035;
      link.rotation.x = (i % 2) * Math.PI / 2;
      lantern.add(link);
    }

    // glass body — bigger so it reads as a real lantern in the hand
    const glassGeo = new THREE.OctahedronGeometry(0.13, 0);
    glassGeo.scale(1.0, 1.4, 1.0);
    const glassMat = new THREE.MeshBasicMaterial({
      color: 0x6a5a44,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    const glass = new THREE.Mesh(glassGeo, glassMat);
    glass.position.y = -0.27;
    lantern.add(glass);
    this.heldLanternGlass = glass;
    this.heldLanternGlassMat = glassMat;

    // iron cage — 4 verticals
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const cage = new THREE.Mesh(
        new THREE.CylinderGeometry(0.006, 0.006, 0.34, 4),
        ironMat,
      );
      cage.position.set(
        Math.cos(a) * 0.115,
        glass.position.y,
        Math.sin(a) * 0.115,
      );
      lantern.add(cage);
    }
    // top + bottom cage rings
    for (const dy of [-0.17, 0.17]) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.115, 0.009, 5, 14),
        ironMat,
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = glass.position.y + dy;
      lantern.add(ring);
    }

    // hot core
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xfff1c4,
      transparent: true,
      opacity: 0.0,
    });
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 10, 6),
      coreMat,
    );
    core.position.copy(glass.position);
    lantern.add(core);
    this.heldLanternCore = core;
    this.heldLanternCoreMat = coreMat;

    // halo
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0xffb070,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(0.15, 10, 6),
      haloMat,
    );
    halo.position.copy(glass.position);
    lantern.add(halo);
    this.heldLanternHaloMat = haloMat;

    // point light — off until lit. Once lit, this becomes the player's
    // primary light source in the pre-dawn dark, so it has a generous
    // range and softer falloff than the chest glow.
    const lanternLight = new THREE.PointLight(0xffc890, 0.0, 26, 1.25);
    lanternLight.position.copy(glass.position);
    lanternLight.castShadow = false;
    lantern.add(lanternLight);
    this.heldLanternLight = lanternLight;

    // public flame strength — main.js drives this 0..1 during the take
    this.heldLanternFlame = 0;
  }

  _buildLanternArm() {
    // A dark, tapered arm that connects the right shoulder to wherever the
    // lantern is held. Each frame we orient + stretch this single cylinder
    // so it always points at the held-lantern hand pivot, giving the
    // illusion that the player is actually carrying the lantern.
    const armMat = new THREE.MeshStandardMaterial({
      color: 0x150a06,
      roughness: 0.92,
      metalness: 0.0,
      emissive: 0x0c0402,
      emissiveIntensity: 0.4,
    });
    // Cylinder along +Y, default 1 unit tall, centred at origin.
    // Translate so the TOP is at local y=0 (shoulder) and BOTTOM is at y=-1.
    const armGeo = new THREE.CylinderGeometry(0.058, 0.040, 1.0, 7, 1);
    armGeo.translate(0, -0.5, 0);

    const arm = new THREE.Mesh(armGeo, armMat);
    arm.castShadow = true;
    // shoulder anchor (body-local), tucked just inside the cloak rim
    this._lanternArmShoulder = new THREE.Vector3(0.22, 1.34, -0.05);
    arm.position.copy(this._lanternArmShoulder);
    this.body.add(arm);
    this.heldLanternArmMesh = arm;

    // a small "hand" knob at the bottom so the arm doesn't just terminate
    // mid-air at the lantern's chain ring
    const handGeo = new THREE.SphereGeometry(0.045, 10, 8);
    const hand = new THREE.Mesh(handGeo, armMat);
    hand.castShadow = true;
    this.body.add(hand);
    this.heldLanternHandKnob = hand;
  }

  _buildRibbons() {
    // Three trailing ribbons: one on each shoulder + one centred on
    // the back. Light gravity so they drift instead of dragging — the
    // player's motion + wind shapes them into long horizontal trails.
    const r1 = new Ribbon({
      length: 1.9,
      segments: 16,
      width: 0.07,
      anchor: this.shoulderAnchor,
      offset: new THREE.Vector3(-0.32, 0.04, 0.10),
      topColor: new THREE.Color("#7a2418"),
      tipColor: new THREE.Color("#ffc88a"),
    });
    const r2 = new Ribbon({
      length: 2.1,
      segments: 18,
      width: 0.08,
      anchor: this.shoulderAnchor,
      offset: new THREE.Vector3(0.32, 0.04, 0.10),
      topColor: new THREE.Color("#7a2418"),
      tipColor: new THREE.Color("#ffc88a"),
    });
    const r3 = new Ribbon({
      length: 2.4,
      segments: 20,
      width: 0.09,
      anchor: this.shoulderAnchor,
      offset: new THREE.Vector3(0.0, -0.08, 0.16),
      topColor: new THREE.Color("#5a1810"),
      tipColor: new THREE.Color("#ffd9a0"),
    });
    return [r1, r2, r3];
  }

  _bindInput() {
    const dom = this.camera.userData.domElement || document.body;
    this._dom = dom;

    window.addEventListener("keydown", (e) => {
      this.keys.add(e.code);
      if (e.code === "Space") e.preventDefault();
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));

    dom.addEventListener("click", () => {
      if (!this.pointerLocked && this.canControl) dom.requestPointerLock?.();
    });
    document.addEventListener("pointerlockchange", () => {
      this.pointerLocked = document.pointerLockElement === dom;
    });
    document.addEventListener("mousemove", (e) => {
      if (!this.pointerLocked) return;
      this.mouseDx += e.movementX || 0;
      this.mouseDy += e.movementY || 0;
    });
    // wheel changes follow distance a touch
    dom.addEventListener("wheel", (e) => {
      this.targetCameraDist = THREE.MathUtils.clamp(
        this.targetCameraDist + Math.sign(e.deltaY) * 0.4,
        4.0, 9.5,
      );
    }, { passive: true });
  }

  enableControl() {
    this.canControl = true;
  }

  spawn(pos) {
    this.position.copy(pos);
    this.position.y = this.world.getHeight(pos.x, pos.z);
    this.root.position.copy(this.position);
    this.velocity.set(0, 0, 0);
    // give the body matrix one update before ribbon init reads it
    this.body.updateWorldMatrix(true, true);
    if (this.ribbons) for (const r of this.ribbons) r.reset(this.shoulderAnchor);
    if (this.trailingCape) this.trailingCape.reset(this.shoulderAnchor);
  }

  /* -----------------------------------------------------------
   * Per-frame update
   * --------------------------------------------------------- */
  update(dt, t) {
    // clamp dt to avoid tunneling on tab switches
    dt = Math.min(dt, 1 / 30);

    // ---- camera input (mouse) ----
    const hadMouseInput = this.mouseDx !== 0 || this.mouseDy !== 0;
    if (this.canControl && this.pointerLocked) {
      this.cameraYaw -= this.mouseDx * this.lookSensitivity;
      this.cameraPitch -= this.mouseDy * this.lookSensitivity;
      this.cameraPitch = THREE.MathUtils.clamp(
        this.cameraPitch, -0.85, 0.55,
      );
    }
    this.mouseDx = 0;
    this.mouseDy = 0;

    // ---- movement input -> world-space wish dir ----
    const wish = TMP_V1.set(0, 0, 0);
    if (this.canControl) {
      const k = this.keys;
      let f = 0, s = 0;
      if (k.has("KeyW") || k.has("ArrowUp")) f += 1;
      if (k.has("KeyS") || k.has("ArrowDown")) f -= 1;
      if (k.has("KeyA") || k.has("ArrowLeft")) s -= 1;
      if (k.has("KeyD") || k.has("ArrowRight")) s += 1;

      // forward direction is camera-yaw projected on ground
      const forward = TMP_V2.set(
        -Math.sin(this.cameraYaw), 0, -Math.cos(this.cameraYaw),
      );
      const right = TMP_V3.set(
        Math.cos(this.cameraYaw), 0, -Math.sin(this.cameraYaw),
      );
      wish.copy(forward).multiplyScalar(f).addScaledVector(right, s);
      if (wish.lengthSq() > 0) wish.normalize();
    }

    // ---- idle camera pan ----
    const playerIdle = wish.lengthSq() < 0.0001 && !hadMouseInput && this.onGround;
    if (playerIdle) {
      this._idleTimer += dt;
    } else {
      this._idleTimer = 0;
      this._idlePanning = false;
    }
    if (this._idleTimer > 5.0) this._idlePanning = true;
    if (this._idlePanning) {
      this.cameraYaw += 0.18 * dt;  // ~35s per full orbit
    }

    // ---- speeds ----
    const sprintHeld = this.canControl && this.keys.has("ShiftLeft");
    this.sprintBlend = THREE.MathUtils.damp(
      this.sprintBlend, sprintHeld && wish.lengthSq() > 0 ? 1 : 0, 6, dt,
    );
    const walkSpeed = 4.4;
    const sprintSpeed = 8.6;
    const targetSpeed = THREE.MathUtils.lerp(walkSpeed, sprintSpeed, this.sprintBlend);

    // ---- horizontal velocity (smoothed steering) ----
    const desired = TMP_V2.copy(wish).multiplyScalar(targetSpeed);
    this.velocity.x = THREE.MathUtils.damp(this.velocity.x, desired.x, 6.5, dt);
    this.velocity.z = THREE.MathUtils.damp(this.velocity.z, desired.z, 6.5, dt);

    // ---- slope slide assist on steep dunes ----
    const slope = this.world.getSlope(this.position.x, this.position.z);
    const normal = this.world.getNormal(this.position.x, this.position.z);
    this.sliding = this.onGround && slope > 0.36;
    if (this.sliding) {
      // push along the down-slope component (xz of normal points uphill)
      const slideDir = TMP_V3.set(-normal.x, 0, -normal.z);
      const slideLen = slideDir.length();
      if (slideLen > 1e-4) slideDir.multiplyScalar(1 / slideLen);
      const slideAccel = THREE.MathUtils.lerp(2.5, 14.0, THREE.MathUtils.smoothstep(slope, 0.36, 0.7));
      this.velocity.addScaledVector(slideDir, slideAccel * dt);
    }

    // ---- jump ----
    // First press = plain jump (no flip), whether grounded or after a
    // ledge walk-off. Second fast press while in air = double jump WITH
    // the front-flip animation. So a single tap is always just a jump,
    // and only a quick second tap triggers the double jump.
    const jumpPressed = this.canControl && this.keys.has("Space");
    const jumpJustPressed = jumpPressed && !this._jumpHeld;
    if (jumpJustPressed) {
      if (this.jumpsUsed === 0) {
        const jumpV = 7.2 + this.sprintBlend * 1.6 + (this.sliding ? 1.4 : 0);
        this.velocity.y = jumpV;
        this.onGround = false;
        this.jumpsUsed = 1;
        this.bodyCompress = 0.78;   // start compressed; springs back via damp
        // a small forward boost from the slope
        this.velocity.addScaledVector(
          TMP_V1.set(this.velocity.x, 0, this.velocity.z).normalize()
            .multiplyScalar(1.2),
          this.sliding ? 1.2 : 0.6,
        );
      } else if (!this.onGround && this.jumpsUsed === 1) {
        // double jump: a bit higher than the base jump so the slow
        // ball-up front flip has air-time to complete.
        const baseV = 7.2 + this.sprintBlend * 1.6;
        this.velocity.y = baseV * 1.55;
        this.jumpsUsed = 2;
        this.bodyCompress = 0.86;
        // queue a full front flip — negative around local X so the
        // chest pitches forward & down (model faces -Z by default).
        this.flipTarget = this.flipAngle - Math.PI * 2;
      }
    }
    this._jumpHeld = jumpPressed;

    // ---- gravity / vertical integrate ----
    if (!this.onGround) {
      this.velocity.y -= 22.0 * dt;
      this.airTime += dt;
    } else {
      this.airTime = 0;
    }

    // ---- integrate position ----
    this.position.addScaledVector(this.velocity, dt);

    // push player out of lamp post column bases
    if (this.world.columnBlockers) {
      const PLAYER_R = 0.30;
      for (const col of this.world.columnBlockers) {
        const dx = this.position.x - col.x;
        const dz = this.position.z - col.z;
        const distSq = dx * dx + dz * dz;
        const minDist = col.r + PLAYER_R;
        if (distSq < minDist * minDist && distSq > 1e-8) {
          const dist = Math.sqrt(distSq);
          const push = (minDist - dist) / dist;
          this.position.x += dx * push;
          this.position.z += dz * push;
          const nx = dx / dist, nz = dz / dist;
          const dot = this.velocity.x * nx + this.velocity.z * nz;
          if (dot < 0) {
            this.velocity.x -= dot * nx;
            this.velocity.z -= dot * nz;
          }
        }
      }
    }

    // ---- ground / step collision ----
    const ceilY = this.position.y + 0.05;
    const groundY = this.world.surfaceY
      ? this.world.surfaceY(this.position.x, this.position.z, ceilY)
      : this.world.getHeight(this.position.x, this.position.z);
    const wasAir = !this.onGround;
    if (this.position.y <= groundY) {
      const impactV = wasAir ? -this.velocity.y : 0;
      this.position.y = groundY;
      if (this.velocity.y < 0) this.velocity.y = 0;
      const wasOnGround = this.onGround;
      this.onGround = true;
      this.jumpsUsed = 0;
      // snap any lingering flip to the nearest full revolution
      if (this.flipTarget !== 0) {
        this.flipAngle = this.flipTarget;
        this.flipTarget = 0;
      }
      if (!wasOnGround && impactV > 1.5 && this.onLand) {
        this.onLand(impactV);
        this.bodyCompress = 0.7;  // landing squash
      }
    } else if (!wasAir && this.velocity.y <= 0.1 && this.position.y - groundY < 0.6) {
      // Ground snap on descent: if we were grounded last frame and are
      // only barely above the surface (walking down a slope, or stepping
      // off a small lip), re-clamp to the ground instead of going
      // airborne. Without this, descending toggles airborne/grounded
      // each frame and gravity+snap reads as a jumpy/staccato fall.
      this.position.y = groundY;
      if (this.velocity.y < 0) this.velocity.y = 0;
      this.onGround = true;
    } else {
      // transitioning to air. Keep jumpsUsed=0 after a ledge walk-off so
      // the next single tap is still a plain jump (and only a quick
      // second tap turns into the flip-double-jump).
      this.onGround = false;
    }

    // normalize accumulated flip to keep float precision stable
    if (this.flipTarget === 0 && Math.abs(this.flipAngle) > Math.PI * 4) {
      this.flipAngle = this.flipAngle % (Math.PI * 2);
    }

    // ---- soft world bounds: gently stop the player going past ±420 ----
    const lim = 420;
    if (Math.abs(this.position.x) > lim) {
      this.position.x = THREE.MathUtils.clamp(this.position.x, -lim, lim);
      this.velocity.x = 0;
    }
    if (Math.abs(this.position.z) > lim) {
      this.position.z = THREE.MathUtils.clamp(this.position.z, -lim, lim);
      this.velocity.z = 0;
    }

    // Visual y smoothing: physics keeps exact position, but render with
    // a damped y so discrete vertical snaps (stair steps, slope step-
    // downs) don't punch the silhouette up each frame. Sync immediately
    // while airborne or on the landing frame so jumps and impacts stay
    // sharp.
    if (this._visualY === undefined) this._visualY = this.position.y;
    if (this.onGround && !wasAir) {
      this._visualY = THREE.MathUtils.damp(this._visualY, this.position.y, 18, dt);
    } else {
      this._visualY = this.position.y;
    }
    this.root.position.set(this.position.x, this._visualY, this.position.z);

    // ---- body yaw lerps to face current movement ----
    // Use the *input* direction (wish), not velocity, so the character
    // doesn't flip 180° as residual velocity decays through zero, and
    // doesn't moonwalk-spin when pressing S. If there's no input, hold
    // the last facing.
    const horiz = TMP_V1.set(this.velocity.x, 0, this.velocity.z);
    this.currentSpeed = horiz.length();
    if (wish.lengthSq() > 0.0001) {
      // body's default front is -Z, so invert wish before atan2
      this.targetYaw = Math.atan2(-wish.x, -wish.z);
    }
    // shortest-path lerp
    const dy = wrapAngle(this.targetYaw - this.bodyYaw);
    this.bodyYaw += dy * Math.min(1, dt * 9.0);
    // body quaternion is composed below (yaw + pitch) in one step so the
    // flip always pitches around the body's local right axis.

    // ---- character animation ----
    this.movingBlend = THREE.MathUtils.damp(
      this.movingBlend,
      this.currentSpeed > 0.4 ? 1 : 0,
      6, dt,
    );

    const stride = THREE.MathUtils.lerp(3.0, 5.2, this.sprintBlend);
    const phaseSpeed = stride * (this.currentSpeed / 5.5);
    this.walkPhase += phaseSpeed * dt;

    // walk leg swing — wider amplitude for clearer cycle
    const groundLegSwing = 0.62 * this.movingBlend;
    const legPhase = Math.sin(this.walkPhase);

    // ---- AIR LEG POSE ----
    // tuck up while rising / during flip; extend downward on descent
    let airTuck = 0;
    if (!this.onGround) {
      if (this.flipTarget !== 0) {
        airTuck = -2.5;             // knees tight to the chest during the flip
      } else if (this.velocity.y > 0) {
        airTuck = -0.95;            // legs up while rising
      } else {
        airTuck = 0.40;             // legs extend before landing
      }
    }
    const airBlend = this.onGround ? 0 : 1;
    this.legAirBlend = THREE.MathUtils.damp(this.legAirBlend, airTuck * airBlend, 9, dt);

    // combined leg pose: ground walk cycle (when grounded) + air pose
    const groundWeight = 1 - Math.min(1, airBlend);
    this.legL.rotation.x = legPhase * groundLegSwing * groundWeight + this.legAirBlend;
    this.legR.rotation.x = -legPhase * groundLegSwing * groundWeight + this.legAirBlend;
    this.legL.rotation.z = legPhase * 0.05 * this.movingBlend * groundWeight;
    this.legR.rotation.z = -legPhase * 0.05 * this.movingBlend * groundWeight;

    // body bob
    const bob = Math.abs(Math.sin(this.walkPhase * 1.0)) * 0.05 * this.movingBlend * groundWeight;
    // body compression (jump squat / landing squash) eases back to 1
    this.bodyCompress = THREE.MathUtils.damp(this.bodyCompress, 1.0, 8, dt);
    // hold a "ball" shape while flipping: shorter on Y, fatter on XZ
    const ballBlend = this.flipTarget !== 0 ? 1.0 : 0.0;
    const compY = this.bodyCompress * THREE.MathUtils.lerp(1.0, 0.72, ballBlend);
    const compXZ = (1.0 + (1.0 - this.bodyCompress) * 0.4) * THREE.MathUtils.lerp(1.0, 1.18, ballBlend);
    this.body.scale.set(compXZ, compY, compXZ);

    this.hood.position.y = 1.45 + bob;
    if (this.hoodVoid) this.hoodVoid.position.y = 1.60 + bob;
    if (this.hoodEmber) this.hoodEmber.position.y = 1.62 + bob;
    if (this.hoodWisp) this.hoodWisp.position.y = 1.62 + bob;
    this.shoulderAnchor.position.y = 1.3 + bob;
    // small jump-y motion: hood lifts during ascent (squash/stretch)
    const jumpLift = !this.onGround && this.velocity.y > 0 ? 0.06 : 0;
    this.hood.position.y += jumpLift * 1.2;
    if (this.hoodVoid) this.hoodVoid.position.y += jumpLift;
    if (this.hoodEmber) this.hoodEmber.position.y += jumpLift;
    if (this.hoodWisp) this.hoodWisp.position.y += jumpLift;

    this.chestCore.position.y = 1.05 + bob;
    this.chestHalo.position.y = 1.05 + bob;
    this.chestLight.position.y = 1.05 + bob;
    if (this.chestEmblem) {
      this.chestEmblem.position.y = 1.05 + bob;
      this.chestEmblemHalo.position.y = 1.05 + bob;
    }
    if (this.eyeL) {
      this.eyeL.position.y = 1.65 + bob;
      this.eyeR.position.y = 1.65 + bob;
    }

    // ---- flip animation ----
    if (this.flipTarget !== 0) {
      const flipSpeed = Math.PI * 2 / 1.45;  // slow front flip: ~1.45s per revolution
      this.flipAngle = THREE.MathUtils.damp(this.flipAngle, this.flipTarget, 2.4, dt);
      // ensure steady progress so it always completes
      const remaining = this.flipTarget - this.flipAngle;
      if (Math.abs(remaining) > 0.01) {
        this.flipAngle += Math.sign(remaining) * Math.min(Math.abs(remaining), flipSpeed * dt);
      }
      if (Math.abs(remaining) < 0.05) {
        this.flipAngle = this.flipTarget;
        this.flipTarget = 0;
      }
    }

    // ---- body rotation: yaw, then pitch around the body's local right ----
    // Build the quaternion explicitly: q = yawQ * pitchQ. Applying this to
    // a local-space vector means pitchQ runs first (around world X = body's
    // local right axis BEFORE yaw), then yawQ rotates the result around Y.
    // Net effect = pitch around the body's local right axis after yaw, so
    // the front flip always pitches toward whichever direction the body is
    // currently facing. Doing this with a quaternion (rather than relying
    // on Euler order) is unambiguous and order-independent.
    const lean = this.sprintBlend * 0.18 * this.movingBlend;
    const yawQ = TMP_Q.setFromAxisAngle(_AXIS_Y, this.bodyYaw);
    const pitchQ = TMP_Q2.setFromAxisAngle(_AXIS_X, lean + this.flipAngle);
    this.body.quaternion.copy(yawQ).multiply(pitchQ);

    // hood: tuck during flip (chin-to-chest), lag yaw on turns, and tilt
    // back when sprinting like the wind catches the cloth.
    const headTuckTarget = this.flipTarget !== 0 ? 1.05 : 0;
    if (this._headTuck === undefined) this._headTuck = 0;
    this._headTuck = THREE.MathUtils.damp(this._headTuck, headTuckTarget, 6, dt);
    if (this.hoodVoid) this.hoodVoid.rotation.x = this._headTuck;

    if (this._hoodLagYaw === undefined) this._hoodLagYaw = this.bodyYaw;
    this._hoodLagYaw += wrapAngle(this.bodyYaw - this._hoodLagYaw) * Math.min(1, dt * 5.0);
    this.hood.rotation.y = wrapAngle(this._hoodLagYaw - this.bodyYaw) * 0.55;
    this.hood.rotation.x = -this.sprintBlend * 0.20 * this.movingBlend + this._headTuck * 0.85;

    // chest pulse: slow breathing + a quicker accent when moving
    const slowPulse = 0.5 + Math.sin(t * 1.4) * 0.5;
    const fastPulse = 0.5 + Math.sin(t * 3.7 + this.walkPhase * 0.4) * 0.5;
    const pulse = THREE.MathUtils.lerp(slowPulse, fastPulse, this.movingBlend * 0.6);
    const coreScale = 0.92 + pulse * 0.18;
    this.chestCore.scale.setScalar(coreScale);
    this.chestHalo.scale.setScalar(0.95 + pulse * 0.4);
    this.chestHalo.material.opacity = 0.12 + pulse * 0.16;
    this.chestLight.intensity = 0.30 + pulse * 0.35 + this.movingBlend * 0.15;

    // eyes: very subtle flicker, tied to chest pulse
    if (this.eyeL) {
      const eyeBright = 0.78 + pulse * 0.18;
      this.eyeL.material.opacity = eyeBright;
      this.eyeR.material.opacity = eyeBright;
      const eyeScale = 0.94 + pulse * 0.10;
      this.eyeL.scale.setScalar(eyeScale);
      this.eyeR.scale.setScalar(eyeScale);
    }

    // held lantern: pendulum dangle driven by body acceleration + walk bob,
    // with optional "raise" pose where the arm lifts the lantern overhead.
    if (this.heldLantern) {
      // ---- arm pose: rest vs raised (driven externally by lanternRaise) ----
      if (this.lanternRaise === undefined) this.lanternRaise = 0;
      if (this._lanternRaiseSmoothed === undefined) this._lanternRaiseSmoothed = 0;
      this._lanternRaiseSmoothed = THREE.MathUtils.damp(
        this._lanternRaiseSmoothed, this.lanternRaise, 4.0, dt,
      );
      const raise = this._lanternRaiseSmoothed;
      // rest: held out forward (0.46, 1.18, -0.32). Raised: lifted high
      // and slightly back, like an arm extended overhead.
      const restX = 0.46, restY = 1.18, restZ = -0.32;
      const upX  = 0.18, upY  = 2.05, upZ  = 0.05;
      this.heldLanternArm.position.set(
        THREE.MathUtils.lerp(restX, upX, raise),
        THREE.MathUtils.lerp(restY, upY, raise) + bob * (1 - raise * 0.6),
        THREE.MathUtils.lerp(restZ, upZ, raise),
      );
      // rotate the arm pivot back as it raises (so the lantern hangs over
      // the head, not in front of the chest)
      this.heldLanternArm.rotation.x = raise * -0.55;

      // ---- pendulum forces from body acceleration ----
      // Compare current world velocity to last frame's to get acceleration,
      // express it in the body's local frame, and apply as an angular impulse.
      const cs = Math.cos(this.bodyYaw);
      const sn = Math.sin(this.bodyYaw);
      const ax = (this.velocity.x - this._lanternPrevWorldVel.x) / Math.max(dt, 1e-4);
      const ay = (this.velocity.y - this._lanternPrevWorldVel.y) / Math.max(dt, 1e-4);
      const az = (this.velocity.z - this._lanternPrevWorldVel.z) / Math.max(dt, 1e-4);
      this._lanternPrevWorldVel.set(this.velocity.x, this.velocity.y, this.velocity.z);
      // local-axis acceleration: x = body-right, z = body-forward (-Z)
      const laxX =  cs * ax + sn * az;
      const laxZ = -sn * ax + cs * az;

      // pendulum equations: angle accel = -k*angle - c*vel + impulse
      // Forward acceleration tilts the lantern backward (pendulum lags).
      // Sideways acceleration tilts it sideways. Vertical acceleration
      // (jumps/landings) loosens it briefly.
      const STIFF = 28.0, DAMP = 4.6, IMP = 0.0024;
      this._lanternPendVX += (-STIFF * this._lanternPendX - DAMP * this._lanternPendVX) * dt;
      this._lanternPendVZ += (-STIFF * this._lanternPendZ - DAMP * this._lanternPendVZ) * dt;
      // forward accel -> rotate +X (pitch back); right accel -> rotate -Z
      this._lanternPendVX += laxZ * IMP;
      this._lanternPendVZ -= laxX * IMP;
      // vertical jolt: brief upward kick scrambles both axes a touch
      const jolt = ay * 0.0008;
      this._lanternPendVX += Math.sin(t * 7.3) * jolt;
      this._lanternPendVZ += Math.cos(t * 6.1) * jolt;
      this._lanternPendX += this._lanternPendVX * dt;
      this._lanternPendZ += this._lanternPendVZ * dt;
      // walk-bob driver — a small steady oscillation while moving
      const walkSwingX = Math.sin(this.walkPhase) * 0.08 * this.movingBlend;
      const walkSwingZ = Math.cos(this.walkPhase * 0.5) * 0.04 * this.movingBlend;
      // damp pendulum more aggressively when arm is raised (lantern held high)
      const raiseDamp = THREE.MathUtils.lerp(1.0, 0.35, raise);
      this.heldLantern.rotation.x = (this._lanternPendX + walkSwingX) * raiseDamp;
      this.heldLantern.rotation.z = (this._lanternPendZ + walkSwingZ) * raiseDamp;

      // ---- arm: orient + stretch the cylinder so it spans shoulder→hand ----
      if (this.heldLanternArmMesh) {
        const shoulder = this._lanternArmShoulder;
        // body-local hand position (where the lantern hangs from)
        const hx = this.heldLanternArm.position.x;
        const hy = this.heldLanternArm.position.y;
        const hz = this.heldLanternArm.position.z;
        const dx = hx - shoulder.x;
        const dy = hy - shoulder.y;
        const dz = hz - shoulder.z;
        const len = Math.max(0.05, Math.hypot(dx, dy, dz));
        TMP_V1.set(dx / len, dy / len, dz / len);
        // cylinder, after translate, has its tip at local -Y. Rotate so
        // local -Y aligns with the shoulder→hand direction.
        TMP_V2.set(0, -1, 0);
        TMP_Q.setFromUnitVectors(TMP_V2, TMP_V1);
        this.heldLanternArmMesh.quaternion.copy(TMP_Q);
        this.heldLanternArmMesh.position.copy(shoulder);
        this.heldLanternArmMesh.scale.set(1, len, 1);

        // hand knob: park it right at the lantern hand pivot
        if (this.heldLanternHandKnob) {
          this.heldLanternHandKnob.position.set(hx, hy, hz);
        }
      }

      // ---- lit visuals ----
      const f = THREE.MathUtils.clamp(this.heldLanternFlame, 0, 1);
      this.heldLanternGlassMat.color.setRGB(
        0.42 + 0.62 * f,
        0.36 + 0.55 * f,
        0.28 + 0.10 * f,
      );
      this.heldLanternGlassMat.opacity = 0.55 + 0.30 * f;
      this.heldLanternCoreMat.opacity = f * 0.95;
      this.heldLanternHaloMat.opacity = f * (0.55 + Math.sin(t * 1.4) * 0.10);
      this.heldLanternLight.intensity = f * (3.6 + Math.sin(t * 1.2) * 0.30);
      const ls = 1.0 + Math.sin(t * 1.6) * 0.05 * f;
      this.heldLanternCore.scale.setScalar(ls);
    }

    // chest fragments: slow idle rotation
    if (this.chestFragments) {
      for (let i = 0; i < this.chestFragments.length; i++) {
        const f = this.chestFragments[i];
        f.rotation.x += dt * (0.15 + i * 0.05) * (this.movingBlend * 0.6 + 0.4);
        f.rotation.y -= dt * (0.10 + i * 0.04) * (this.movingBlend * 0.5 + 0.3);
      }
    }

    // ---- footstep events ----
    this.footstepTimer += phaseSpeed * dt;
    // detect zero-crossings of sin(walkPhase)
    const s = Math.sin(this.walkPhase);
    const sPrev = this._lastSin ?? s;
    this._lastSin = s;
    if (this.movingBlend > 0.5 && this.onGround && Math.sign(s) !== Math.sign(sPrev)) {
      const foot = s > 0 ? "L" : "R";
      this.lastFootStep = foot;
      if (this.onFootstep) {
        this.onFootstep(
          foot,
          this.position,
          this.velocity,
          this.sprintBlend,
        );
      }
    }

    // ---- update camera ----
    this._updateCamera(dt);

    // ---- wind for cone cloak + ribbons ----
    // a gentle cross-wind, strengthened by player speed (ram-air).
    const wind = TMP_V1.set(
      -1.6 + Math.sin(t * 0.6) * 0.3,
      0.05 + Math.sin(t * 0.31) * 0.05,
      Math.sin(t * 0.45) * 0.2,
    );
    wind.addScaledVector(this.velocity, -0.55);

    // cone cloak shader uniforms — outer + inner liner share these.
    // motion drives the trailing-hem flare; let walking add a bit of flare
    // too (not just sprinting) so the cloak reads as flowy at all speeds.
    if (this._cloakUniforms) {
      this._cloakUniforms.uTime.value = t;
      this._cloakUniforms.uWind.value.copy(wind).multiplyScalar(0.5);
      this._cloakUniforms.uMotion.value =
        this.movingBlend * (0.45 + 0.55 * this.sprintBlend);
      // sync rune throb with the chest core's pulse — same heartbeat
      this._cloakUniforms.uPulse.value = pulse;

      // Smooth velocity in WORLD space first, then rotate into body-local.
      // If we smoothed in body-local, a fast turn rotates the frame faster
      // than the smoother can keep up, which manifests as a phantom lateral
      // acceleration on the hem — the "side flip while turning" artifact.
      this._cloakLagWorld.x = THREE.MathUtils.damp(this._cloakLagWorld.x, this.velocity.x, 6.0, dt);
      this._cloakLagWorld.y = THREE.MathUtils.damp(this._cloakLagWorld.y, this.velocity.y, 7.0, dt);
      this._cloakLagWorld.z = THREE.MathUtils.damp(this._cloakLagWorld.z, this.velocity.z, 6.0, dt);

      const cs = Math.cos(this.bodyYaw);
      const sn = Math.sin(this.bodyYaw);
      const lvx =  cs * this._cloakLagWorld.x + sn * this._cloakLagWorld.z;
      const lvz = -sn * this._cloakLagWorld.x + cs * this._cloakLagWorld.z;
      // soft-clamp lateral magnitude so sprint-speed turns don't yank the hem
      const HMAX = 7.0;
      const hMag = Math.hypot(lvx, lvz);
      const hScale = hMag > HMAX ? HMAX / hMag : 1.0;
      this._cloakUniforms.uLag.value.set(
        lvx * hScale,
        this._cloakLagWorld.y,
        lvz * hScale,
      );

      // airborne 0..1 — drives extra in-air flutter
      const airTarget = this.onGround ? 0 : 1;
      this._cloakUniforms.uAirborne.value = THREE.MathUtils.damp(
        this._cloakUniforms.uAirborne.value, airTarget, 5.0, dt,
      );
    }

    // ribbons (lighter ram-air)
    if (this.ribbons) {
      const ribbonWind = TMP_V2.copy(wind);
      ribbonWind.addScaledVector(this.velocity, -0.4);
      for (const r of this.ribbons) {
        r.update(dt, ribbonWind, this.world, { gravity: -3.0 });
      }
    }

    // verlet trailing cape — flows physically behind the player
    if (this.trailingCape) {
      this.trailingCape.update(dt, this.shoulderAnchor, this.velocity, wind, this.world);
    }
  }

  /* -----------------------------------------------------------
   * Camera follower: orbit around the player at offset(yaw,pitch),
   * lerp smoothly, look at a point slightly above the player's
   * head so the framing stays nice.
   * --------------------------------------------------------- */
  _updateCamera(dt) {
    this.cameraDist = THREE.MathUtils.damp(
      this.cameraDist, this.targetCameraDist, 4, dt,
    );

    const cy = this.cameraYaw;
    const cp = this.cameraPitch;

    const offset = TMP_V1.set(
      Math.sin(cy) * Math.cos(cp),
      -Math.sin(cp),
      Math.cos(cy) * Math.cos(cp),
    ).multiplyScalar(this.cameraDist);

    // Use the smoothed visual y so the camera's lookAt direction doesn't
    // jerk every time the player snaps up a stair step.
    const lookTarget = TMP_V2.copy(this.position);
    lookTarget.y = (this._visualY ?? this.position.y) + 1.5;

    const desired = TMP_V3.copy(lookTarget).add(offset);

    // simple terrain clip: keep the camera at least 0.6m above ground
    const groundY = this.world.getHeight(desired.x, desired.z) + 0.6;
    if (desired.y < groundY) desired.y = groundY;

    // smooth follow
    this.camera.position.x = THREE.MathUtils.damp(this.camera.position.x, desired.x, 6, dt);
    this.camera.position.y = THREE.MathUtils.damp(this.camera.position.y, desired.y, 6, dt);
    this.camera.position.z = THREE.MathUtils.damp(this.camera.position.z, desired.z, 6, dt);

    this.camera.lookAt(lookTarget);
  }

  /* -----------------------------------------------------------
   * Distance to the arch (used for HUD compass and ending).
   * --------------------------------------------------------- */
  distanceToArch() {
    // legacy helper — kept so external callers don't crash. Returns the
    // distance to whatever the world considers the focal point (now the
    // shrine/cliff anchor).
    return this.world.archTrigger
      ? this.position.distanceTo(this.world.archTrigger)
      : 0;
  }
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
