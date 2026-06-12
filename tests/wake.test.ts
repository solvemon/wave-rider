import { describe, expect, it } from 'vitest'
import { ageSamples, WakeSample } from '../src/wake'

describe('ageSamples', () => {
  it('ages every sample and expires the oldest past the lifetime', () => {
    const samples: WakeSample[] = [
      { x: 0, z: 0, age: 2.4 },
      { x: 1, z: 0, age: 1.0 },
      { x: 2, z: 0, age: 0.1 },
    ]
    ageSamples(samples, 0.2, 2.5)
    expect(samples).toHaveLength(2)
    expect(samples[0].age).toBeCloseTo(1.2)
    expect(samples[1].age).toBeCloseTo(0.3)
  })

  it('keeps order oldest-first and handles emptying completely', () => {
    const samples: WakeSample[] = [{ x: 0, z: 0, age: 5 }]
    ageSamples(samples, 1, 2.5)
    expect(samples).toHaveLength(0)
  })
})
