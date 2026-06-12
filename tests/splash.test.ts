import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { Splash } from '../src/splash'
import { Vessel } from '../src/vessel'

describe('Splash', () => {
  it('spawns the requested burst and expires it over time', () => {
    const splash = new Splash()
    splash.burst(new THREE.Vector3(0, 0, 0), 10, 3)
    expect(splash.aliveCount()).toBe(10)
    splash.update(3, new Vessel(), 0, false) // max particle life is well under 3 s
    expect(splash.aliveCount()).toBe(0)
  })

  it('recycles the pool instead of overflowing', () => {
    const splash = new Splash()
    splash.burst(new THREE.Vector3(0, 0, 0), 600, 3)
    expect(splash.aliveCount()).toBeLessThanOrEqual(512)
  })

  it('emits a landing burst sized by impact', () => {
    const splash = new Splash()
    splash.update(1 / 60, new Vessel(), 8, false)
    expect(splash.aliveCount()).toBeGreaterThan(30)
  })
})
