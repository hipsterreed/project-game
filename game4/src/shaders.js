import * as THREE from "three";

/* -----------------------------------------------------------
 * Sky shader
 *   pale-warm desert sky with a low sun glare.
 *   gradient: hot bone-white at horizon -> warm gold mid ->
 *   washed indigo at zenith (very subtle, mostly washed-out).
 * --------------------------------------------------------- */
export const SkyShader = {
  uniforms: {
    // pale-warm horizon → cool teal mid → soft seafoam zenith.
    // Reads as a high desert sky tinged with an otherworldly green-blue
    // so the planets feel uncanny rather than just decorative.
    uHorizon:   { value: new THREE.Color("#f3ddc0") },
    uMid:       { value: new THREE.Color("#a8d0c8") },
    uZenith:    { value: new THREE.Color("#7fbcb6") },
    uSunDir:    { value: new THREE.Vector3(0.4, 0.18, -0.9).normalize() },
    uSunColor:  { value: new THREE.Color("#ffd28a") },
    // distant planets hanging off the back of the sky — each one has its
    // own direction, angular radius, lit-side / dark-side color, and a
    // ring (size + color) that draws a thin halo.
    uPlanetDir:    { value: new THREE.Vector3(-0.55, 0.35, 0.78).normalize() },
    uPlanetSize:   { value: 0.085 },                         // ~apparent radius
    uPlanetColor:  { value: new THREE.Color("#d8b69a") },    // pale dusty rose
    uPlanetShade:  { value: new THREE.Color("#2c2238") },    // night side
    uPlanetRing:   { value: 1.55 },                          // ring outer radius (× planet size)
    uPlanetRingColor: { value: new THREE.Color("#e6cfb0") },
    // a smaller, more mysterious second planet on the opposite side of sky
    uPlanet2Dir:   { value: new THREE.Vector3(0.62, 0.22, 0.74).normalize() },
    uPlanet2Size:  { value: 0.034 },
    uPlanet2Color: { value: new THREE.Color("#9ec6c0") },    // pale teal
    uPlanet2Shade: { value: new THREE.Color("#1a2a3a") },    // deep blue night side
    uTime:      { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec3 vWorldDir;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldDir = normalize(wp.xyz);
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: /* glsl */`
    uniform vec3 uHorizon;
    uniform vec3 uMid;
    uniform vec3 uZenith;
    uniform vec3 uSunDir;
    uniform vec3 uSunColor;
    uniform vec3 uPlanetDir;
    uniform float uPlanetSize;
    uniform vec3 uPlanetColor;
    uniform vec3 uPlanetShade;
    uniform float uPlanetRing;
    uniform vec3 uPlanetRingColor;
    uniform vec3 uPlanet2Dir;
    uniform float uPlanet2Size;
    uniform vec3 uPlanet2Color;
    uniform vec3 uPlanet2Shade;
    uniform float uTime;
    varying vec3 vWorldDir;

    // cheap procedural surface noise so the planets aren't flat discs.
    float pnHash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }
    float pnNoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      float a = pnHash(i);
      float b = pnHash(i + vec2(1.0, 0.0));
      float c = pnHash(i + vec2(0.0, 1.0));
      float d = pnHash(i + vec2(1.0, 1.0));
      return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
    }
    float pnFbm(vec2 p) {
      float v = 0.0; float a = 0.5;
      for (int i = 0; i < 4; i++) {
        v += a * pnNoise(p);
        p *= 2.07;
        a *= 0.5;
      }
      return v;
    }

    /* Render a single body. Returns (rgb, coverage) packed into vec4
     * so the caller can blend it over the sky gradient. The planet
     * has a banded surface, a sun-lit terminator, a thin atmospheric
     * rim, and an optional ring whose ellipse follows the body's
     * local frame. ringR is the ring's outer radius in units of body
     * radius — set <= 1.0 to disable. */
    vec4 renderPlanet(vec3 dir, vec3 pdir, float bodyR, float ringR,
                      vec3 surfColor, vec3 shadeColor, vec3 ringColor,
                      vec3 sunDir, float seedOff) {
      vec3 up = normalize(cross(pdir, vec3(0.0, 1.0, 0.0)) + vec3(1e-4));
      vec3 right = normalize(cross(up, pdir));

      // local 2D coord with units of body radius
      float u = dot(dir - pdir, right) / max(bodyR, 1e-4);
      float v = dot(dir - pdir, up)    / max(bodyR, 1e-4);
      float r2 = u * u + v * v;

      vec3 col = vec3(0.0);
      float cov = 0.0;

      // ring: a thin elliptical band on the body's equatorial plane.
      if (ringR > 1.0) {
        // distance from the equator line in body-local coords (squashed
        // along the projection so the ring reads tilted, not circular).
        float ringRadial = sqrt(u * u + v * v * 4.5);
        // ring band shape: an inner gap, then dust, then outer fade.
        float ringInner = 1.18;
        float ringMask = smoothstep(ringInner, ringInner + 0.04, ringRadial)
                       * (1.0 - smoothstep(ringR - 0.06, ringR, ringRadial));
        // a cheap grain so the ring has banded structure
        float band = pnNoise(vec2(ringRadial * 28.0 + seedOff, 0.0));
        ringMask *= 0.55 + band * 0.45;
        // hide the part of the ring that's behind the planet
        if (r2 < 1.0 && v < 0.0) ringMask *= 0.25;
        col += ringColor * ringMask;
        cov  = max(cov, ringMask * 0.85);
      }

      // body: only inside the disc.
      if (r2 < 1.0) {
        // body coverage (anti-aliased edge)
        float disc = 1.0 - smoothstep(0.94, 1.0, r2);
        // surface normal on a sphere
        vec3 n = normalize(right * u + up * v + pdir * sqrt(max(0.0, 1.0 - r2)));
        float lambert = max(dot(n, normalize(sunDir)), 0.0);
        // banded "atmosphere" / surface noise driven by latitude (v).
        float bands = pnFbm(vec2(u * 1.4 + seedOff, v * 5.0));
        float lat   = sin(v * 5.5 + bands * 1.4) * 0.5 + 0.5;
        vec3 base   = mix(surfColor * 0.85, surfColor * 1.15, lat);
        // gently tint the dark hemisphere so the night side reads cooler
        vec3 surf   = mix(shadeColor, base, lambert);
        // soft terminator glow
        float term = smoothstep(0.0, 0.25, lambert) * (1.0 - smoothstep(0.0, 0.6, lambert));
        surf += surfColor * term * 0.18;
        // atmospheric rim
        float rim = smoothstep(0.86, 1.0, r2);
        surf += surfColor * rim * 0.45;
        // very faint inner glow on the lit limb
        surf += vec3(1.0) * pow(max(0.0, dot(n, sunDir)), 6.0) * 0.05;
        col = mix(col, surf, disc);
        cov = max(cov, disc);
      }
      return vec4(col, cov);
    }

    void main() {
      vec3 dir = normalize(vWorldDir);
      float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);

      // base gradient: warm horizon -> teal mid -> cooler zenith.
      vec3 col = mix(uHorizon, uMid, smoothstep(0.42, 0.62, h));
      col = mix(col, uZenith, smoothstep(0.65, 1.0, h));

      // very subtle vertical color shift toward sun azimuth so the
      // sky doesn't read as an exact ring of gradient.
      float azimuthMix = clamp(dot(normalize(vec3(dir.x, 0.0, dir.z)),
                                   normalize(vec3(uSunDir.x, 0.0, uSunDir.z))) * 0.5 + 0.5, 0.0, 1.0);
      col += vec3(0.04, 0.015, -0.01) * azimuthMix * smoothstep(0.0, 0.55, h);

      // ---- Planets (large ringed gas giant + smaller teal moon-world) ----
      // Render each planet, then composite onto the sky with its coverage.
      vec3 sunDir = normalize(uSunDir);

      vec4 p1 = renderPlanet(dir, normalize(uPlanetDir), uPlanetSize, uPlanetRing,
                             uPlanetColor, uPlanetShade, uPlanetRingColor, sunDir, 17.3);
      col = mix(col, p1.rgb, clamp(p1.a, 0.0, 1.0));

      vec4 p2 = renderPlanet(dir, normalize(uPlanet2Dir), uPlanet2Size, 0.0,
                             uPlanet2Color, uPlanet2Shade, vec3(0.0), sunDir, 41.7);
      col = mix(col, p2.rgb, clamp(p2.a, 0.0, 1.0));

      // sun disc + halo (toned down — gentler late-afternoon sun)
      float s = max(dot(dir, normalize(uSunDir)), 0.0);
      col += uSunColor * pow(s, 380.0) * 0.85;
      col += uSunColor * pow(s, 32.0)  * 0.20;
      col += uSunColor * pow(s, 5.0)   * 0.06;

      // horizon haze near sun
      float horizonBand = smoothstep(0.55, 0.45, h);
      col += uSunColor * horizonBand * pow(s, 2.0) * 0.10;

      // slight grain so the sky isn't dead flat
      float n2 = fract(sin(dot(dir.xy, vec2(12.9898,78.233))) * 43758.5453);
      col += (n2 - 0.5) * 0.005;

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

/* -----------------------------------------------------------
 * Sand surface shader
 *   warm dune surface with a subtle ripple normal,
 *   wind-direction shading, sun specular hot-spot,
 *   distance-based hue shift toward horizon haze.
 * --------------------------------------------------------- */
export const SandShader = {
  uniforms: {
    uColorLow:  { value: new THREE.Color("#b89564") },
    uColorMid:  { value: new THREE.Color("#e8c98a") },
    uColorHigh: { value: new THREE.Color("#fff1c4") },
    uShadow:    { value: new THREE.Color("#5b3a20") },
    uHaze:      { value: new THREE.Color("#cfd9c2") },
    uSunDir:    { value: new THREE.Vector3(0.4, 0.18, -0.9).normalize() },
    uSunColor:  { value: new THREE.Color("#ffd28a") },
    uTime:      { value: 0 },
    uFogNear:   { value: 60.0 },
    uFogFar:    { value: 380.0 },
  },
  vertexShader: /* glsl */`
    varying vec3 vWorldPos;
    varying vec3 vNormal;
    varying float vSlope;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldPos = wp.xyz;
      vec3 n = normalize(mat3(modelMatrix) * normal);
      vNormal = n;
      vSlope = 1.0 - clamp(n.y, 0.0, 1.0);
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: /* glsl */`
    uniform vec3 uColorLow;
    uniform vec3 uColorMid;
    uniform vec3 uColorHigh;
    uniform vec3 uShadow;
    uniform vec3 uHaze;
    uniform vec3 uSunDir;
    uniform vec3 uSunColor;
    uniform float uTime;
    uniform float uFogNear;
    uniform float uFogFar;

    varying vec3 vWorldPos;
    varying vec3 vNormal;
    varying float vSlope;

    // 2d hash
    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }
    // value noise
    float vnoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f*f*(3.0-2.0*f);
      float a = hash(i);
      float b = hash(i + vec2(1.0,0.0));
      float c = hash(i + vec2(0.0,1.0));
      float d = hash(i + vec2(1.0,1.0));
      return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
    }
    float fbm(vec2 p) {
      float v = 0.0;
      float a = 0.5;
      for (int i = 0; i < 4; i++) {
        v += a * vnoise(p);
        p *= 2.03;
        a *= 0.5;
      }
      return v;
    }

    void main() {
      vec3 wp = vWorldPos;

      // ripple normal: oriented mostly along wind dir (x)
      // small ripples ~0.6m, slow drift
      vec2 rp = wp.xz * 1.6 + vec2(uTime * 0.05, 0.0);
      float r1 = sin(rp.x * 4.0 + fbm(rp * 0.6) * 6.0) * 0.5 + 0.5;
      float r2 = sin(rp.x * 8.0 + fbm(rp * 1.3) * 4.0) * 0.5 + 0.5;
      float ripple = r1 * 0.7 + r2 * 0.3;

      // perturbed normal (cheap)
      vec3 n = normalize(vNormal + vec3(
        (ripple - 0.5) * 0.18,
        0.0,
        (fbm(rp * 0.9) - 0.5) * 0.06
      ));

      // base gradient by elevation: dune crests catch warm light
      float crest = smoothstep(-2.0, 12.0, wp.y);
      vec3 base = mix(uColorLow, uColorMid, crest);
      base = mix(base, uColorHigh, smoothstep(8.0, 16.0, wp.y) * 0.7);

      // ripple modulation
      base = mix(base * 0.92, base * 1.08, ripple);

      // sun lambert + warm sun colour
      float ndl = max(dot(n, normalize(uSunDir)), 0.0);
      vec3 lit = base * (0.35 + 0.85 * ndl);
      lit += uSunColor * ndl * 0.18;

      // shadow tint in occluded slope-side
      float backlight = max(-dot(n, normalize(uSunDir)), 0.0);
      lit = mix(lit, uShadow, backlight * 0.35);

      // specular hot-spot (subtle, dunes glint)
      vec3 viewDir = normalize(cameraPosition - wp);
      vec3 halfDir = normalize(normalize(uSunDir) + viewDir);
      float spec = pow(max(dot(n, halfDir), 0.0), 24.0);
      lit += uSunColor * spec * 0.12 * crest;

      // slope -> exposed darker rock-ish underside
      lit = mix(lit, uShadow * 1.4, smoothstep(0.55, 0.85, vSlope) * 0.35);

      // fog / haze
      float dist = length(cameraPosition - wp);
      float fog = clamp((dist - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
      // ease in
      fog = fog * fog * (3.0 - 2.0 * fog);
      lit = mix(lit, uHaze, fog * 0.92);

      gl_FragColor = vec4(lit, 1.0);
    }
  `,
};

/* -----------------------------------------------------------
 * Cloak shader
 *   double sided, soft warm tint, simple wrap lighting,
 *   slight rim from the sun.
 * --------------------------------------------------------- */
export const CloakShader = {
  uniforms: {
    uColorBase: { value: new THREE.Color("#c64a36") },
    uColorEdge: { value: new THREE.Color("#ffb066") },
    uColorBack: { value: new THREE.Color("#7a2418") },
    uSunDir:    { value: new THREE.Vector3(0.4, 0.18, -0.9).normalize() },
    uSunColor:  { value: new THREE.Color("#ffd28a") },
    uTime:      { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec3 vNormal;
    varying vec3 vWorldPos;
    varying vec2 vUv;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldPos = wp.xyz;
      vNormal = normalize(mat3(modelMatrix) * normal);
      vUv = uv;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: /* glsl */`
    uniform vec3 uColorBase;
    uniform vec3 uColorEdge;
    uniform vec3 uColorBack;
    uniform vec3 uSunDir;
    uniform vec3 uSunColor;
    uniform float uTime;
    varying vec3 vNormal;
    varying vec3 vWorldPos;
    varying vec2 vUv;

    void main() {
      vec3 n = normalize(vNormal);
      // double sided: gl_FrontFacing tells us which side we're on
      if (!gl_FrontFacing) n = -n;

      vec3 viewDir = normalize(cameraPosition - vWorldPos);
      vec3 sun = normalize(uSunDir);
      float ndl = max(dot(n, sun), 0.0);
      // soft wrap
      float wrap = (dot(n, sun) * 0.5 + 0.5);

      // base shading
      vec3 base = uColorBase;
      // edges (top of cloth, lighter)
      float topMix = smoothstep(0.0, 1.0, vUv.y);
      base = mix(uColorBack, base, topMix);

      vec3 lit = base * (0.35 + 0.75 * wrap);
      lit += uSunColor * pow(ndl, 2.0) * 0.25;

      // rim from sun
      float rim = 1.0 - max(dot(viewDir, n), 0.0);
      lit += uColorEdge * pow(rim, 3.0) * 0.7 * (0.4 + 0.6 * ndl);

      // backside subtle
      if (!gl_FrontFacing) {
        lit *= 0.85;
      }

      gl_FragColor = vec4(lit, 1.0);
    }
  `,
};

/* -----------------------------------------------------------
 * ToneMap shader (post pass)
 *   gentle warm lift in shadows, mild contrast, vignette.
 * --------------------------------------------------------- */
export const ToneMapShader = {
  uniforms: {
    tDiffuse:    { value: null },
    uTime:       { value: 0 },
    uVignette:   { value: 1.0 },
    uWarmLift:   { value: new THREE.Color("#3a2210") },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){
      vUv = uv;
      gl_Position = vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uVignette;
    uniform vec3 uWarmLift;
    varying vec2 vUv;

    void main() {
      vec4 c = texture2D(tDiffuse, vUv);

      // shadow lift toward warm
      float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      float shadowMask = smoothstep(0.18, 0.0, lum);
      c.rgb = mix(c.rgb, c.rgb + uWarmLift * 0.65, shadowMask);

      // mild contrast (s-curve)
      c.rgb = mix(vec3(0.5), c.rgb, 1.06);

      // vignette
      vec2 uv = vUv - 0.5;
      float v = 1.0 - dot(uv, uv) * 1.25 * uVignette;
      v = clamp(v, 0.0, 1.0);
      c.rgb *= mix(0.55, 1.0, v);

      // grain
      float n = fract(sin(dot(vUv * (uTime * 0.5 + 1.0),
                              vec2(12.9898, 78.233))) * 43758.5453);
      c.rgb += (n - 0.5) * 0.012;

      gl_FragColor = vec4(c.rgb, 1.0);
    }
  `,
};

/* -----------------------------------------------------------
 * Wind streak shader
 *   Elongated billboard aligned to the particle's velocity in
 *   world space and rotated to face the camera. Reads as
 *   directional motion blur of dust, so the wind becomes
 *   visually legible without any per-pixel effects.
 *   Per-instance attributes: iPos (vec3), iVel (vec3),
 *   iLife (float), iSize (float), iSeed (float).
 * --------------------------------------------------------- */
export const WindStreakShader = {
  uniforms: {
    uColor:    { value: new THREE.Color("#f6efde") },
    uHaze:     { value: new THREE.Color("#cfd9c2") },
    uOpacity:  { value: 0.55 },
    uTime:     { value: 0 },
  },
  vertexShader: /* glsl */`
    attribute vec3 iPos;
    attribute vec3 iVel;
    attribute float iLife;
    attribute float iSize;
    attribute float iSeed;
    varying float vLife;
    varying vec2 vUv;
    varying vec3 vWorld;
    varying float vAlongFade;

    void main() {
      vLife = iLife;
      vUv = uv;

      float speed = length(iVel);
      vec3 vDir = speed > 0.001 ? iVel / speed : vec3(1.0, 0.0, 0.0);

      // Build a basis: along-wind axis + cross product with view ray
      // so the streak quad lies in the plane that faces the camera.
      vec3 toCam = cameraPosition - iPos;
      vec3 vSide = cross(vDir, toCam);
      float sideLen = length(vSide);
      vSide = sideLen > 0.001 ? vSide / sideLen : vec3(0.0, 1.0, 0.0);

      // Life envelope so streaks ease in and out smoothly. Multiplying
      // through to size collapses dead instances to zero area so they
      // don't show up between life cycles.
      float fadeIn  = smoothstep(0.0, 0.18, iLife);
      float fadeOut = 1.0 - smoothstep(0.55, 1.0, iLife);
      float scale   = iSize * fadeIn * fadeOut;

      // Streak length scales with both base size and wind speed,
      // capped so very strong gusts don't draw absurdly long lines.
      float lengthScale = scale * (6.5 + min(speed, 6.0) * 1.1);
      float thickScale  = scale * 0.32;

      // position.x in [-0.5, 0.5] runs along the streak,
      // position.y across it.
      vec3 wp = iPos
        + vDir  * position.x * lengthScale
        + vSide * position.y * thickScale;

      vWorld = wp;
      // Use the leading head so the streak fades behind a sharper tip.
      vAlongFade = position.x + 0.5;
      gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform vec3 uColor;
    uniform vec3 uHaze;
    uniform float uOpacity;
    varying float vLife;
    varying vec2 vUv;
    varying vec3 vWorld;
    varying float vAlongFade;

    void main() {
      // Soft falloff across the streak (round in the y axis).
      float across = 1.0 - smoothstep(0.0, 0.5, abs(vUv.y - 0.5));
      // Taper at both ends; head a touch sharper than the tail.
      float headFade = smoothstep(0.0, 0.18, vAlongFade);
      float tailFade = 1.0 - smoothstep(0.7, 1.0, vAlongFade);
      float along = headFade * tailFade;

      float a = along * across;

      // Life envelope (matches the vertex shader).
      float fadeIn  = smoothstep(0.0, 0.18, vLife);
      float fadeOut = 1.0 - smoothstep(0.55, 1.0, vLife);
      a *= fadeIn * fadeOut;

      // Distance haze so far-off streaks blend into the desert haze.
      float dist = length(cameraPosition - vWorld);
      float fog = clamp((dist - 60.0) / (380.0 - 60.0), 0.0, 1.0);
      vec3 col = mix(uColor, uHaze, fog * 0.85);

      gl_FragColor = vec4(col, a * uOpacity);
    }
  `,
};

/* -----------------------------------------------------------
 * Sand particle shader
 *   billboard quad, soft round alpha, warm tint, fade by life.
 *   Used by an InstancedBufferGeometry whose base geometry is
 *   a unit quad with 'position' in [-0.5, 0.5] and standard 'uv'.
 *   Per-instance attributes: iPos (vec3), iLife (float 0..1),
 *   iSize (float), iSeed (float).
 * --------------------------------------------------------- */
export const SandParticleShader = {
  uniforms: {
    uColor:    { value: new THREE.Color("#f4d49a") },
    uSunColor: { value: new THREE.Color("#ffd28a") },
    uHaze:     { value: new THREE.Color("#cfd9c2") },
    uTime:     { value: 0 },
    uOpacity:  { value: 1.0 },
  },
  vertexShader: /* glsl */`
    attribute vec3 iPos;
    attribute float iLife;
    attribute float iSize;
    attribute float iSeed;
    varying float vLife;
    varying float vSeed;
    varying vec2 vUv;
    varying vec3 vWorld;

    void main() {
      vLife = iLife;
      vSeed = iSeed;
      vUv = uv;
      // billboard in view space
      vec4 mv = viewMatrix * vec4(iPos, 1.0);
      float fadeIn = smoothstep(0.0, 0.15, iLife);
      float fadeOut = 1.0 - smoothstep(0.55, 1.0, iLife);
      float s = iSize * fadeIn * fadeOut;
      mv.xy += position.xy * s;
      vWorld = iPos;
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: /* glsl */`
    uniform vec3 uColor;
    uniform vec3 uSunColor;
    uniform vec3 uHaze;
    uniform float uTime;
    uniform float uOpacity;
    varying float vLife;
    varying float vSeed;
    varying vec2 vUv;
    varying vec3 vWorld;

    void main() {
      vec2 q = vUv - 0.5;
      float r = length(q);
      // soft puff
      float a = smoothstep(0.5, 0.05, r);
      // life fade
      float fadeIn = smoothstep(0.0, 0.15, vLife);
      float fadeOut = 1.0 - smoothstep(0.55, 1.0, vLife);
      a *= fadeIn * fadeOut;

      // colour: warm core, fade toward haze
      vec3 col = mix(uSunColor, uColor, smoothstep(0.0, 0.4, vLife));
      col = mix(col, uHaze, smoothstep(0.4, 1.0, vLife));

      // distance haze (cheap)
      float dist = length(cameraPosition - vWorld);
      float fog = clamp((dist - 60.0) / (380.0 - 60.0), 0.0, 1.0);
      col = mix(col, uHaze, fog * 0.7);

      gl_FragColor = vec4(col, a * uOpacity);
    }
  `,
};
