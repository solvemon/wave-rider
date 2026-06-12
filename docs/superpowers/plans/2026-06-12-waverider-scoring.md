# Scoring & Smack Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Points + popups for airtime, head-underwater time, and force-tiered ragdoll deck smacks, with smack VFX (burst, camera shake) and an audio hook.

**Architecture:** Pure `ScoreState` (accumulators, tiers, cooldown, random name pools — unit-tested, injectable RNG) separated from `ScoreOverlay` (DOM counter + pooled popups). Ragdoll reports its strongest per-step deck impact (same pattern as vessel landing events); main.ts forwards events from the fixed-step loop and renders popups per frame by projecting world points through the camera. Camera gains a decaying shake.

**Tech Stack:** TypeScript, DOM overlay (no canvas text), Vitest.

**Spec:** `docs/superpowers/specs/2026-06-12-waverider-scoring-design.md`
**Conventions:** commits `## - <one-liner>`.

---

### Task 1: `ScoreState` — TDD

**Files:** Create `src/score.ts`; Test `tests/score.test.ts`

- [ ] **Step 1: failing tests — `tests/score.test.ts`:**

```ts
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
```

- [ ] **Step 2:** `npm run test` — FAIL (module missing).

- [ ] **Step 3: implement `src/score.ts`:**

```ts
export type BonusKind = 'airtime' | 'snorkel' | 'smack' | 'headSmack' | 'megaSmack'

export interface Bonus {
  kind: BonusKind
  name: string
  points: number
}

// every bonus rolls a random flavor: surf bro / deadpan nautical / maximum dumb
const NAME_POOLS: Record<BonusKind, string[]> = {
  airtime: ['BIG AIR', 'UNSCHEDULED FLIGHT', 'YEEEET'],
  snorkel: ['SNORKEL TIME', 'PERISCOPE DOWN', 'GLUG GLUG GLUG'],
  smack: ['DECK SMACK', 'HULL INSPECTION', 'BONK'],
  headSmack: ['FACE CHECK', "CAPTAIN'S INSPECTION", 'FACE BONK'],
  megaSmack: ['MEGA SMACK', 'INSURANCE CLAIM', 'MEGA BONK'],
}

export interface ScoreTuning {
  airRate: number // points per second of airtime
  snorkelRate: number // points per full second head-under
  smackFactor: number
  headFactor: number
  megaFactor: number
  smackThreshold: number // m/s into the deck before a hit counts
  megaThreshold: number
}

export const defaultScoreTuning: ScoreTuning = {
  airRate: 10,
  snorkelRate: 25,
  smackFactor: 12,
  headFactor: 18,
  megaFactor: 24,
  smackThreshold: 2.5,
  megaThreshold: 7,
}

const MIN_AIR_SECONDS = 0.5
const SMACK_COOLDOWN = 0.25

/** Pure scoring logic — no DOM, deterministic via the injected RNG. */
export class ScoreState {
  total = 0
  tuning: ScoreTuning = { ...defaultScoreTuning }
  /** Audio hook: subscribe when sound assets land. */
  onBonus?: (bonus: Bonus) => void
  private airSeconds = 0
  private snorkelSeconds = 0
  private smackCooldown = 0
  private readonly queue: Bonus[] = []

  constructor(private readonly random: () => number = Math.random) {}

  tick(dt: number, vesselAirborne: boolean, headSubmerged: boolean) {

    this.smackCooldown = Math.max(0, this.smackCooldown - dt)
    if (vesselAirborne) {
      this.airSeconds += dt
    }

    if (headSubmerged) {
      this.snorkelSeconds += dt
      if (this.snorkelSeconds >= 1) {
        this.snorkelSeconds -= 1
        this.award('snorkel', this.tuning.snorkelRate)
      }
    } else {
      this.snorkelSeconds = 0
    }
  }

  /** Call when the vessel touches down — pays out accumulated airtime. */
  landed() {

    if (this.airSeconds >= MIN_AIR_SECONDS) {
      this.award('airtime', Math.round(this.airSeconds * this.tuning.airRate))
    }
    this.airSeconds = 0
  }

  deckImpact(force: number, head: boolean) {

    if (force < this.tuning.smackThreshold || this.smackCooldown > 0) {
      return
    }
    this.smackCooldown = SMACK_COOLDOWN

    if (force >= this.tuning.megaThreshold) {
      this.award('megaSmack', Math.round(force * this.tuning.megaFactor))
    } else if (head) {
      this.award('headSmack', Math.round(force * this.tuning.headFactor))
    } else {
      this.award('smack', Math.round(force * this.tuning.smackFactor))
    }
  }

  /** Returns and clears the pending bonus queue (consumed by the overlay). */
  drain(): Bonus[] {
    return this.queue.splice(0, this.queue.length)
  }

  private award(kind: BonusKind, points: number) {

    const pool = NAME_POOLS[kind]
    const bonus: Bonus = { kind, name: pool[Math.floor(this.random() * pool.length)], points }

    this.total += points
    this.queue.push(bonus)
    this.onBonus?.(bonus)
  }
}

const POPUP_POOL_SIZE = 8

/** DOM presentation: retro counter top-left + pooled floating popups. */
export class ScoreOverlay {
  private readonly counter: HTMLDivElement
  private readonly popups: HTMLDivElement[] = []
  private nextPopup = 0

  constructor(parent: HTMLElement) {

    this.counter = document.createElement('div')
    this.counter.style.cssText =
      'position:fixed;top:14px;left:18px;font:700 28px/1 ui-monospace,monospace;color:#fff;' +
      'text-shadow:0 2px 0 rgba(0,0,0,.45);z-index:10;pointer-events:none;'
    this.counter.textContent = '0'
    parent.appendChild(this.counter)

    for (let i = 0; i < POPUP_POOL_SIZE; i++) {
      const el = document.createElement('div')
      el.style.cssText =
        'position:fixed;font:800 22px/1 ui-monospace,monospace;color:#fff;' +
        'text-shadow:0 2px 0 rgba(0,0,0,.5);z-index:10;pointer-events:none;opacity:0;' +
        'will-change:transform,opacity;'
      parent.appendChild(el)
      this.popups.push(el)
    }
  }

  setTotal(total: number) {
    this.counter.textContent = String(total)
  }

  popup(text: string, x: number, y: number, big: boolean) {

    const el = this.popups[this.nextPopup]
    this.nextPopup = (this.nextPopup + 1) % POPUP_POOL_SIZE

    el.style.transition = 'none'
    el.style.transform = 'translate(-50%, 0)'
    el.style.left = `${x}px`
    el.style.top = `${y}px`
    el.style.opacity = '1'
    el.style.fontSize = big ? '36px' : '22px'
    el.style.color = big ? '#ffd54f' : '#ffffff'
    el.textContent = text

    void el.offsetWidth // reflow so the transition restarts cleanly
    el.style.transition = 'transform 1.2s ease-out, opacity 1.2s ease-out'
    el.style.transform = 'translate(-50%, -70px)'
    el.style.opacity = '0'
  }
}
```

