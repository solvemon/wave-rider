# Nitro Boost Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nitro bar charged by big (yellow) bonuses; hold Space for a speed surge with a stern flame jet.

**Architecture:** Pure `NitroState` (economy) + `NitroFire` (additive flame particles, pooled like Splash) + `NitroBar` (DOM). Score bonuses gain a `big` flag that drives both popup styling and nitro fill. Vessel gets a gated `boost` input flag and a `boostThrust` constant — physics stays ignorant of the economy.

**Tech Stack:** TypeScript, three.js Points + additive blending, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-12-waverider-nitro-design.md`
**Conventions:** commits `## - <one-liner>`; forward = (sin yaw, 0, cos yaw).

---

### Task 1: `Bonus.big` flag + `NitroState` — TDD

Tests: big flag on ≥150-point bonuses (`tests/score.test.ts`); NitroState fill/cap/drain/gating (`tests/nitro.test.ts`). Implementation: `bigThreshold: 150` in ScoreTuning, `big` computed in `award()`; `src/nitro.ts` `NitroState` exactly as specced (charge clamped [0,1], `tick` drains `dt/drainTime` only while wanted and charged). Commit: `## - Add big-bonus flag and nitro charge state`.

### Task 2: Vessel boost input — TDD

Test (`tests/vessel.test.ts`): two vessels full-throttle 3 s on flat water, one with `boost: true` → strictly faster. Implementation: `VesselInput.boost?: boolean`, `VesselTuning.boostThrust: 30`, water branch applies `+ (input.boost ? t.boostThrust : 0)` alongside throttleAccel; `KeyboardInput` tracks Space with preventDefault. Commit: `## - Add boost thrust input to vessel physics and Space key`.

### Task 3: Fire VFX + bar + wiring + tuning

`NitroFire` (256-particle pool, additive flame shader, stern emission while boosting) and `NitroBar` (DOM) in `src/nitro.ts`; main.ts wiring (gated input via `nitro.tick` per fixed step, `frameBoosting` for VFX, big bonuses → `addBonus`, popup big styling from `bonus.big`); Nitro tuning folder. Headless verification: boost run screenshot with flames + drained bar. Commit: `## - Add nitro fire jet, charge bar and game loop wiring`.

---

## Plan self-review record

Spec §2 economy → Tasks 1/3; §3.1 → Tasks 1/3; §3.2 → Task 1; §3.3 → Task 2; §3.4–3.5 → Task 3; §4 tests → Tasks 1–2. (Compact plan: full code written inline during execution — all patterns are established clones of Splash/ScoreState/overlay code already in the repo.)
