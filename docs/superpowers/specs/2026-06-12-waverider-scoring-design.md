# Waverider — Scoring & Smack Layer Design

Date: 2026-06-12
Status: Approved
Builds on: prototype + visuals + ragdoll (all validated)

## 1. Concept

A celebration layer, not a pressure layer: points and loud popups for the
silly things the ragdoll does. Session-only score (resets on reload), no
fail states, no timers.

## 2. Bonuses

Every bonus rolls a random display name from a 3-flavor pool
(surf bro / deadpan nautical / maximum dumb):

| Kind | Trigger | Points | Names |
|---|---|---|---|
| `airtime` | vessel airborne ≥ 0.5 s; paid on landing | round(10 × seconds) | BIG AIR, UNSCHEDULED FLIGHT, YEEEET |
| `snorkel` | ragdoll HEAD particle below the wave surface; paid every full second submerged | 25 | SNORKEL TIME, PERISCOPE DOWN, GLUG GLUG GLUG |
| `smack` | ragdoll body particle hits the deck ≥ 2.5 m/s (relative, into the deck) | round(force × 12) | DECK SMACK, HULL INSPECTION, BONK |
| `headSmack` | same but the head particle | round(force × 18) | FACE CHECK, CAPTAIN'S INSPECTION, FACE BONK |
| `megaSmack` | any deck hit ≥ 7 m/s (overrides smack/headSmack) | round(force × 24) | MEGA SMACK, INSURANCE CLAIM, MEGA BONK |

Smack events have a 0.25 s global cooldown (strongest hit wins within a
step; repeated micro-hits don't spam).

## 3. Components

### 3.1 `src/score.ts` (new) — two classes

**`ScoreState` (pure, no DOM — fully unit-testable):**
- `total: number`
- `tuning = { airRate: 10, snorkelRate: 25, smackFactor: 12, headFactor: 18, megaFactor: 24, smackThreshold: 2.5, megaThreshold: 7 }`
- `tick(dt, vesselAirborne, headSubmerged)` — accumulates air seconds and
  snorkel seconds; emits a snorkel bonus each full second submerged.
- `landed()` — pays out accumulated airtime (if ≥ 0.5 s) and resets it.
- `deckImpact(force, head)` — applies threshold/cooldown/tier logic.
- Emits via a queue: `drain(): Bonus[]` where
  `Bonus = { kind, name, points }` — name pre-rolled from the pool.
- `onBonus?: (bonus: Bonus) => void` — audio hook for later sound assets.
- Random name selection via `Math.random` (app code, not workflow code).

**`ScoreOverlay` (DOM):**
- Counter div top-left: bold white retro text with dark outline, shows
  `total` (animated count-up not required).
- Popup pool (~8 divs): `popup(text, screenX, screenY, big)` — absolute
  positioned, CSS transition drift-up + fade over 1.2 s; `big` (mega)
  gets a larger font. Projection from world→screen happens in main.ts
  using the camera (`Vector3.project`).
- Constructed with `document.body`; the game guards construction so tests
  never touch DOM.

### 3.2 `src/ragdoll.ts` — impact reporting
- New per-step field `deckImpact: { force: number; head: boolean; point: THREE.Vector3 } | null`,
  reset at the top of `update()`.
- In the deck-collision pass, compute impact force = particle downward
  speed relative to the vessel's vertical velocity at the moment of
  snapping: `force = max(0, (prev.y − pos.y)/dt − vessel.vy)`. Track the
  strongest hit of the step; flag `head` when the particle index is HEAD.
- `update()` signature gains the vessel's `vy` implicitly via the vessel
  reference it already receives.

### 3.3 `src/camera.ts` — shake
- `shake(amount: number)` adds to an energy value; each `update()`
  applies a random offset scaled by energy to the final camera position
  and decays energy by `exp(−7·dt)`. Amount from smacks: `force × 0.03`,
  clamped to 0.5.

### 3.4 VFX on smack (main.ts wiring)
- `splash.burst(impact.point, count = force × 4, speed = min(force, 6))`
- `chase.shake(min(force * 0.03, 0.5))`
- popup at the impact point.

### 3.5 Main loop
- Fixed-step: `score.tick(STEP, vessel.airborne, headSubmerged)` where
  `headSubmerged = head.pos.y < sampler(head.x, head.z)`; on
  `pendingLanding > 0` call `score.landed()`; ragdoll `deckImpact`
  forwarded to `score.deckImpact(...)` (and remembered for VFX like
  pending landing events).
- Render frame: drain bonus queue → popups (project world point to
  screen) + counter refresh.

### 3.6 Tuning (`src/tuning.ts`)
"Score" folder: smackThreshold (1–8), megaThreshold (3–15), shake scale
(0–1). Point rates stay code-side (less slider noise; they're in
ScoreState.tuning if needed).

## 4. Testing

- `ScoreState`: airtime below threshold pays nothing; 2 s air pays 20 on
  landed(); snorkel pays 25 per full second; force tiers pick correct
  kind and factor; cooldown suppresses rapid smacks; names come from the
  matching pool.
- Ragdoll: dropping the doll onto the deck from height produces a
  non-null `deckImpact` with positive force on some step.
- Overlay: excluded from unit tests (DOM); verified by play/screenshots.

## 5. Real vs hacky

**Real:** ScoreState logic, impact detection, event plumbing.
**Hacky:** DOM popups (fine for prototype), no persistence, no combo
system, audio is a callback stub until assets arrive.

## 6. Risks

Smack spam from constraint jitter → threshold + cooldown. Popup spam at
high snorkel/smack rates → popup pool reuses oldest. Camera shake
nausea → small default, slider to zero.
