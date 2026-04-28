import * as THREE from "three";

// ---- shared wind chunk used by trees + grass ----
export const windFunctions = /* glsl */ `
  // simple cheap multi-octave wind based on world position + time
  float windSample(vec3 worldPos, float t) {
    float w =
      sin(worldPos.x * 0.32 + t * 1.1) * 0.55 +
      sin(worldPos.z * 0.27 - t * 0.9) * 0.45 +
      sin((worldPos.x + worldPos.z) * 0.6 + t * 2.1) * 0.18;
    return w;
  }
`;

// ---- grass blade shader (used on InstancedMesh) ----
export const grassVertexShader = /* glsl */ `
  attribute vec3 instanceOffset;
  attribute float instanceScale;
  attribute float instanceRot;
  attribute float instanceVariant;

  uniform float uTime;
  uniform float uWindStrength;
  uniform vec3 uPlayerPos;

  varying float vHeight;
  varying float vVariant;
  varying vec3 vWorldPos;

  ${windFunctions}

  mat2 rot(float a){
    float s = sin(a), c = cos(a);
    return mat2(c, -s, s, c);
  }

  void main() {
    vec3 pos = position;
    pos.xz *= rot(instanceRot);
    pos *= instanceScale;
    vec3 worldPos = pos + instanceOffset;

    // vertical mask: only top of the blade bends
    float bend = smoothstep(0.0, 1.0, position.y);
    float w = windSample(worldPos, uTime) * uWindStrength;
    worldPos.x += w * bend * 0.45;
    worldPos.z += w * bend * 0.25;

    // gentle push away from player so grass parts at feet
    vec2 toPlayer = worldPos.xz - uPlayerPos.xz;
    float d = length(toPlayer);
    float push = smoothstep(1.6, 0.2, d) * bend;
    if (d > 0.001) {
      vec2 dir = toPlayer / d;
      worldPos.xz += dir * push * 0.35;
    }

    vHeight = position.y;
    vVariant = instanceVariant;
    vWorldPos = worldPos;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(worldPos, 1.0);
  }
`;

export const grassFragmentShader = /* glsl */ `
  precision highp float;

  uniform vec3 uColorBase;
  uniform vec3 uColorTip;
  uniform vec3 uColorWarm;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform vec3 uCameraPos;
  uniform float uTime;
  uniform vec3 uSunDir;

  varying float vHeight;
  varying float vVariant;
  varying vec3 vWorldPos;

  void main() {
    // gradient base->tip
    vec3 col = mix(uColorBase, uColorTip, smoothstep(0.0, 1.0, vHeight));
    // warm rim of variation
    col = mix(col, uColorWarm, vVariant * 0.35 * vHeight);
    // sun-side highlight
    float sunWrap = clamp(dot(normalize(vec3(uSunDir.x, 0.4, uSunDir.z)), normalize(vec3(1.0, 0.0, 0.0))) * 0.5 + 0.5, 0.0, 1.0);
    col += vec3(0.18, 0.10, 0.04) * sunWrap * vHeight;

    // distance fog
    float dist = length(uCameraPos - vWorldPos);
    float f = smoothstep(uFogNear, uFogFar, dist);
    col = mix(col, uFogColor, f);

    if (vHeight < 0.02) discard; // (no AO under base)
    gl_FragColor = vec4(col, 1.0);
  }
`;

// ---- tree foliage shader (sway) ----
export const foliageVertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uWindStrength;

  varying vec3 vWorldPos;
  varying float vSway;

  ${windFunctions}

  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    float trunkBase = wp.y;
    float h = clamp((position.y) / 6.0, 0.0, 1.0);
    float w = windSample(wp.xyz, uTime);
    float sway = w * h * h * uWindStrength;
    wp.x += sway * 0.5;
    wp.z += sway * 0.3;

    vWorldPos = wp.xyz;
    vSway = w * 0.5 + 0.5;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

export const foliageFragmentShader = /* glsl */ `
  precision highp float;

  uniform vec3 uColor;
  uniform vec3 uColorWarm;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform vec3 uCameraPos;
  uniform vec3 uSunDir;

  varying vec3 vWorldPos;
  varying float vSway;

  void main() {
    vec3 col = mix(uColor, uColorWarm, vSway * 0.5);

    // crude rim toward sun
    vec3 viewDir = normalize(uCameraPos - vWorldPos);
    float rim = pow(1.0 - max(dot(viewDir, normalize(vec3(0.0, 1.0, 0.0))), 0.0), 2.0);
    col += vec3(0.30, 0.18, 0.07) * rim * 0.7;

    float dist = length(uCameraPos - vWorldPos);
    float f = smoothstep(uFogNear, uFogFar, dist);
    col = mix(col, uFogColor, f);

    gl_FragColor = vec4(col, 1.0);
  }
`;

// ---- subtle warm-grade tone shader (post pass) ----
export const ToneMapShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.85 },
    uWarmth: { value: 0.08 },
    uContrast: { value: 1.06 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uVignette;
    uniform float uWarmth;
    uniform float uContrast;
    varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      // contrast around 0.5
      c.rgb = (c.rgb - 0.5) * uContrast + 0.5;
      // warm tint
      c.rgb += vec3(uWarmth, uWarmth * 0.5, -uWarmth * 0.3) * 0.5;
      // vignette
      vec2 q = vUv - 0.5;
      float v = smoothstep(0.85, 0.2, length(q));
      c.rgb *= mix(1.0, v, uVignette * 0.55);
      gl_FragColor = vec4(c.rgb, 1.0);
    }
  `,
};
