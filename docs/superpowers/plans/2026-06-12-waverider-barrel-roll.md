# Barrel Roll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Q/E air barrel rolls with instant chaining bonuses that feed nitro.

**Architecture:** Roll input overrides the roll-axis auto-level while airborne; accumulated air-roll detects 2π completions and re-wraps the roll angle so the spring never unwinds backwards. Per-step `justBarrelRolled` event → `score.barrelRoll()` chain. All patterns are established in the codebase.

**Spec:** `docs/superpowers/specs/2026-06-12-waverider-barrel-roll-design.md`

### Task 1: Vessel roll mechanics — TDD (`src/vessel.ts`, `tests/vessel.test.ts`)
Tests: 3 s of `roll: 1` over a void → ≥1 `justBarrelRolled` with |roll| < 2π; same input on flat water → 0 events. Impl: `VesselInput.roll`, `VesselTuning.rollRate: 4.5`, air-branch override + accumulator + wrap, landing wrap to ±π, Q/E in KeyboardInput. Commit: `## - Add Q and E air barrel roll mechanics with completion events`.

### Task 2: Scoring + wiring (`src/score.ts`, `src/main.ts`, `src/tuning.ts`, `README.md`)
Tests: chain 200/300 within a flight, reset on landed(). Impl: `barrelRoll` kind + names + `rollPoints: 200` tuning + chain; main loop event forwarding + popup at vessel; `rollRate`/`rollPoints` sliders; README controls row. Commit: `## - Score chaining barrel roll bonuses that feed nitro`.

## Plan self-review record
Spec §2 → Task 1; §3–4 → Task 2; §5 tests → both. Type names match existing patterns (`justBarrelRolled` mirrors `justLanded`/`justTookOff`).
