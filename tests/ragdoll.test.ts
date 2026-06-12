import { describe, expect, it } from 'vitest'
import { Ragdoll } from '../src/ragdoll'
import { Vessel, VISUAL_FLOAT_OFFSET } from '../src/vessel'

const STEP = 1 / 60
const flatWater = () => 0

function makeDoll() {
  const vessel = new Vessel()
  const doll = new Ragdoll()
  doll.reset(vessel)
  return { vessel, doll }
}

describe('Ragdoll', () => {
  it('settles with every constraint near its rest length', () => {
    const { vessel, doll } = makeDoll()
    for (let i = 0; i < 240; i++) {
      doll.update(STEP, vessel, flatWater)
    }
    expect(doll.maxConstraintError()).toBeLessThan(0.05)
  })

  it('keeps the hands pinned to the deck mounts', () => {
    const { vessel, doll } = makeDoll()
    for (let i = 0; i < 60; i++) {
      doll.update(STEP, vessel, flatWater)
    }
    const handL = doll.particles[0].pos
    expect(handL.x).toBeCloseTo(-doll.tuning.mountX, 3)
    expect(handL.y).toBeCloseTo(doll.tuning.mountY + VISUAL_FLOAT_OFFSET, 3)
    expect(handL.z).toBeCloseTo(doll.tuning.mountZ, 3)
  })

  it('pushes submerged particles back toward the surface', () => {
    const { vessel, doll } = makeDoll()
    const foot = doll.particles[10]
    foot.pos.y = -5
    foot.prev.y = -5
    doll.update(STEP, vessel, flatWater)
    expect(foot.pos.y).toBeGreaterThan(-5)
  })

  it('reports a deck impact when slammed into the hull', () => {
    const { vessel, doll } = makeDoll()
    for (const p of doll.particles) {
      p.prev.y = p.pos.y + 0.2 // implied downward velocity of 12 m/s
    }
    doll.update(STEP, vessel, flatWater)
    expect(doll.deckImpact).not.toBeNull()
    expect(doll.deckImpact!.force).toBeGreaterThan(5)
  })

  it('stays finite through violent vessel motion', () => {
    const { vessel, doll } = makeDoll()
    for (let i = 0; i < 600; i++) {
      vessel.position.set(Math.sin(i * 0.5) * 30, Math.cos(i * 0.7) * 8, i * 1.5)
      vessel.yaw = i * 0.3
      vessel.pitch = Math.sin(i) * 0.8
      doll.update(STEP, vessel, flatWater)
    }
    for (const p of doll.particles) {
      expect(Number.isFinite(p.pos.x + p.pos.y + p.pos.z)).toBe(true)
    }
  })
})
