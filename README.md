# Waverider

A browser prototype answering one question: **is riding and jumping
procedural waves inherently fun?** Casual, relaxing, arcade. No goals, no
score — just a vessel, an endless ocean, and swells to launch off.

## Run it

```bash
npm install
npm run dev    # open the printed URL
```

`npm run test` runs the physics/wave-math unit tests, `npm run build`
type-checks and bundles.

## Controls

| Key | Action |
|---|---|
| W / ↑ | Throttle (nose-up in the air) |
| S / ↓ | Reverse / brake (nose-down in the air) |
| A / D | Steer |
| H | Show/hide the tuning panel |
| R | Reset the ragdoll rider onto the deck |

## Playtesting — what to look for

Chase the two big swells (they travel to your right at spawn), drive up
the back of one at full throttle, and jump it. Steering is jetski-style:
the nozzle only bites under throttle, and turns carve — the hull drifts
through them rather than pivoting on rails. Then open the tuning panel
(H) and twiddle. The prototype's core unknown is whether **jumpable** waves
and a **chill** vibe coexist — try to find a parameter set that gives both,
and note what you changed.

## Architecture in one paragraph

`src/waves.ts` is the single source of truth for the ocean: a sum of six
Gerstner waves implemented twice in equivalent form — once in GLSL
(displaces the ocean mesh on the GPU) and once in TypeScript (sampled by
the vessel physics on the CPU). If you change one, change the other.
`src/vessel.ts` is a ~100-line arcade rigid body: 4 hull-point sampling for
buoyancy and attitude, a floaty ballistic air state, cushioned landings.
`src/camera.ts` is a lagged chase camera. `src/tuning.ts` exposes every
feel constant live. Design doc:
`docs/superpowers/specs/2026-06-12-waverider-prototype-design.md`.

## Real vs hacky

**Transferable:** the shared wave function architecture, the Gerstner math,
the buoyancy/flight/landing model. **Prototype-only:** box-placeholder
vessel, no audio, no particles, minimal water shading, keyboard only.
