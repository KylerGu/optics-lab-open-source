import * as THREE from 'three';

export function createInfiniteGrid() {
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { fadeStart: { value: 1000 }, fadeEnd: { value: 4000 }, strength: { value: 1 }, darkroom: { value: 0 } },
    vertexShader: `
      varying vec3 worldPosition;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        worldPosition = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: `
      varying vec3 worldPosition;
      uniform float fadeStart;
      uniform float fadeEnd;
      uniform float strength;
      uniform float darkroom;
      float gridLine(vec2 coordinate) {
        vec2 width = max(fwidth(coordinate), vec2(0.00001));
        vec2 line = abs(fract(coordinate - 0.5) - 0.5) / width;
        return (1.0 - min(min(line.x, line.y), 1.0))
          * (1.0 - smoothstep(0.5, 1.5, max(width.x, width.y)));
      }
      float breadboardHole(vec2 coordinate) {
        vec2 width = max(fwidth(coordinate), vec2(0.00001));
        vec2 cell = fract(coordinate - 0.5) - 0.5;
        float dist = length(cell);
        float px = max(width.x, width.y);
        float radius = 0.085;
        return (1.0 - smoothstep(radius - px * 1.2, radius + px * 1.2, dist))
          * (1.0 - smoothstep(0.18, 0.52, px));
      }
      void main() {
        float fine = gridLine(worldPosition.xz / 25.0);
        float coarse = gridLine(worldPosition.xz / 100.0);
        float holes = breadboardHole(worldPosition.xz / 25.0);
        float fade = 1.0 - smoothstep(fadeStart, fadeEnd, distance(cameraPosition, worldPosition));
        // Suppress dense subdivisions at a distance; the optical paths are the focus.
        float fineVisibility = 1.0 - smoothstep(0.18, 0.55, max(fwidth(worldPosition.x / 25.0), fwidth(worldPosition.z / 25.0)));

        float lightAlpha = max(fine * 0.30 * fineVisibility, coarse * 0.46) * fade * strength;
        vec3 lightColor = mix(vec3(0.75, 0.81, 0.87), vec3(0.66, 0.73, 0.82), coarse);

        // Optical breadboard: subtle 25 mm tapped hole matrix + 100 mm major graduation lines
        float darkAlpha = max(max(holes * 0.42, fine * 0.14 * fineVisibility), coarse * 0.36) * fade * strength;
        vec3 holeColor = vec3(0.24, 0.34, 0.48);
        vec3 darkLineColor = mix(vec3(0.14, 0.20, 0.29), vec3(0.22, 0.31, 0.44), coarse);
        vec3 darkColor = mix(darkLineColor, holeColor, clamp(holes, 0.0, 1.0));

        float alpha = mix(lightAlpha, darkAlpha, darkroom);
        vec3 color = mix(lightColor, darkColor, darkroom);
        if (alpha < 0.002) discard;
        gl_FragColor = vec4(color, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const grid = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), material);
  grid.frustumCulled = false;
  grid.renderOrder = -1;
  const direction = new THREE.Vector3();
  grid.onBeforeRender = (_renderer, _scene, camera) => {
    const perspective = camera as THREE.PerspectiveCamera;
    // Follow the visible region; shader coordinates stay anchored to the world.
    grid.position.x = camera.position.x;
    grid.position.z = camera.position.z;
    grid.scale.setScalar(perspective.far);
    grid.updateMatrixWorld();
    camera.getWorldDirection(direction);
    const distance = Math.abs(camera.position.y - grid.position.y) / Math.max(Math.abs(direction.y), 0.05);
    const end = Math.min(perspective.far * 0.8, Math.max(1200, distance * 4));
    material.uniforms.fadeEnd.value = end;
    material.uniforms.fadeStart.value = Math.min(end * 0.55, Math.max(500, distance * 1.4));
  };
  return grid;
}
