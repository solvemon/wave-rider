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

  it('turns toward steer input once moving', () => {
    const vessel = new Vessel()
    vessel.position.y = -0.3
    run(vessel, 3, { throttle: 1, steer: 1 })
    expect(vessel.yaw).toBeGreaterThan(0.1)
    expect(vessel.position.x).toBeGreaterThan(1)
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