- [ ] **Step 4:** `npm run test` — 30 pass. **Step 5:** Commit:

```bash
git add src/score.ts tests/score.test.ts
git commit -m "## - Add score state with tiered smack bonuses and DOM overlay"
```

---

### Task 2: Ragdoll impact reporting — TDD

**Files:** Modify `src/ragdoll.ts`; Test `tests/ragdoll.test.ts`

- [ ] **Step 1: failing test (append inside the Ragdoll describe block):**

```ts
  it('reports a deck impact when slammed into the hull', () => {
    const { vessel, doll } = makeDoll()
    for (const p of doll.particles) {
      p.prev.y = p.pos.y + 0.2 // implied downward velocity of 12 m/s
    }
    doll.update(STEP, vessel, flatWater)
    expect(doll.deckImpact).not.toBeNull()
    expect(doll.deckImpact!.force).toBeGreaterThan(5)
  })
```

- [ ] **Step 2:** `npm run test` — FAIL (deckImpact undefined).

- [ ] **Step 3: implement in `src/ragdoll.ts`.** Add a field + temp:

```ts
  /** Strongest deck hit this step (force in m/s into the deck), or null. */
  deckImpact: { force: number; head: boolean; point: THREE.Vector3 } | null = null
  private readonly impactPoint = new THREE.Vector3()
```

At the top of `update()` (after `const t = this.tuning`): `this.deckImpact = null`.

In the deck-collision pass, inside the `if (onFootprint && ...)` block BEFORE the snap (before `this.tmp.y = DECK_Y`):

```ts
        // closing speed of the particle onto the (possibly moving) deck
        const closing = (p.prev.y - p.pos.y) / dt + vessel.vy
        if (closing > 0 && (this.deckImpact === null || closing > this.deckImpact.force)) {
          this.impactPoint.copy(p.pos)
          this.deckImpact = { force: closing, head: i === HEAD, point: this.impactPoint }
        }
```

Also add a head accessor (used by main.ts for snorkel detection):

```ts
  get headPos(): THREE.Vector3 {
    return this.particles[HEAD].pos
  }
```

- [ ] **Step 4:** `npm run test` — 31 pass. **Step 5:** Commit:

```bash
git add src/ragdoll.ts tests/ragdoll.test.ts
git commit -m "## - Report strongest per-step ragdoll deck impact with head flag"
```

---

### Task 3: Camera shake + wiring + Score tuning folder

**Files:** Modify `src/camera.ts`, `src/main.ts`, `src/tuning.ts`

- [ ] **Step 1: `src/camera.ts`** — add to `ChaseCamera`:

