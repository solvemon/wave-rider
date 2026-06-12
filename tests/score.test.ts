import { describe, expect, it } from 'vitest'
import { ScoreState } from '../src/score'

const STEP = 1 / 60

describe('ScoreState', () => {
  it('pays nothing for sub-threshold airtime', () => {
    const score = new ScoreState(() => 0)
    for (let i = 0; i < 18; i++) {
      score.tick(STEP, true, false) // 0.3 s air
    }
    score.landed()
    expect(score.drain()).toHaveLength(0)
    expect(score.total).toBe(0)
  })

  it('pays airtime on landing with a name from the airtime pool', () => {
    const score = new ScoreState(() => 0)
    for (let i = 0; i < 120; i++) {
      score.tick(STEP, true, false) // 2 s air
    }
    score.landed()
    const bonuses = score.drain()
    expect(bonuses).toHaveLength(1)
    expect(bonuses[0].kind).toBe('airtime')
    expect(bonuses[0].points).toBe(20)
    expect(bonuses[0].name).toBe('BIG AIR')
    expect(score.total).toBe(20)
  })

  it('rolls names from the far end of the pool too', () => {
    const score = new ScoreState(() => 0.99)
    for (let i = 0; i < 120; i++) {
      score.tick(STEP, true, false)
    }
    score.landed()
    expect(score.drain()[0].name).toBe('YEEEET')
  })

  it('pays snorkel every full submerged second', () => {
    const score = new ScoreState(() => 0)
    for (let i = 0; i < 150; i++) {
      score.tick(STEP, false, true) // 2.5 s underwater
    }
    const bonuses = score.drain()
    expect(bonuses).toHaveLength(2)
    expect(bonuses.every((b) => b.kind === 'snorkel' && b.points === 25)).toBe(true)
  })

  it('tiers deck impacts by force and head flag', () => {
    const score = new ScoreState(() => 0)
    score.deckImpact(3, false)
    score.tick(0.3, false, false) // clear cooldown
    score.deckImpact(3, true)
    score.tick(0.3, false, false)
    score.deckImpact(8, true)
    const kinds = score.drain().map((b) => `${b.kind}:${b.points}`)
    expect(kinds).toEqual(['smack:36', 'headSmack:54', 'megaSmack:192'])
  })

  it('suppresses smacks below threshold and inside the cooldown', () => {
    const score = new ScoreState(() => 0)
    score.deckImpact(1, false) // below threshold
    score.deckImpact(5, false)
    score.deckImpact(5, false) // inside cooldown
    expect(score.drain()).toHaveLength(1)
  })
})
