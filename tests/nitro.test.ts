import { describe, expect, it } from 'vitest'
import { NitroState } from '../src/nitro'

describe('NitroState', () => {
  it('charges by points over pointsToFull and caps at 1', () => {
    const nitro = new NitroState()
    nitro.addBonus(250)
    expect(nitro.charge).toBeCloseTo(0.5)
    nitro.addBonus(400)
    expect(nitro.charge).toBe(1)
  })

  it('drains over drainTime while boost is held', () => {
    const nitro = new NitroState()
    nitro.addBonus(500)
    expect(nitro.tick(0.5, true)).toBe(true) // half a second of a 2.5 s tank
    expect(nitro.charge).toBeCloseTo(0.8)
    expect(nitro.tick(0.5, false)).toBe(false) // released — no drain
    expect(nitro.charge).toBeCloseTo(0.8)
  })

  it('cannot boost on an empty tank', () => {
    const nitro = new NitroState()
    expect(nitro.tick(0.1, true)).toBe(false)
    nitro.addBonus(500)
    let time = 0
    while (nitro.tick(1 / 60, true)) {
      time += 1 / 60
    }
    expect(time).toBeGreaterThan(2.3) // ~drainTime of boost from full
    expect(nitro.charge).toBe(0)
  })
})
