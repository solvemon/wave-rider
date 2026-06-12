import * as THREE from 'three'

export interface VesselInput {
  throttle: number // -1..1, W = +1
  steer: number // -1..1, D = +1 (right)
}

export type SurfaceSampler = (x: number, z: number) => number

export interface VesselTuning {
  gravity: number // m/s² in/near water
  airGravity: number // m/s² airborne — lower than gravity reads floatier
  buoyancySpring: number
  buoyancyDamping: number
  thrust: number
  reverseThrust: number
  waterDrag: number
  turnRate: number // rad/s at full grip
  bankFactor: number // extra roll into turns
  orientSpring: number // how eagerly the hull follows the water surface
  orientDamping: number
  autoLevelSpring: number // air: pulls pitch/roll toward level
  autoLevelDamping: number
  airPitchAuthority: number // radians of pitch target at full stick
  landingAbsorb: number // 0..1 share of downward speed removed on touchdown
  speedKeptOnLanding: number // 0..1 share of forward speed kept on touchdown
}

export const defaultTuning: VesselTuning = {
  gravity: 18,
  airGravity: 11,
  buoyancySpring: 60,
  buoyancyDamping: 8,
  thrust: 14,
  reverseThrust: 6,
  waterDrag: 0.5,
  turnRate: 1.6,
  bankFactor: 0.35,
  orientSpring: 18,
  orientDamping: 7,
  autoLevelSpring: 8,
  autoLevelDamping: 4,
  airPitchAuthority: 0.35,
  landingAbsorb: 0.6,
  speedKeptOnLanding: 0.85,
}

const HULL_HALF_LENGTH = 2
const HULL_HALF_WIDTH = 0.9
const AIRBORNE_THRESHOLD = -0.05 // metres of clearance before we call it flight
const AIRBORNE_CLEAR = 0.02 // hysteresis: stay airborne until properly back in the water

export class Vessel {
  readonly position = new THREE.Vector3(0, 0, 0)
  vy = 0 // vertical velocity
  speed = 0 // forward speed along heading
  yaw = 0
  pitch = 0 // nose-up positive
  roll = 0 // starboard-down positive
  pitchVel = 0
  rollVel = 0
  airborne = false

  constructor(public tuning: VesselTuning = { ...defaultTuning }) {}

  update(dt: number, input: VesselInput, sampleHeight: SurfaceSampler) {

    const t = this.tuning
    const sinYaw = Math.sin(this.yaw)
    const cosYaw = Math.cos(this.yaw)

    const hBow = sampleHeight(this.position.x + sinYaw * HULL_HALF_LENGTH, this.position.z + cosYaw * HULL_HALF_LENGTH)
    const hStern = sampleHeight(this.position.x - sinYaw * HULL_HALF_LENGTH, this.position.z - cosYaw * HULL_HALF_LENGTH)
    const hPort = sampleHeight(this.position.x - cosYaw * HULL_HALF_WIDTH, this.position.z + sinYaw * HULL_HALF_WIDTH)
    const hStarboard = sampleHeight(this.position.x + cosYaw * HULL_HALF_WIDTH, this.position.z - sinYaw * HULL_HALF_WIDTH)

    const waterline = (hBow + hStern + hPort + hStarboard) / 4
    const submersion = waterline - this.position.y
    const wasAirborne = this.airborne
    // Airborne is judged on the AVERAGE of the 4 hull heights (a deliberate
    // simplification of the spec's "all points clear" — smoother on steep
    // crests). Hysteresis keeps chop from flickering the airborne state,
    // which would bleed speed through repeated micro-landings.
    this.airborne = submersion < (wasAirborne ? AIRBORNE_CLEAR : AIRBORNE_THRESHOLD)

    if (this.airborne) {
      this.vy -= t.airGravity * dt

      const airPitchTarget = input.throttle * t.airPitchAuthority
      this.pitchVel += (t.autoLevelSpring * (airPitchTarget - this.pitch) - t.autoLevelDamping * this.pitchVel) * dt
      this.rollVel += (t.autoLevelSpring * -this.roll - t.autoLevelDamping * this.rollVel) * dt
    } else {
      if (wasAirborne) {
        if (this.vy < 0) {
          this.vy *= 1 - t.landingAbsorb
        }
        this.speed *= t.speedKeptOnLanding
      }

      const springAccel = Math.max(submersion, 0) * t.buoyancySpring
      this.vy += (springAccel - t.buoyancyDamping * this.vy - t.gravity) * dt

      const grip = THREE.MathUtils.clamp(this.speed / 8, 0, 1)
      const throttleAccel = input.throttle >= 0 ? input.throttle * t.thrust : input.throttle * t.reverseThrust
      this.speed += (throttleAccel - t.waterDrag * this.speed) * dt
      this.yaw += input.steer * t.turnRate * grip * dt

      const targetPitch = Math.atan2(hBow - hStern, HULL_HALF_LENGTH * 2)
      const targetRoll = Math.atan2(hPort - hStarboard, HULL_HALF_WIDTH * 2) + input.steer * t.bankFactor * grip
      this.pitchVel += (t.orientSpring * (targetPitch - this.pitch) - t.orientDamping * this.pitchVel) * dt
      this.rollVel += (t.orientSpring * (targetRoll - this.roll) - t.orientDamping * this.rollVel) * dt
    }

    this.pitch += this.pitchVel * dt
    this.roll += this.rollVel * dt
    this.position.x += sinYaw * this.speed * dt
    this.position.z += cosYaw * this.speed * dt
    this.position.y += this.vy * dt
  }
}

export function createVesselMesh(): THREE.Group {

  const group = new THREE.Group()

  const hull = new THREE.Mesh(
    new THREE.BoxGeometry(HULL_HALF_WIDTH * 2, 0.6, HULL_HALF_LENGTH * 2),
    new THREE.MeshStandardMaterial({ color: 0xff7043 }),
  )
  hull.position.y = 0.1
  group.add(hull)

  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.0, 0.5, 1.2),
    new THREE.MeshStandardMaterial({ color: 0xfff3e0 }),
  )
  cabin.position.set(0, 0.55, -0.4)
  group.add(cabin)

  return group
}

export function syncVesselMesh(vessel: Vessel, mesh: THREE.Object3D) {

  mesh.position.copy(vessel.position)
  mesh.rotation.order = 'YXZ'
  mesh.rotation.y = vessel.yaw
  // Three's +X rotation tips local +Z (our bow) downward, hence the sign flips.
  mesh.rotation.x = -vessel.pitch
  mesh.rotation.z = -vessel.roll
}

export class KeyboardInput {
  readonly state: VesselInput = { throttle: 0, steer: 0 }
  private readonly pressed = new Set<string>()

  attach() {
    window.addEventListener('keydown', (e) => {
      this.pressed.add(e.code)
      this.refresh()
    })
    window.addEventListener('keyup', (e) => {
      this.pressed.delete(e.code)
      this.refresh()
    })
  }

  private refresh() {

    const p = this.pressed

    this.state.throttle =
      (p.has('KeyW') || p.has('ArrowUp') ? 1 : 0) - (p.has('KeyS') || p.has('ArrowDown') ? 1 : 0)
    this.state.steer =
      (p.has('KeyD') || p.has('ArrowRight') ? 1 : 0) - (p.has('KeyA') || p.has('ArrowLeft') ? 1 : 0)
  }
}
