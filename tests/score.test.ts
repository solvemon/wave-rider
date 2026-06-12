import { describe, expect, it } from 'vitest'
import { ScoreState } from '../src/score'

const STEP = 1 / 60

function flyAndLand(score: ScoreState, seconds: number) {
  const steps = Math.round(seconds / STEP)
  for (let i = 0; i < steps; i++) {
    score.tick(STEP, true, false)
  }
  score.landed()
}

describe('ScoreState', () => {
  it('pays nothing for sub-threshold airtime', () => {
    const score = new ScoreState(() => 0)
    flyAndLand(score, 0.3)
    expect(score.drain()).toHaveLength(0)
    expect(score.total).toBe(0)
  })

  it('pays airtime quadratically on landing with a name from the airtime pool', () => {
    const score = new ScoreState(() => 0)
    flyAndLand(score, 2)
    const bonuses = score.drain()
    expect(bonuses).toHaveLength(1)
    expect(bonuses[0].kind).toBe('airtime')
    expect(bonuses[0].points).toBe(220) // 2·30 + 2²·40
    expect(bonuses[0].name).toBe('BIG AIR')
  })

  it('pays big jumps disproportionately more than two small ones', () => {
    const big = new ScoreState(() => 0)
    flyAndLand(big, 3)
    const small = new ScoreState(() => 0)
    flyAndLand(small, 1.5)
    flyAndLand(small, 1.5)
    expect(big.total).toBeGreaterThan(small.total)
  })

  it('rolls names from the far end of the pool too', () => {
    const score = new ScoreState(() => 0.99)
    flyAndLand(score, 2)
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

  it('ignores deck impacts with no recent jump (idle wave bumping)', () => {
    const score = new ScoreState(() => 0)
    score.deckImpact(12, false)
    expect(score.drain()).toHaveLength(0)
  })

  it('tiers deck impacts by force and head flag inside the jump window', () => {
    const score = new ScoreState(() => 0)
    flyAndLand(score, 1)
    score.drain() // discard the airtime bonus
    score.deckImpact(8, false)
    score.tick(0.3, false, false) // clear cooldown
    score.deckImpact(8, true)
    score.tick(0.3, false, false)
    score.deckImpact(12, true)
    const kinds = score.drain().map((b) => `${b.kind}:${b.points}`)
    expect(kinds).toEqual(['smack:96', 'headSmack:144', 'megaSmack:288'])
  })

  it('suppresses smacks below threshold and inside the cooldown', () => {
    const score = new ScoreState(() => 0)
    flyAndLand(score, 1)
    score.drain()
    score.deckImpact(1, false) // below threshold
    score.deckImpact(8, false)
    score.deckImpact(8, false) // inside cooldown
    expect(score.drain()).toHaveLength(1)
  })

  it('ignores smacks during the suppression window after a reset', () => {
    const score = new ScoreState(() => 0)
    flyAndLand(score, 1)
    score.drain()
    score.suppressSmacks(0.5)
    score.deckImpact(12, false)
    expect(score.smacksSuppressed).toBe(true)
    expect(score.drain()).toHaveLength(0)
    for (let i = 0; i < 36; i++) {
      score.tick(STEP, false, false) // 0.6 s — suppression over, jump window still open
    }
    expect(score.smacksSuppressed).toBe(false)
    score.deckImpact(12, false)
    expect(score.drain()).toHaveLength(1)
  })
})
