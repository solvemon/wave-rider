import * as THREE from 'three'
import { NUM_WAVES, WaveParams, gerstnerGLSL } from './waves'

const OCEAN_SIZE = 400
const SEGMENTS = 512

const vertexShader = gerstnerGLSL + /* glsl */ `
varying vec3 vWorldPos;
varying float vHeight;

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vec3 disp = gerstnerDisplace(worldPos.xz);
  worldPos.xyz += disp;
  vWorldPos = worldPos.xyz;
  vHeight = disp.y;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`

const fragmentShader = /* glsl */ `
varying vec3 vWorldPos;
varying float vHeight;

void main() {
  vec3 deep = vec3(0.04, 0.16, 0.27);
  vec3 shallow = vec3(0.12, 0.45, 0.52);
  vec3 sky = vec3(0.65, 0.78, 0.85);

  float h = clamp(vHeight * 0.25 + 0.5, 0.0, 1.0);
  vec3 col = mix(deep, shallow, h);

  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float fresnel = pow(1.0 - max(viewDir.y, 0.0), 3.0);
  col = mix(col, sky, fresnel * 0.6);

  float dist = length(vWorldPos.xz - cameraPosition.xz);
  col = mix(col, sky, smoothstep(120.0, 190.0, dist));

  gl_FragColor = vec4(col, 1.0);
}
`

export class Ocean {
  readonly mesh: THREE.Mesh
  private readonly material: THREE.ShaderMaterial

  constructor(waves: WaveParams[]) {
    const geometry = new THREE.PlaneGeometry(OCEAN_SIZE, OCEAN_SIZE, SEGMENTS, SEGMENTS)
    geometry.rotateX(-Math.PI / 2)

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uWaveA: { value: Array.from({ length: NUM_WAVES }, () => new THREE.Vector4()) },
        uWaveB: { value: Array.from({ length: NUM_WAVES }, () => new THREE.Vector2()) },
      },
    })

    this.mesh = new THREE.Mesh(geometry, this.material)
    this.mesh.frustumCulled = false
    this.updateWaves(waves)
  }

  /** Re-pack wave params into uniforms. Call whenever the tuning panel changes them. */
  updateWaves(waves: WaveParams[]) {
    for (let i = 0; i < NUM_WAVES; i++) {
      const w = waves[i]
      this.material.uniforms.uWaveA.value[i].set(Math.cos(w.direction), Math.sin(w.direction), w.amplitude, w.wavelength)
      this.material.uniforms.uWaveB.value[i].set(w.steepness, w.speed)
    }
  }

  /**
   * Recenter the plane on the vessel so the ocean is endless. Snapped to the
   * vertex grid spacing so vertices land on the same world positions every
   * frame (no swimming).
   */
  update(time: number, center: THREE.Vector3) {
    this.material.uniforms.uTime.value = time
    const step = OCEAN_SIZE / SEGMENTS
    this.mesh.position.x = Math.round(center.x / step) * step
    this.mesh.position.z = Math.round(center.z / step) * step
  }
}
