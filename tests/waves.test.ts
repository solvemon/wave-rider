import { describe, expect, it } from 'vitest'
import { defaultWaves, gerstnerDisplace, surfaceHeight } from '../src/waves'

describe('gerstnerDisplace', () => {
  it('is deterministic for identical inputs', () => {
    const a = gerstnerDisplace(defaultWaves, 12.3, -7.8, 4.2, { x: 0, y: 0, z: 0 })
    const b = gerstnerDisplace(defaultWaves, 12.3, -7.8, 4.2, { x: 0, y: 0, z: 0 })
    expect(a).toEqual(b)
  })

  it('stays within the summed amplitude bound', () => {
    const maxAmplitude = defaultWaves.reduce((sum, w) => sum + w.amplitude, 0)
    for (let i = 0; i < 200; i++) {
      const out = gerstnerDisplace(defaultWaves, i * 3.7, i * -2.3, i * 0.31, { x: 0, y: 0, z: 0 })
      expect(Math.abs(out.y)).toBeLessThanOrEqual(maxAmplitude + 1e-9)
    }
  })

  it('matches pinned golden values (guards against silent divergence from the GLSL twin)', () => {
    // Captured from the reviewed implementation. A self-consistent change to
    // the TS math (flipped phase sign, altered q normalization) passes every
    // other test while silently diverging from the GLSL shader — this fixture
    // is the only automated anchor for that equivalence.
    const cases = [
      { x: 10, z: 5, t: 2.5, expected: { x: 1.0174285483090622, y: -2.8621685363494405, z: 0.3771377616548723 } },
      { x: -30.7, z: 18.2, t: 12.0, expected: { x: 2.210556020926044, y: -0.46858208969595944, z: 0.06013797818321232 } },
    ]
    for (const { x, z, t, expected } of cases) {
      const out = gerstnerDisplace(defaultWaves, x, z, t, { x: 0, y: 0, z: 0 })
      expect(out.x).toBeCloseTo(expected.x, 10)
      expect(out.y).toBeCloseTo(expected.y, 10)
      expect(out.z).toBeCloseTo(expected.z, 10)
    }
  })

  it('produces no horizontal displacement at zero steepness', () => {
    const flat = defaultWaves.map((w) => ({ ...w, steepness: 0 }))
    const out = gerstnerDisplace(flat, 12.3, -7.8, 4.2, { x: 0, y: 0, z: 0 })
    expect(out.x).toBe(0)
    expect(out.z).toBe(0)
  })
})

describe('surfaceHeight', () => {
  it('matches the displaced grid point (CPU/GPU agreement)', () => {
    // A grid point (x0, z0) is rendered at (x0 + d.x, d.y, z0 + d.z).
    // Sampling the surface at that displaced XZ must return ~d.y, otherwise
    // physics and visuals disagree.
    const t = 5.0
    for (const [x0, z0] of [[3.7, -2.1], [-15.2, 8.9], [40.1, 33.3]]) {
      const d = gerstnerDisplace(defaultWaves, x0, z0, t, { x: 0, y: 0, z: 0 })
      const h = surfaceHeight(defaultWaves, x0 + d.x, z0 + d.z, t)
      expect(h).toBeCloseTo(d.y, 2)
    }
  })
})