```ts
  private shakeEnergy = 0

  /** Kick the camera; energy decays exponentially. */
  shake(amount: number) {
    this.shakeEnergy = Math.min(this.shakeEnergy + amount, 0.8)
  }
```

At the END of `update()` (after the FOV block):

```ts
    if (this.shakeEnergy > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeEnergy
      this.camera.position.y += (Math.random() - 0.5) * this.shakeEnergy
      this.shakeEnergy *= Math.exp(-7 * dt)
    }
```

- [ ] **Step 2: `src/main.ts`** — import `{ ScoreState, ScoreOverlay }` from './score'. After the ragdoll setup:

```ts
const score = new ScoreState()
const overlay = new ScoreOverlay(document.body)
const scoreFx = { shake: 0.05 }
```

Add `score: score.tuning, scoreFx,` to the `createTuningPanel` call.

State next to `pendingLanding`:

```ts
let pendingImpactForce = 0
const lastImpactPoint = new THREE.Vector3()
const popupWorld = new THREE.Vector3()
const popupProjected = new THREE.Vector3()
```

Inside the fixed-step loop, after `ragdoll.update(...)`:

```ts
    const headSubmerged = ragdoll.headPos.y < sampler(ragdoll.headPos.x, ragdoll.headPos.z)
    score.tick(STEP, vessel.airborne, headSubmerged)
    if (vessel.justLanded > 0) {
      score.landed()
    }
    if (ragdoll.deckImpact) {
      score.deckImpact(ragdoll.deckImpact.force, ragdoll.deckImpact.head)
      if (ragdoll.deckImpact.force > pendingImpactForce) {
        pendingImpactForce = ragdoll.deckImpact.force
        lastImpactPoint.copy(ragdoll.deckImpact.point)
      }
    }
```

AFTER `renderer.render(scene, camera)` (camera matrices are current there):

```ts
  if (pendingImpactForce >= score.tuning.smackThreshold) {
    splash.burst(lastImpactPoint, Math.min(Math.round(pendingImpactForce * 4), 40), Math.min(pendingImpactForce, 6))
    chase.shake(Math.min(pendingImpactForce * scoreFx.shake, 0.5))
  }
  pendingImpactForce = 0

  for (const bonus of score.drain()) {
    if (bonus.kind === 'snorkel') {
      popupWorld.copy(ragdoll.headPos)
    } else if (bonus.kind === 'airtime') {
      popupWorld.copy(vessel.position)
    } else {
      popupWorld.copy(lastImpactPoint)
    }
    popupWorld.y += 1
    popupProjected.copy(popupWorld).project(camera)
    overlay.popup(
      `${bonus.name} +${bonus.points}`,
      (popupProjected.x * 0.5 + 0.5) * window.innerWidth,
      (-popupProjected.y * 0.5 + 0.5) * window.innerHeight,
      bonus.kind === 'megaSmack',
    )
  }
  overlay.setTotal(score.total)
```

- [ ] **Step 3: `src/tuning.ts`** — add `import type { ScoreTuning } from './score'`; extend `TuningTargets` with `score: ScoreTuning` and `scoreFx: { shake: number }`; after the Ragdoll folder:

```ts
  const scoreFolder = gui.addFolder('Score')
  scoreFolder.add(targets.score, 'smackThreshold', 1, 8, 0.1)
  scoreFolder.add(targets.score, 'megaThreshold', 3, 15, 0.1)
  scoreFolder.add(targets.scoreFx, 'shake', 0, 0.2, 0.005).name('shakeScale')
```

- [ ] **Step 4:** `npm run test` (31), `npm run build` (clean). Headless: drive over swells, screenshot — expect score counter top-left and at least one popup frame; play for comedy. **Step 5:** Commit:

```bash
git add src/camera.ts src/main.ts src/tuning.ts
git commit -m "## - Wire scoring popups, smack VFX and camera shake into the game loop"
```

---

## Plan self-review record

- **Spec coverage:** §2 bonus table (names, rates, tiers, cooldown, 0.5 s min air) → Task 1; §3.1 ScoreState/ScoreOverlay split + onBonus hook → Task 1; §3.2 ragdoll deckImpact + relative closing speed → Task 2; §3.3 camera shake → Task 3; §3.4 VFX wiring (burst + shake + popup) → Task 3; §3.5 fixed-step detection / render-frame presentation → Task 3; §3.6 Score tuning folder → Task 3; §4 tests → Tasks 1–2.
- **Placeholders:** none.
- **Type consistency:** `Bonus`/`BonusKind`/`ScoreTuning` (Task 1) match main.ts usage (Task 3); `ragdoll.deckImpact.{force,head,point}` and `headPos` (Task 2) match Task 3 wiring; `chase.shake` (Task 3) matches camera addition; `splash.burst(Vector3, count, speed)` matches existing Splash.
