import * as THREE from 'three'
import type { Vessel } from './vessel'

const CAPACITY = 512
const GRAVITY = 16

export interface SplashTuning {
  sprayRate: number // bow spray multiplier
  splashIntensity: number // landing burst multiplier
}

export const defaultSplashTuning: SplashTuning = { sprayRate: 1, splashIntensity: 1 }

const vertexShader = /* glsl */ `
attribute float aLife;
attribute float aSize;
varying float vLife;

void main() {
  vLife = aLife;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (180.0 / -mv.z) * (0.6 + 0.4 * vLife);
  gl_Position = projectionMatrix * mv;
}
`

const fragmentShader = /* glsl */ `
varying float vLife;

void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.18, d) * vLife * 0.85;
  if (a < 0.01) {
    discard;
  }
  gl_FragColor = vec4(0.95, 0.98, 1.0, a);
}
`

/**
 * One pooled particle system for all water spray. Fixed capacity; the spawn
 * cursor recycles the oldest slot. Three emitters live in update():
 * landing burst, takeoff puff, bow spray.
 */
export class Splash {
  readonly points: THREE.Points
  tuning: SplashTuning = { ...defaultSplashTuning }
  private readonly geometry = new THREE.BufferGeometry()
  private readonly positions = new Float32Array(CAPACITY * 3)
  private readonly velocities = new Float32Array(CAPACITY * 3)
  private readonly life = new Float32Array(CAPACITY)
  private readonly maxLife = new Float32Array(CAPACITY)
  private readonly lifeAttr = new Float32Array(CAPACITY)
  private readonly sizeAttr = new Float32Array(CAPACITY)
  private cursor = 0
  private sprayCarry = 0

  constructor() {

    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    this.geometry.setAttribute('aLife', new THREE.BufferAttribute(this.lifeAttr, 1))
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizeAttr, 1))

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
    })

    this.points = new THREE.Points(this.geometry, material)
    this.points.frustumCulled = false
    this.points.renderOrder = 2
  }

  aliveCount(): number {

    let count = 0
    for (let i = 0; i < CAPACITY; i++) {
      if (this.life[i] > 0) {
        count++
      }
    }

    return count
  }

  burst(center: THREE.Vector3, count: number, speed: number) {

    for (let j = 0; j < count; j++) {
      const angle = Math.random() * Math.PI * 2
      const radial = (0.4 + Math.random() * 0.6) * speed
      this.spawn(
        center.x + Math.cos(angle) * 0.8,
        center.y + 0.1,
        center.z + Math.sin(angle) * 0.8,
        Math.cos(angle) * radial,
        (0.5 + Math.random() * 0.9) * speed * 0.55 + 1.0,
        Math.sin(angle) * radial,
        0.5 + Math.random() * 0.7,
        1.4 + Math.random() * 1.6,
      )
    }
  }

  update(dt: number, vessel: Vessel, landedImpact: number, tookOff: boolean) {

    const t = this.tuning

    if (landedImpact > 2) {
      const count = Math.min(Math.round(landedImpact * 9 * t.splashIntensity), 110)
      this.burst(vessel.position, count, Math.min(landedImpact * 0.55, 8))
    }
    if (tookOff) {
      this.burst(vessel.position, 14, 2.5)
    }

    const speed = Math.abs(vessel.speed)
    if (!vessel.airborne && speed > 8) {
      const sinYaw = Math.sin(vessel.yaw)
      const cosYaw = Math.cos(vessel.yaw)
      this.sprayCarry += t.sprayRate * 90 * Math.min((speed - 8) / 25, 1) * dt
      while (this.sprayCarry >= 1) {
        this.sprayCarry -= 1
        const side = Math.random() < 0.5 ? -1 : 1
        this.spawn(
          vessel.position.x + sinYaw * 1.8 + cosYaw * 0.9 * side,
          vessel.position.y + 0.15,
          vessel.position.z + cosYaw * 1.8 - sinYaw * 0.9 * side,
          vessel.vx * 0.35 + cosYaw * side * (1.5 + Math.random() * 2.0),
          1.5 + Math.random() * 2.0,
          vessel.vz * 0.35 - sinYaw * side * (1.5 + Math.random() * 2.0),
          0.35 + Math.random() * 0.35,
          0.8 + Math.random() * 0.9,
        )
      }
    }

    for (let i = 0; i < CAPACITY; i++) {
      if (this.life[i] <= 0) {
        continue
      }
      this.life[i] -= dt
      if (this.life[i] <= 0) {
        this.lifeAttr[i] = 0
        this.sizeAttr[i] = 0
        continue
      }
      this.velocities[i * 3 + 1] -= GRAVITY * dt
      this.positions[i * 3] += this.velocities[i * 3] * dt
      this.positions[i * 3 + 1] += this.velocities[i * 3 + 1] * dt
      this.positions[i * 3 + 2] += this.velocities[i * 3 + 2] * dt
      this.lifeAttr[i] = this.life[i] / this.maxLife[i]
    }

    this.geometry.attributes.position.needsUpdate = true
    this.geometry.attributes.aLife.needsUpdate = true
    this.geometry.attributes.aSize.needsUpdate = true
  }

  private spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, lifeSeconds: number, size: number) {

    const i = this.cursor
    this.cursor = (this.cursor + 1) % CAPACITY

    this.positions[i * 3] = x
    this.positions[i * 3 + 1] = y
    this.positions[i * 3 + 2] = z
    this.velocities[i * 3] = vx
    this.velocities[i * 3 + 1] = vy
    this.velocities[i * 3 + 2] = vz
    this.life[i] = lifeSeconds
    this.maxLife[i] = lifeSeconds
    this.lifeAttr[i] = 1
    this.sizeAttr[i] = size
  }
}
