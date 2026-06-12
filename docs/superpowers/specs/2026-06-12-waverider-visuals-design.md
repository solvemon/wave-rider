# Waverider — Visuals Pass Design

Date: 2026-06-12
Status: Approved
Builds on: `2026-06-12-waverider-prototype-design.md` (core prototype, validated)

## 1. Concept

The core feel is validated ("extremely satisfying"). This pass adds the
visual layer that sells it: stylized foamy water effects — upgraded ocean
shading with crest foam, a wake ribbon, splash/spray particles — plus a
visible sun and sky gradient. Style: chunky, readable, arcade
(Wind-Waker-adjacent), tuned to the existing calm-evening teal palette.

## 2. Scope

**In:** sky dome with sun disc; analytic ocean normals + sun lighting +
specular; procedural crest foam; stern wake ribbon; pooled splash/spray
particles (landing burst, takeoff puff, bow spray); "Visuals" tuning
folder; vessel exposes landing/takeoff events.

**Out:** textures/assets of any kind (all procedural), reflections,
refraction, underwater view, clouds, day/night cycle, audio.

## 3. Components

### 3.1 Sky (`src/sky.ts`, new)
- Inverted sphere (~radius 500) following the camera each frame,
  `frustumCulled = false`, rendered with depth write off.
- Fragment shader: vertical gradient warm-horizon → muted-blue zenith;
  sun disc with soft radial glow at a direction uniform.
- Exports the sun direction (azimuth/elevation, tunable) consumed by:
  the ocean material (lighting), the scene's DirectionalLight (vessel
  lighting), and the sky shader itself. One source of truth in main.ts.
- Ocean's distance-fade color becomes the sky horizon color (uniform),
  keeping the mesh edge invisible.

### 3.2 Ocean shading (`src/ocean.ts`, GLSL chunk extended in `src/waves.ts`)
- `gerstnerGLSL` gains `gerstnerNormal(vec2 p)`: analytic normal from
  the accumulated partial derivatives of the same wave sum (GPU Gems
  formulation). **GPU-only — the CPU/GPU equivalence invariant covers
  displacement only; normals are visual. Documented at the function.**
- Vertex shader passes the normal; fragment does: lambert (sun dir +
  ambient floor), Blinn-Phong specular streak, existing height gradient
  + fresnel + distance fade.
- Crest foam mask: compression term (negative divergence of horizontal
  displacement ≈ sharp crest) combined with height, thresholded and
  broken up by cheap hash noise; mixed in as near-white slightly-warm.
  Foam threshold and intensity are uniforms (sliders).

### 3.3 Vessel events (`src/vessel.ts`)
- New readonly per-step fields, set in `update()`:
  - `justLanded: number` — downward impact speed on the water→air→water
    transition this step, else 0.
  - `justTookOff: boolean` — true only on the step airborne became true.
- Pure data; no callbacks. VFX reads them after each physics step.

### 3.4 Wake (`src/wake.ts`, new)
- Ring buffer of up to 96 stern samples (world pos + age), pushed every
  0.05 s while in water and forward speed > ~4 m/s.
- Triangle-strip ribbon: width grows with age (≈0.8 m → 3 m), alpha
  fades to 0 over a tunable lifetime (~2.5 s); y conformed to
  `surfaceHeight` + 0.05 each frame (CPU, ≤96 samples — cheap).
- ShaderMaterial: foam white, soft edges, hash-noise breakup, additive-
  ish transparent blend, `depthWrite: false`. Self-overlap in tight
  turns is acceptable.

### 3.5 Splash/spray (`src/splash.ts`, new)
- One pooled particle system: `THREE.Points`, capacity 512, typed-array
  CPU sim (position, velocity, life, size); dead particles recycled.
- Procedural sprite: radial soft falloff in the point fragment shader,
  white, alpha by life. Gravity applied; particles live ~0.4–1.2 s.
- Emitters (all read vessel state after physics step):
  1. **Landing burst:** count and spread scale with `justLanded` impact
     speed; ejected outward/up from the hull waterline.
  2. **Takeoff puff:** small fixed burst on `justTookOff`.
  3. **Bow spray:** continuous emission while in water, rate scales
     with planing intensity (forward speed), ejected from bow port/
     starboard angled outward, giving the V-spray read.

### 3.6 Tuning (`src/tuning.ts`)
- New "Visuals" folder: foamThreshold, foamIntensity, wakeWidth,
  wakeLifetime, sprayRate, splashIntensity, sunAzimuth, sunElevation.
  Sun changes propagate to sky, ocean and DirectionalLight.

## 4. Data flow

```
main.ts owns: sunDir, visualTuning
  sky.update(camera, sunDir)
  ocean uniforms ← sunDir, horizon color, foam params
  physics step → vessel.justLanded / justTookOff / planing state
  wake.update(dt, vessel, sampler)
  splash.update(dt, vessel)
```

## 5. What is real vs hacky

**Real:** analytic Gerstner normals, compression-based foam mask,
pooled-particle architecture, event seam on the vessel.
**Hacky (fine for prototype):** procedural-only sprites, ribbon overlap
in turns, no particle-water collision (life-based death only).

## 6. Testing

- Unit (Vitest): vessel `justLanded`/`justTookOff` transitions (drop
  onto flat water; surface drop-away); wake ring-buffer push/expire
  logic (pure math, exported helper).
- Visual: headless Chromium screenshots (idle foam, full-throttle wake +
  bow spray, landing splash) + human playtest.

## 7. Risks

- Foam-mask look is tuning-sensitive → sliders, iterate live.
- Additive/transparent sorting artifacts between wake, splash, ocean →
  render order: ocean → wake → splash, all effects depthWrite off.
- Per-frame wake buffer rewrite is ≤192 verts — negligible.
