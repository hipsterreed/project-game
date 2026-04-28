import * as THREE from 'three';

/**
 * Inject wind/sway animation into a standard material's vertex shader.
 * The sway grows with the vertex's local Y so trunks stay still while leaves move.
 * Pass `windStrength` to scale the effect (e.g. 1.0 trees, 1.4 grass).
 */
export function applyWind(material, { windStrength = 1.0, windFreq = 1.0, anchorY = 0 } = {}) {
  material.userData.uTime = { value: 0 };
  material.userData.uWindStrength = { value: windStrength };
  material.userData.uWindFreq = { value: windFreq };
  material.userData.uAnchorY = { value: anchorY };

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = material.userData.uTime;
    shader.uniforms.uWindStrength = material.userData.uWindStrength;
    shader.uniforms.uWindFreq = material.userData.uWindFreq;
    shader.uniforms.uAnchorY = material.userData.uAnchorY;

    shader.vertexShader = `
      uniform float uTime;
      uniform float uWindStrength;
      uniform float uWindFreq;
      uniform float uAnchorY;
    ` + shader.vertexShader;

    // Apply displacement to the vertex position before built-in transforms
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
        vec3 transformed = vec3( position );

        // local-space wind displacement
        float t = uTime * uWindFreq;

        // base sway along x
        float sway1 = sin(t * 0.9 + position.x * 0.18 + position.z * 0.13) * 0.45;
        // higher-frequency leaf rustle
        float sway2 = sin(t * 2.2 + position.y * 1.4) * 0.18;
        // very slow gust modulation
        float gust = (sin(t * 0.13) * 0.5 + 0.5);

        float sway = (sway1 + sway2) * (0.5 + gust * 0.6);

        // anchor base of object (y near anchorY) so it doesn't slide
        float h = max(0.0, position.y - uAnchorY);
        float weight = pow(h, 1.4);

        transformed.x += sway * weight * uWindStrength;
        transformed.z += sway * 0.5 * weight * uWindStrength;
        transformed.y += sin(t * 1.7 + position.x * 0.4) * 0.04 * weight * uWindStrength;
      `
    );

    material._shader = shader;
  };

  return material;
}

export function tickWindMaterials(materials, time) {
  for (const m of materials) {
    if (m.userData && m.userData.uTime) {
      m.userData.uTime.value = time;
    }
  }
}
