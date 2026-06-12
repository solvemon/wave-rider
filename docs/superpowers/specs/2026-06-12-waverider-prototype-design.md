# Waverider — Prototype Design

Date: 2026-06-12
Status: Approved for implementation planning

## 1. Concept

A browser-based 3D sandbox where you pilot a vessel across an endless
procedurally generated ocean and jump waves. Casual, relaxing, arcade.
No goals, no failure states, no score.

**Success criterion:** a player keeps playing for five minutes because
launching off swells and landing feels good.

## 2. Why it matters

- Validates the core question — "is riding and jumping procedural waves
  inherently fun?" — before any investment in assets, audio, or game loops.
- Browser delivery means the prototype is shareable as a URL: zero-install
  feedback gathering from the team.
- The wave/buoyancy architecture is the transferable core of any future
  production version; everything else is disposable.

## 3. Scope

**In scope (v1):**
- Endless procedural ocean (visual + physical)
- Placeholder vessel (stretched box) with arcade buoyancy and flight physics
- Third-person chase camera
- Keyboard input (W/S throttle, A/D steer)
- Live tuning panel for all feel parameters

**Out of scope (v1):**
- Vessel art, audio, particles/splashes, UI, scoring, mobile/touch,
  realistic water rendering, multiplayer, persistence.

## 4. Stack

- **Three.js + TypeScript + Vite.** Sub-second hot reload; feel-tuning is
  an iteration-speed game.
- **No physics engine.** Custom ~100-line rigid body gives direct control
  over arcade feel; physics engines fight procedurally moving water.
- **No UI framework.** Single scene + game loop.
- **lil-gui** for the tuning panel.

## 5. Architecture

The load-bearing constraint: **one wave function drives both visuals and
physics.** If the GPU ocean and the CPU buoyancy sampler disagree, the
vessel floats through visual waves and the feel is dead.

```
src/waves.ts (single source of truth: wave params + displacement math)
    ├──> GLSL vertex shader chunk ──> visual ocean mesh   (src/ocean.ts)
    └──> TS displacement(x, z, t) ──> buoyancy sampler    (src/vessel.ts)
                                          │
                                vessel rigid body (custom)
```

### File layout

```
src/main.ts        scene setup, game loop, wiring
src/waves.ts       wave parameter set + CPU displacement fn + GLSL chunk
src/ocean.ts       ocean plane mesh + shader material
src/vessel.ts      buoyancy + flight physics + keyboard input
src/camera.ts      chase camera
src/tuning.ts      lil-gui panel bound to all feel parameters
```

## 6. Ocean

- **Sum of ~6 Gerstner waves.** Each wave: direction, amplitude,
  wavelength, steepness, speed. Composition: two big slow swells (the
  jumpable ones) + smaller chop layers for surface texture.
- Wave parameters are defined once in `waves.ts` and consumed by both the
  GLSL shader and the TypeScript displacement function. The two
  implementations must be kept line-for-line equivalent; a comment in each
  points at the other.
- **Gerstner caveat (known issue):** Gerstner waves displace vertices
  horizontally as well as vertically. The CPU sampler must apply the same
  horizontal displacement (or invert it iteratively) so the physics surface
  matches the rendered surface. Sharing height alone is not sufficient.
- The ocean is a single large plane (~512×512 segments) recentered on the
  vessel each frame. The wave field is deterministic from world position
  and time, so the world is endless with no chunk generation.
- Shading: stylized and minimal — depth-based gradient color, simple
  fresnel rim, no reflections/refraction. Calm-evening palette.

## 7. Vessel physics

Custom rigid body integrating position, velocity, and orientation
(pitch/roll/yaw) each frame at a fixed timestep.

**On water:**
- Sample wave surface height + normal at **4 hull points** (bow, stern,
  port, starboard).
- Each submerged point applies a spring force proportional to submersion
  depth, plus velocity damping. Differential forces across the 4 points
  produce natural pitch and roll that follow the water surface.
- Thrust along heading (W), reverse/brake (S), steering torque (A/D),
  slight speed-dependent roll banking in turns.
- Water drag proportional to speed.

**Airborne (all 4 hull points clear of the surface):**
- Ballistic flight with gravity tuned *below* realistic — floatier reads
  as more relaxing.
- Small player pitch control in the air.
- Auto-leveling torque so the vessel can't land catastrophically nose-down.

**Landing:**
- Soft landing damping: vertical velocity absorbed over a few frames so
  re-entry feels cushioned, not crashy.
- Forward speed partially preserved through landings (arcade cheat,
  deliberate).

All constants above (spring stiffness, damping, gravity, thrust, drag,
auto-level strength, landing absorption) are exposed in the tuning panel.

## 8. Camera & input

- Chase camera behind/above the vessel. Position and look-at target are
  lerped at **different** rates — this lag is what sells speed and airtime.
- FOV widens slightly with speed; camera pulls back slightly when airborne.
- Keyboard only: W/S throttle, A/D steer. Air pitch on W/S while airborne.

## 9. Tuning panel

lil-gui panel grouping: Waves (per-layer amplitude/wavelength/steepness/
speed), Physics (gravity, buoyancy spring/damping, thrust, drag), Air
(air gravity, pitch authority, auto-level), Camera (follow lag, FOV
response). This panel is the primary instrument for answering the
project's core question; it ships in the prototype, hidden behind a
keypress if needed.

## 10. What is real vs hacky

**Real (transferable to production):**
- Shared-wave-function architecture
- Gerstner wave implementation
- 4-point buoyancy model and airborne/landing state machine

**Hacky (prototype-only):**
- Vessel is a stretched box
- No audio, no particles, no UI beyond the tuning panel
- Minimal ocean shading
- Desktop keyboard only

## 11. Risks & unknowns

1. **Chill vs jumpable tension (biggest unknown).** Jumping wants steep
   fast waves; relaxation wants gentle ones. Mitigated by making wave
   composition fully tunable at runtime — this becomes a tuning session,
   not a rewrite. If no parameter set satisfies both, that is a *finding*
   of the prototype, and the answer may be spatial variation (calm zones
   and swell zones).
2. **CPU/GPU wave drift.** Handled by the shared-function rule and the
   horizontal-displacement caveat in §6.
3. **Performance.** 6 Gerstner waves on a 512² plane is well within
   budget for a vertex shader; CPU sampling happens at only 4 points.
   Low risk.

## 12. Testing

This is a feel prototype; automated coverage is limited to the math that
must not silently break:
- Unit tests (Vitest) for `waves.ts`: displacement determinism, and a
  CPU-vs-expected fixture so refactors of the TS function get caught.
- Everything else is validated by play and by the tuning panel.

## 13. Next steps after v1

If the feel validates: splash/spray particles, audio (engine + water +
ambient), real vessel asset, wave-zone variation (calm ↔ swells), then a
soft progression wrapper if the team wants one. Each is a separate
decision after playtesting.
