import * as THREE from 'three'
import { NUM_WAVES, WaveParams, gerstnerGLSL } from './waves'

const OCEAN_SIZE = 400
const SEGMENTS = 512

const vertexShader = gerstnerGLSL + /* glsl */ `
varying vec3 vWorldPos;
varying vec2 vGridPos;
varying float vHeight;

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vGridPos = worldPos.xz; // undisplaced grid position — fragment re-evaluates waves per pixel
  vec3 disp = gerstnerDisplace(worldPos.xz);
  worldPos.xyz += disp;
  vWorldPos = worldPos.xyz;
  vHeight = disp.y; // raw vertical Gerstner component, not the corrected surfaceHeight()
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`

// Normals and crest are evaluated PER PIXEL (gerstnerSurface on the
// interpolated grid position): per-vertex normals undersample the short chop
// waves (~5 vertices per wavelength) and the sharp specular turns that into
// visible moiré banding against the mesh grid.
const fragmentShader = gerstnerGLSL + /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uHorizonColor;
uniform float uFoamThreshold;
uniform float uFoamIntensity;
uniform float uRippleStrength;
varying vec3 vWorldPos;
varying vec2 vGridPos;
varying float vHeight;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

void main() {
  vec3 deep = vec3(0.04, 0.16, 0.27);
  vec3 shallow = vec3(0.12, 0.45, 0.52);

  float h = clamp(vHeight * 0.15 + 0.5, 0.0, 1.0);
  vec3 col = mix(deep, shallow, h);

  vec3 dispUnused;
  vec3 n;
  float crest;
  gerstnerSurface(vGridPos, dispUnused, n, crest);

  // Detail ripples: a coherent sinusoid at the smallest scale always reads as
  // bands (wave addition can't break up its own shortest frequency), so the
  // finest detail comes from scrolling noise gradients instead. Visual only.
  float e = 0.35;
  vec2 dp = vWorldPos.xz * 0.55 + vec2(uTime * 0.40, uTime * 0.23);
  float n0 = noise(dp);
  vec2 g1 = vec2(noise(dp + vec2(e, 0.0)) - n0, noise(dp + vec2(0.0, e)) - n0);
  vec2 dp2 = vWorldPos.xz * 1.7 - vec2(uTime * 0.31, uTime * 0.47);
  float m0 = noise(dp2);
  vec2 g2 = vec2(noise(dp2 + vec2(e, 0.0)) - m0, noise(dp2 + vec2(0.0, e)) - m0);
  vec2 g = (g1 + g2 * 0.5) * uRippleStrength;
  n = normalize(n + vec3(-g.x, 0.0, -g.y));

  float diff = max(dot(n, uSunDir), 0.0);
  col *= 0.55 + 0.45 * diff;

  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  vec3 halfDir = normalize(uSunDir + viewDir);
  float spec = pow(max(dot(n, halfDir), 0.0), 120.0);
  col += vec3(1.0, 0.92, 0.8) * spec * 0.9;

  float fresnel = pow(1.0 - max(viewDir.y, 0.0), 3.0);
  col = mix(col, uHorizonColor, fresnel * 0.5);

  float breakup = noise(vWorldPos.xz * 0.9 + uTime * 0.25) * 0.6
                + noise(vWorldPos.xz * 2.7 - uTime * 0.15) * 0.4;
  float foam = smoothstep(uFoamThreshold, uFoamThreshold + 0.18, crest * (0.55 + 0.9 * breakup));
  col = mix(col, vec3(0.96, 0.97, 0.94), foam * uFoamIntensity);

  float dist = length(vWorldPos.xz - cameraPosition.xz);
  col = mix(col, uHorizonColor, smoothstep(120.0, 190.0, dist));

  gl_FragColor = vec4(col, 1.0);
}
`

export class Ocean {
  readonly mesh: THREE.Mesh
  /** Live foam tuning — read into uniforms every frame. */
  foam = { threshold: 0.22, intensity: 0.9 }
  /** Noise detail-normal strength — the broadband substitute for short coherent chop. */
  ripple = { strength: 0.35 }
  private readonly material: THREE.ShaderMaterial

  constructor(waves: WaveParams[], sunDir: THREE.Vector3, horizonColor: THREE.Color) {
    const geometry = new THREE.PlaneGeometry(OCEAN_SIZE, OCEAN_SIZE, SEGMENTS, SEGMENTS)
    geometry.rotateX(-Math.PI / 2)

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uWaveA: { value: Array.from({ length: NUM_WAVES }, () => new THREE.Vector4()) },
        uWaveB: { value: Array.from({ length: NUM_WAVES }, () => new THREE.Vector2()) },
        // shared by reference with the Sky — GUI sun changes propagate freely
        uSunDir: { value: sunDir },
        uHorizonColor: { value: horizonColor },
        uFoamThreshold: { value: this.foam.threshold },
        uFoamIntensity: { value: this.foam.intensity },
        uRippleStrength: { value: this.ripple.strength },
      },
    })

    this.mesh = new THREE.Mesh(geometry, this.material)
    this.mesh.frustumCulled = false
    this.updateWaves(waves)
  }

  /** Re-pack wave params into uniforms. Call whenever the tuning panel changes them. */
  updateWaves(waves: WaveParams[]) {
    for (let i = 0; i < Math.min(waves.length, NUM_WAVES); i++) {
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
    this.material.uniforms.uFoamThreshold.value = this.foam.threshold
    this.material.uniforms.uFoamIntensity.value = this.foam.intensity
    this.material.uniforms.uRippleStrength.value = this.ripple.strength
    const step = OCEAN_SIZE / SEGMENTS
    this.mesh.position.x = Math.round(center.x / step) * step
    this.mesh.position.z = Math.round(center.z / step) * step
  }
}
