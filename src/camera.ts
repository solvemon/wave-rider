import * as THREE from 'three'
import type { Vessel } from './vessel'

export interface CameraTuning {
  distance: number
  height: number
  posLag: number // higher = snappier position follow
  lookLag: number // higher = snappier aim; keep above posLag so speed reads as lag
  fovBase: number
  fovSpeedFactor: number
  airPullback: number // extra distance while airborne
}

export const defaultCameraTuning: CameraTuning = {
  distance: 9,
  height: 4,
  posLag: 3.5,
  lookLag: 6,
  fovBase: 60,
  fovSpeedFactor: 0.5,
  airPullback: 2,
}

export class ChaseCamera {
  private readonly desired = new THREE.Vector3()
  private readonly lookPoint = new THREE.Vector3()
  private readonly lookTarget = new THREE.Vector3()
  private initialized = false

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    public tuning: CameraTuning = { ...defaultCameraTuning },
  ) {}

  update(dt: number, vessel: Vessel) {

    const t = this.tuning
    const sinYaw = Math.sin(vessel.yaw)
    const cosYaw = Math.cos(vessel.yaw)

    const back = t.distance + (vessel.airborne ? t.airPullback : 0)
    this.desired.set(
      vessel.position.x - sinYaw * back,
      vessel.position.y + t.height,
      vessel.position.z - cosYaw * back,
    )
    this.lookTarget.set(
      vessel.position.x + sinYaw * 4,
      vessel.position.y,
      vessel.position.z + cosYaw * 4,
    )

    if (!this.initialized) {
      this.camera.position.copy(this.desired)
      this.lookPoint.copy(this.lookTarget)
      this.initialized = true
    }

    // Frame-rate-independent smoothing; position lags more than aim on purpose.
    const posAlpha = 1 - Math.exp(-t.posLag * dt)
    const lookAlpha = 1 - Math.exp(-t.lookLag * dt)
    this.camera.position.lerp(this.desired, posAlpha)
    this.lookPoint.lerp(this.lookTarget, lookAlpha)
    this.camera.lookAt(this.lookPoint)

    const targetFov = t.fovBase + Math.min(Math.abs(vessel.speed) * t.fovSpeedFactor, 25)
    this.camera.fov += (targetFov - this.camera.fov) * posAlpha
    this.camera.updateProjectionMatrix()
  }
}
