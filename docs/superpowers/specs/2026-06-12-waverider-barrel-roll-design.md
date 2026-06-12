# Waverider — Barrel Roll Design

Date: 2026-06-12
Status: Approved
Builds on: nitro (validated)

## 1. Concept

Q/E roll the jetski mid-air; completing a full 360° pays an instant bonus
that chains within one flight and feeds nitro (200+ points = big).

## 2. Mechanics (`src/vessel.ts`)

- `VesselInput.roll?: number` — Q = −1 (left), E = +1 (right, starboard-
  down positive). Mapped in `KeyboardInput`.
- **Air only.** While `roll ≠ 0` airborne, roll velocity converges quickly
  to `rollInput · rollRate` (tunable, default 4.5 rad/s ≈ 1.4 s per
  rotation), replacing the roll-axis auto-level. Pitch auto-level stays
  active. On water the input is ignored.
- **Completion detection:** `airRollAccum += rollVel · dt` while airborne.
  On |accum| ≥ 2π: set per-step event `justBarrelRolled = true`, subtract
  2π from accum AND from `roll` (identical orientation; the auto-level
  spring then sees "level" instead of unwinding a full turn backwards).
- **Landing:** wrap `roll` to ±π (recover the short way), zero accum.
  Releasing Q/E mid-roll → auto-level recovers, no event, no points.

## 3. Scoring (`src/score.ts`)

- Kind `barrelRoll`, names: BARREL ROLL · CAPSIZE AVERTED · SPIN2WIN.
- `barrelRoll()`: points = `rollPoints + (chain − 1) · 100` (rollPoints
  tunable, default 200); chain counts rolls within one flight, reset in
  `landed()`. Paid instantly mid-air. 200+ ⇒ big ⇒ yellow popup + nitro.

## 4. Wiring

Main fixed-step loop forwards `vessel.justBarrelRolled` →
`score.barrelRoll()`; popup positions at the vessel. `rollRate` slider in
the Air folder; `rollPoints` in Score. Ragdoll needs nothing — mounts
already follow full vessel orientation (centrifuged doll for free) and
hull-frame collision works at any roll angle.

## 5. Testing

Vessel: sustained air roll → ≥1 completion event with wrapped angle;
no events on water. Score: chain escalation 200/300, reset on landing.

## 6. Risks

Roll + the chase cam (no roll component) reads fine; if the horizon flip
disorients, rollRate is the knob. Accidental Q/E on keyboards near WASD —
acceptable, air-only gating limits surprises.
