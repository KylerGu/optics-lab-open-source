import * as THREE from 'three';

export interface GaussianBeamShaderOptions {
  darkroom?: boolean;
  powerRatio?: number;
}

/**
 * Creates a physical Tyndall-like volumetric Gaussian beam ShaderMaterial
 * using radial Gaussian falloff and axial energy density (w_min / w(z)).
 */
export function createGaussianBeamMaterial(
  color: THREE.ColorRepresentation,
  minWaistRadiusMm: number,
  options: GaussianBeamShaderOptions = {},
): THREE.ShaderMaterial {
  const baseColor = new THREE.Color(color);
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uColor: { value: baseColor },
      uMinWaist: { value: Math.max(minWaistRadiusMm, 0.05) },
      uPower: { value: Math.max(0, Math.min(1.5, options.powerRatio ?? 1)) },
      uDarkroom: { value: options.darkroom ? 1.0 : 0.0 },
    },
    vertexShader: `
      attribute float aRadius;
      varying vec3 vNormalDir;
      varying vec3 vViewDir;
      varying float vRadius;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vNormalDir = normalize(normalMatrix * normal);
        vViewDir = normalize(-mvPosition.xyz);
        vRadius = aRadius;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uMinWaist;
      uniform float uPower;
      uniform float uDarkroom;
      varying vec3 vNormalDir;
      varying vec3 vViewDir;
      varying float vRadius;

      void main() {
        float ndotv = abs(dot(normalize(vNormalDir), normalize(vViewDir)));
        // Radial Gaussian envelope: bright along the beam axis, soft Tyndall falloff at edges.
        float radial = exp(-pow(1.0 - ndotv, 2.0) * 3.4);
        // Axial energy density conservation: intensity scales with (w_min / w(z)).
        float waistRatio = clamp(uMinWaist / max(vRadius, 0.05), 0.12, 1.0);
        float axialDensity = pow(waistRatio, 1.15);

        float coreMix = clamp(radial * axialDensity * (0.12 + 0.73 * uPower), 0.0, 0.88);
        vec3 color = mix(uColor, vec3(1.0), coreMix);
        float alpha = radial * (0.08 + 0.48 * axialDensity) * (0.15 + 0.85 * uPower) * mix(0.70, 1.15, uDarkroom);
        if (alpha < 0.002) discard;

        gl_FragColor = vec4(color * alpha, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}
