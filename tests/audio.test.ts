import { describe, expect, it } from 'vitest'
import { EngineModel } from '../src/audio'

const STEP = 1 / 60

function run(model: EngineModel, seconds: number, throttle: number, airborne: boolean, boosting = false) {
  const steps = Math.round(seconds / STEP)
  for (let i = 0; i < steps; i++) {
    model.update(STEP, throttle, airborne, boosting)
  }
}

describe('EngineModel', () => {
  it('idles without throttle and revs up with it', () => {
    const model = new EngineModel()
    run(model, 3, 0, false)
    const idle = model.rpm
    expect(idle).toBeCloseTo(0.15, 1)
    run(model, 3, 1, false)
    expect(model.rpm).toBeGreaterThan(idle + 0.4)
  })

  it('revs higher in the air than under load at the same throttle', () => {
    const loaded = new EngineModel()
    run(loaded, 3, 1, false)
    const flying = new EngineModel()
    run(flying, 3, 1, true)
    expect(flying.rpm).toBeGreaterThan(loaded.rpm + 0.2)
  })

  it('bogs down on landing and recovers', () => {
    const model = new EngineModel()
    run(model, 3, 1, false)
    const cruising = model.rpm
    model.bogDown(0.3)
    expect(model.rpm).toBeLessThan(cruising - 0.2)
    run(model, 3, 1, false)
    expect(model.rpm).toBeCloseTo(cruising, 1)
  })
})
