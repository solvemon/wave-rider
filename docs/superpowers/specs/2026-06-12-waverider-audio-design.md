# Waverider — Synth Engine Audio Design

Date: 2026-06-12
Status: Approved (designed in conversation)

## 1. Concept

Fully synthetic engine + water ambience via Web Audio — no assets, no
chipmunk pitching — with labeled one-shot slots for the user's found
samples (splashes, bonus dings). Stylized arcade voice to match the game.

## 2. Components (`src/audio.ts`, new)

### 2.1 `EngineModel` (pure, unit-tested)
Virtual engine separating *feel* from *voice*. Normalized `rpm` 0..1.2
lerps (rate ~4/s) toward a target: idle 0.15 + throttle·0.65 on water;
**airborne adds +0.3 (unloaded high-rev)**; boost adds +0.15.
`bogDown(amount)` dips rpm instantly on landings (momentary load).

### 2.2 `EngineVoice` (Web Audio)
- Saw osc at firing frequency `f = 45 + rpm·110` Hz, square osc at 2f
  (slightly detuned), sine sub at f/2 for body.
- Looped white-noise exhaust hiss through a bandpass, gain ∝ rpm.
- Waveshaper (soft tanh) for grit → **fixed-range lowpass** (cutoff
  900 + rpm·1800 Hz) — the fixed body is what prevents chipmunking.
- Gain 0.12 + rpm·0.2, all param changes via `setTargetAtTime` (no
  zipper noise). Nitro: extra detuned saw + hotter shaper drive.

### 2.3 `WaterAmbience`
Looped noise → lowpass; gain and cutoff scale with |speed|; ducked
while airborne (wind, not spray).

### 2.4 `Sfx` one-shot slots
On init, try-fetch `sfx/{bonus,big-bonus,splash,takeoff,nitro}.mp3`
(via BASE_URL); missing files no-op silently. `play(name)` with ±10%
random rate. Wired: `score.onBonus` → bonus/big-bonus; landing impact →
splash; takeoff → takeoff; boost start edge → nitro.

### 2.5 `AudioSystem` facade
Lazy `AudioContext` on first keydown (browser gesture rule). Tuning
`{ master: 0.5, engine: 0.8 }` → "Audio" panel folder.
`update(dt, vessel, boosting)` drives model → voice → ambience.

## 3. Wiring
main.ts render frame: `audio.update(dt, vessel, frameBoosting)`;
landing/takeoff/bonus events forwarded from existing accumulators.

## 4. Testing
`EngineModel` unit tests (throttle response, airborne rev-up, bog-down).
Web Audio graph is browser-only — verified by ear + a headless check
that the context starts and no exceptions fire.

## 5. Real vs hacky
Real: model/voice separation (voice swappable for samples later).
Hacky: synth timbre is arcade-flavored by design; no doppler/reverb.
