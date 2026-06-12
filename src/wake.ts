import * as THREE from 'three'
import type { Vessel } from './vessel'

const MAX_SAMPLES = 96
const SAMPLE_INTERVAL = 0.05
const MIN_WAKE_SPEED = 4
const BOW_OFFSET = 2 // wake wedge apex sits at the bow
const APEX_HALF_WIDTH = 0.3
const MAX_HALF_WIDTH = 10

export interface WakeSample {
  x: number
  z: number
  age: number
}

export interface WakeTuning {
  width: number
  lifetime: number
}

export const defaultWakeTuning: WakeTuning = { width: 2.6, lifetime: 2.5 }

/** Advances ages in place and drops expired samples from the front (oldest first). */
export function ageSamples(samples: WakeSample[], dt: number, lifetime: number): WakeSample[] {

  for (const s of samples) {
    s.age += dt
  }
  while (samples.length > 0 && samples[0].age > lifetime) {
    samples.shift()
  }

  return samples
}

const vertexShader = /* glsl */ `
attribute float aAlpha;
attribute float aSide;
varying float vAlpha;
varying float vSide;
varying vec3 vWorldPos;

void main() {
  vAlpha = aAlpha;
  vSide = aSide;
  vWorldPos = position;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`

const fragmentShader = /* glsl */ `
uniform float uTime;
varying float vAlpha;
varying float vSide;
varying vec3 vWorldPos;

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
  float edge = 1.0 - vSide * vSide;
  float n = noise(vWorldPos.xz * 1.8 + uTime * 0.15);
  float a = vAlpha * edge * smoothstep(0.2, 0.75, n * 0.7 + 0.3);
  gl_FragColor = vec4(0.94, 0.97, 0.96, a);
}
`

/**
 * Wake wedge: a triangle-strip ribbon over recent bow positions whose width
 * grows with distance behind the boat (apex at the bow) and fades with age,
 * y-conformed to the wave surface each frame. Vertex positions are
 * world-space (mesh stays at the origin).
 */
export class Wake {
  readonly mesh: THREE.Mesh
  tuning: WakeTuning = { ...defaultWakeTuning }
  private readonly samples: WakeSample[] = []
  private sinceSample = 0
  private readonly geometry = new THREE.BufferGeometry()
  private readonly positions = new Float32Array(MAX_SAMPLES * 2 * 3)
  private readonly alphas = new Float32Array(MAX_SAMPLES * 2)
  private readonly material: THREE.ShaderMaterial

  constructor() {

    const indices: number[] = []
    for (let i = 0; i < MAX_SAMPLES - 1; i++) {
      const a = i * 2
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }

    const sides = new Float32Array(MAX_SAMPLES * 2)
    for (let i = 0; i < MAX_SAMPLES * 2; i++) {
      sides[i] = i % 2 === 0 ? -1 : 1
    }

    this.geometry.setIndex(indices)
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    this.geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1))
    this.geometry.setAttribute('aSide', new THREE.BufferAttribute(sides, 1))
    this.geometry.setDrawRange(0, 0)

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: { uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    })

    this.mesh = new THREE.Mesh(this.geometry, this.material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 1
  }

  update(dt: number, time: number, vessel: Vessel, sampleHeight: (x: number, z: number) => number) {

    this.material.uniforms.uTime.value = time
    ageSamples(this.samples, dt, this.tuning.lifetime)

    this.sinceSample += dt
    if (!vessel.airborne && Math.abs(vessel.speed) > MIN_WAKE_SPEED && this.sinceSample >= SAMPLE_INTERVAL) {
      this.sinceSample = 0
      this.samples.push({
        x: vessel.position.x + Math.sin(vessel.yaw) * BOW_OFFSET,
        z: vessel.position.z + Math.cos(vessel.yaw) * BOW_OFFSET,
        age: 0,
      })
      if (this.samples.length > MAX_SAMPLES) {
        this.samples.shift()
      }
    }

    const n = this.samples.length
    for (let i = 0; i < n; i++) {
      const s = this.samples[i]
      const prev = this.samples[Math.max(i - 1, 0)]
      const next = this.samples[Math.min(i + 1, n - 1)]

      let dx = next.x - prev.x
      let dz = next.z - prev.z
      const len = Math.hypot(dx, dz) || 1
      dx /= len
      dz /= len

      const ageT = s.age / this.tuning.lifetime
      // Wedge shape: width grows with distance behind the boat (apex at the
      // bow), like a real wake — tuning.width is the spread slope multiplier.
      const distBehind = Math.hypot(s.x - vessel.position.x, s.z - vessel.position.z)
      const half = Math.min(APEX_HALF_WIDTH + this.tuning.width * 0.12 * distBehind, MAX_HALF_WIDTH)
      const y = sampleHeight(s.x, s.z) + 0.06
      const alpha = Math.max(1 - ageT, 0) * 0.8
      const v = i * 2

      this.positions[v * 3] = s.x - dz * half
      this.positions[v * 3 + 1] = y
      this.positions[v * 3 + 2] = s.z + dx * half
      this.positions[v * 3 + 3] = s.x + dz * half
      this.positions[v * 3 + 4] = y
      this.positions[v * 3 + 5] = s.z - dx * half
      this.alphas[v] = alpha
      this.alphas[v + 1] = alpha
    }

    this.geometry.attributes.position.needsUpdate = true
    this.geometry.attributes.aAlpha.needsUpdate = true
    this.geometry.setDrawRange(0, Math.max(n - 1, 0) * 6)
  }
}
