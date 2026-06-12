# Waverider — Nitro Boost Design

Date: 2026-06-12
Status: Approved
Builds on: scoring layer (validated)

## 1. Concept

Big tricks charge a nitro bar; holding Space spends it on a violent speed
surge with a flame jet out the stern. Closes the loop: jump big → earn
boost → go faster → jump bigger.

## 2. Economy

- A bonus is **big** when `points >= bigThreshold` (default 150, tunable).
  Big bonuses render yellow/large (generalizing the old megaSmack-only
  styling) AND charge nitro by `points / pointsToFull` (default 500 —
  a 220 BIG AIR ≈ 44%, a 288 MEGA SMACK ≈ 58%).
- **Hold Space to boost**: drains the bar in `drainTime` (2.5 s) from
  full; release to keep the remainder; usable at any charge.

## 3. Components

### 3.1 `src/nitro.ts` (new)
- **`NitroState`** (pure): `charge` 0..1, `addBonus(points)` (caller
  filters for big), `tick(dt, wantBoost): boolean` — drains while wanted
  and charged, returns whether boosting. Tuning `{ pointsToFull, drainTime }`.
- **`NitroFire`**: 256-particle pooled `THREE.Points`, **additive**
  blending, flame fragment color young→white-yellow, old→red, soft round
  sprites. While boosting, ~120 particles/s from the stern
  (vessel − forward·2.0, +0.3 up), velocity backward 7–12 m/s + 60% hull
  velocity inheritance + jitter, slight upward drift, life 0.25–0.55 s.
  Emits in air too (rule of cool). renderOrder 3.
- **`NitroBar`**: DOM — bottom-left 220×12 track, orange fill by charge,
  yellow when full, small NITRO label.

### 3.2 `src/score.ts`
- `Bonus` gains `big: boolean` (`points >= tuning.bigThreshold`).
- `ScoreTuning` gains `bigThreshold: 150`.
- Overlay popup styling keys off `bonus.big` (was `kind === 'megaSmack'`).

### 3.3 `src/vessel.ts`
- `VesselInput.boost?: boolean`; `VesselTuning.boostThrust: 30` —
  applied as extra keel acceleration in the water branch while boosting.
  Vessel knows nothing about charge; main gates the flag via
  `nitro.tick`.
- `KeyboardInput` maps Space (`preventDefault` to stop page scroll).

### 3.4 main loop
- Fixed step: `boosting = nitro.tick(STEP, spaceHeld)`; effective input
  carries the gated boost flag; track `frameBoosting` for VFX.
- Render frame: forward big bonuses to `nitro.addBonus`,
  `fire.update(dt, vessel, frameBoosting)`, `bar.set(nitro.charge)`.

### 3.5 Tuning
"Nitro" folder: pointsToFull (200–2000), drainTime (1–6), boostThrust
(10–60). Score folder gains bigThreshold (50–500).

## 4. Testing

NitroState (fill, cap, drain timing, gating); Bonus.big flag; vessel
boost acceleration (boosted vs unboosted race on flat water). Fire/bar
by play and screenshots.

## 5. Real vs hacky

Real: nitro economy/state, physics hook, pooled-particle pattern.
Hacky: DOM bar, no sound (onBonus hook exists), flame is sprite-puffs
not a mesh jet.

## 6. Risks

Boost top speed ≈ 2× normal terminal — if wave reading degrades, tune
boostThrust down. Space conflicts with browser scroll → preventDefault.
