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
  planingLift: number // upward accel per m/s of forward speed — speed lifts the hull out of the water
  lateralGrip: number // how fast sideways slip bleeds off (1/s) — lower = driftier carves
  turnRate: number // rad/s at full grip and full throttle
  steerIdleAuthority: number // 0..1 share of turnRate available with no throttle (bare rudder)
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
  thrust: 25,
  reverseThrust: 6,
  waterDrag: 0.5,
  planingLift: 0.5,
  lateralGrip: 2.5,
  turnRate: 1.0,
  steerIdleAuthority: 0.25,
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
  vx = 0 // horizontal velocity, world space
  vz = 0
  vy = 0 // vertical velocity
  yaw = 0
  pitch = 0 // nose-up positive
  roll = 0 // starboard-down positive
  pitchVel = 0
  rollVel = 0
  airborne = false
  justTookOff = false // true only on the step the hull left the water
  justLanded = 0 // downward impact speed (m/s) on the touchdown step, else 0

  constructor(public tuning: VesselTuning = { ...defaultTuning }) {}

  /** Signed speed along the heading — what the camera and tests care about. */
  get speed(): number {
    return this.vx * Math.sin(this.yaw) + this.vz * Math.cos(this.yaw)
  }

  update(dt: number, input: VesselInput, sampleHeight: SurfaceSampler) {

    this.justTookOff = false
    this.justLanded = 0

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
    if (this.airborne && !wasAirborne) {
      this.justTookOff = true
    }

    if (this.airborne) {
      this.vy -= t.airGravity * dt

      const airPitchTarget = input.throttle * t.airPitchAuthority
      this.pitchVel += (t.autoLevelSpring * (airPitchTarget - this.pitch) - t.autoLevelDamping * this.pitchVel) * dt
      this.rollVel += (t.autoLevelSpring * -this.roll - t.autoLevelDamping * this.rollVel) * dt
    } else {
      if (wasAirborne) {
        this.justLanded = Math.max(0, -this.vy)
        if (this.vy < 0) {
          this.vy *= 1 - t.landingAbsorb
        }
        this.vx *= t.speedKeptOnLanding
        this.vz *= t.speedKeptOnLanding
      }

      // Decompose velocity into the hull frame: thrust and drag act along the
      // keel while lateralGrip bleeds off sideways slip. The heading rotates
      // first and the velocity catches up — that lag is what makes turns
      // carve like a boat instead of pivoting like a spaceship.
      let forwardSpeed = this.vx * sinYaw + this.vz * cosYaw
      let lateralSpeed = this.vx * cosYaw - this.vz * sinYaw
      const throttleAccel = input.throttle >= 0 ? input.throttle * t.thrust : input.throttle * t.reverseThrust
      forwardSpeed += (throttleAccel - t.waterDrag * forwardSpeed) * dt
      lateralSpeed *= Math.max(0, 1 - t.lateralGrip * dt)
      this.vx = forwardSpeed * sinYaw + lateralSpeed * cosYaw
      this.vz = forwardSpeed * cosYaw - lateralSpeed * sinYaw

      // Planing lift: the hull pushes itself out of the water with speed,
      // so at pace the vessel skims wave tops instead of plowing into faces.
      // Capped below gravity so lift alone can never make the boat fly.
      const planing = Math.min(Math.abs(forwardSpeed) * t.planingLift, t.gravity * 0.85)

      const springAccel = Math.max(submersion, 0) * t.buoyancySpring
      this.vy += (springAccel + planing - t.buoyancyDamping * this.vy - t.gravity) * dt

      // Jetski steering: the nozzle only bites under throttle; the bare hull
      // keeps steerIdleAuthority worth of rudder. Screen-right is -X in this
      // frame, so a right turn (steer +1) decreases yaw.
      const grip = THREE.MathUtils.clamp(Math.abs(forwardSpeed) / 8, 0, 1)
      const authority = t.steerIdleAuthority + (1 - t.steerIdleAuthority) * Math.max(input.throttle, 0)
      this.yaw -= input.steer * t.turnRate * grip * authority * dt

      // Planing boats trim bow-up; scales with how hard the hull is planing.
      const targetPitch = Math.atan2(hBow - hStern, HULL_HALF_LENGTH * 2) + (planing / t.gravity) * 0.12
      const targetRoll = Math.atan2(hPort - hStarboard, HULL_HALF_WIDTH * 2) + input.steer * t.bankFactor * grip
      this.pitchVel += (t.orientSpring * (targetPitch - this.pitch) - t.orientDamping * this.pitchVel) * dt
      this.rollVel += (t.orientSpring * (targetRoll - this.roll) - t.orientDamping * this.rollVel) * dt
    }

    this.pitch += this.pitchVel * dt
    this.roll += this.rollVel * dt
    this.position.x += this.vx * dt
    this.position.z += this.vz * dt
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

// Purely cosmetic lift so the hull reads as planing instead of burying in
// steep wave faces (physics rides ~0.6 m below the local surface in big
// swells). Does not affect any physics sampling.
const VISUAL_FLOAT_OFFSET = 0.25

export function syncVesselMesh(vessel: Vessel, mesh: THREE.Object3D) {

  mesh.position.copy(vessel.position)
  mesh.position.y += VISUAL_FLOAT_OFFSET
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
