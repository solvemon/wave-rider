import * as THREE from 'three'
import type { Vessel } from './vessel'

export interface NitroTuning {
  pointsToFull: number // big-bonus points needed for a full tank
  drainTime: number // seconds of boost in a full tank
}

export const defaultNitroTuning: NitroTuning = { pointsToFull: 500, drainTime: 2.5 }

/** Pure nitro economy: big bonuses charge it, holding Space drains it. */
export class NitroState {
  charge = 0 // 0..1
  tuning: NitroTuning = { ...defaultNitroTuning }

  /** Caller filters for big bonuses (bonus.big). */
  addBonus(points: number) {
    this.charge = Math.min(1, this.charge + points / this.tuning.pointsToFull)
  }

  /** Advance one step; returns true while actually boosting. */
  tick(dt: number, wantBoost: boolean): boolean {

    if (!wantBoost || this.charge <= 0) {
      return false
    }
    this.charge = Math.max(0, this.charge - dt / this.tuning.drainTime)

    return true
  }
}

const CAPACITY = 256
const EMIT_RATE = 120 // particles per second while boosting

const vertexShader = /* glsl */ `
attribute float aLife;
attribute float aSize;
varying float vLife;

void main() {
  vLife = aLife;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (160.0 / -mv.z) * (0.5 + 0.5 * vLife);
  gl_Position = projectionMatrix * mv;
}
`

const fragmentShader = /* glsl */ `
varying float vLife;

void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.12, d) * vLife;
  if (a < 0.01) {
    discard;
  }
  // young flame is white-yellow, cooling toward deep orange-red
  vec3 col = mix(vec3(1.0, 0.25, 0.04), vec3(1.0, 0.95, 0.6), vLife);
  gl_FragColor = vec4(col * a, a);
}
`

/** Additive flame jet out of the stern while boosting. Pooled like Splash. */
export class NitroFire {
  readonly points: THREE.Points
  private readonly geometry = new THREE.BufferGeometry()
  private readonly positions = new Float32Array(CAPACITY * 3)
  private readonly velocities = new Float32Array(CAPACITY * 3)
  private readonly life = new Float32Array(CAPACITY)
  private readonly maxLife = new Float32Array(CAPACITY)
  private readonly lifeAttr = new Float32Array(CAPACITY)
  private readonly sizeAttr = new Float32Array(CAPACITY)
  private cursor = 0
  private emitCarry = 0

  constructor() {

    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    this.geometry.setAttribute('aLife', new THREE.BufferAttribute(this.lifeAttr, 1))
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizeAttr, 1))

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })

    this.points = new THREE.Points(this.geometry, material)
    this.points.frustumCulled = false
    this.points.renderOrder = 3
  }

  update(dt: number, vessel: Vessel, boosting: boolean) {

    if (boosting) {
      const sinYaw = Math.sin(vessel.yaw)
      const cosYaw = Math.cos(vessel.yaw)
      this.emitCarry += EMIT_RATE * dt
      while (this.emitCarry >= 1) {
        this.emitCarry -= 1
        const back = 7 + Math.random() * 5
        this.spawn(
          vessel.position.x - sinYaw * 2.0 + (Math.random() - 0.5) * 0.3,
          vessel.position.y + 0.3 + (Math.random() - 0.5) * 0.2,
          vessel.position.z - cosYaw * 2.0 + (Math.random() - 0.5) * 0.3,
          vessel.vx * 0.6 - sinYaw * back + (Math.random() - 0.5) * 2,
          1.0 + Math.random() * 1.5,
          vessel.vz * 0.6 - cosYaw * back + (Math.random() - 0.5) * 2,
          0.25 + Math.random() * 0.3,
          1.0 + Math.random() * 1.2,
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
      this.velocities[i * 3 + 1] += 2 * dt // flame buoyancy
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

/** DOM charge bar, bottom-left. Orange filling, yellow when full. */
export class NitroBar {
  private readonly fill: HTMLDivElement

  constructor(parent: HTMLElement) {

    const label = document.createElement('div')
    label.style.cssText =
      'position:fixed;bottom:36px;left:18px;font:700 12px/1 ui-monospace,monospace;color:#fff;' +
      'text-shadow:0 1px 0 rgba(0,0,0,.5);z-index:10;pointer-events:none;letter-spacing:2px;'
    label.textContent = 'NITRO'
    parent.appendChild(label)

    const track = document.createElement('div')
    track.style.cssText =
      'position:fixed;bottom:16px;left:18px;width:220px;height:12px;border-radius:6px;' +
      'background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.4);z-index:10;' +
      'pointer-events:none;overflow:hidden;'
    parent.appendChild(track)

    this.fill = document.createElement('div')
    this.fill.style.cssText = 'height:100%;width:0%;background:#ff9800;transition:width .1s linear;'
    track.appendChild(this.fill)
  }

  set(charge: number) {
    this.fill.style.width = `${Math.round(charge * 100)}%`
    this.fill.style.background = charge >= 1 ? '#ffd54f' : '#ff9800'
  }
}
