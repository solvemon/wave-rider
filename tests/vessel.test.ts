import { describe, expect, it } from 'vitest'
import { Vessel } from '../src/vessel'

const STEP = 1 / 60
const flatWater = () => 0
const noInput = { throttle: 0, steer: 0 }

function run(vessel: Vessel, seconds: number, input = noInput, sampler: (x: number, z: number) => number = flatWater) {
  const steps = Math.round(seconds / STEP)
  for (let i = 0; i < steps; i++) {
    vessel.update(STEP, input, sampler)
  }
}

describe('Vessel', () => {
  it('settles to its draft depth on flat water', () => {
    const vessel = new Vessel()
    vessel.position.y = 1
    run(vessel, 10)
    const draft = vessel.tuning.gravity / vessel.tuning.buoyancySpring
    expect(vessel.position.y).toBeCloseTo(-draft, 1)
    expect(Math.abs(vessel.vy)).toBeLessThan(0.05)
  })

  it('goes airborne when the surface drops away', () => {
    const vessel = new Vessel()
    vessel.update(STEP, noInput, () => -100)
    expect(vessel.airborne).toBe(true)
    const vyBefore = vessel.vy
    vessel.update(STEP, noInput, () => -100)
    expect(vessel.vy).toBeLessThan(vyBefore)
  })

  it('accelerates forward under throttle and tracks its heading', () => {
    const vessel = new Vessel()
    vessel.position.y = -0.3
    run(vessel, 5, { throttle: 1, steer: 0 })
    expect(vessel.speed).toBeGreaterThan(5)
    expect(vessel.position.z).toBeGreaterThan(20)
    expect(Math.abs(vessel.position.x)).toBeLessThan(0.001)
  })

  it('turns right under steer +1 (D) once moving', () => {
    // Chase cam looks along +Z with Y up, so screen-right is -X: a right
    // turn means yaw decreases and the vessel drifts toward negative X.
    const vessel = new Vessel()
    vessel.position.y = -0.3
    run(vessel, 1.5, { throttle: 1, steer: 1 })
    expect(vessel.yaw).toBeLessThan(-0.1)
    expect(vessel.position.x).toBeLessThan(-1)
  })

  it('steers much harder under throttle than while coasting', () => {
    const buildMovingVessel = () => {
      const vessel = new Vessel()
      vessel.position.y = -0.3
      run(vessel, 3, { throttle: 1, steer: 0 })
      return vessel
    }
    const powered = buildMovingVessel()
    run(powered, 1.5, { throttle: 1, steer: 1 })
    const coasting = buildMovingVessel()
    run(coasting, 1.5, { throttle: 0, steer: 1 })
    expect(Math.abs(powered.yaw)).toBeGreaterThan(2 * Math.abs(coasting.yaw))
    expect(Math.abs(coasting.yaw)).toBeGreaterThan(0.01) // rudder still does a little
  })

  it('carves: velocity realigns with the heading instead of railing on it', () => {
    const vessel = new Vessel()
    vessel.position.y = -0.3
    vessel.vz = 10 // moving straight ahead (+Z)
    vessel.yaw = 0.5 // heading suddenly points elsewhere
    const initialLateral = Math.abs(vessel.vx * Math.cos(vessel.yaw) - vessel.vz * Math.sin(vessel.yaw))
    expect(initialLateral).toBeGreaterThan(4)
    run(vessel, 2)
    const lateral = Math.abs(vessel.vx * Math.cos(vessel.yaw) - vessel.vz * Math.sin(vessel.yaw))
    expect(lateral).toBeLessThan(0.5)
  })

  it('planes: rides higher in the water with speed', () => {
    const vessel = new Vessel()
    vessel.position.y = -0.3
    run(vessel, 5) // settle at rest
    const restingY = vessel.position.y
    run(vessel, 6, { throttle: 1, steer: 0 })
    expect(vessel.position.y).toBeGreaterThan(restingY + 0.15)
    expect(vessel.position.y).toBeLessThan(0.2) // lift must never overcome gravity
  })

  it('lands without exploding after a long drop', () => {
    const vessel = new Vessel()
    vessel.position.y = 6
    run(vessel, 20)
    const draft = vessel.tuning.gravity / vessel.tuning.buoyancySpring
    expect(vessel.position.y).toBeCloseTo(-draft, 1)
    expect(Math.abs(vessel.vy)).toBeLessThan(0.05)
  })
})
