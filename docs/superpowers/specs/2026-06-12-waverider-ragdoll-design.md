# Waverider — Ragdoll Rider Design

Date: 2026-06-12
Status: Approved
Builds on: prototype + visuals pass (both validated)

## 1. Concept

A blocky ragdoll person whose hands are pinned to two grips on the front
deck. The body is fully physical: jumps, landings and carves toss him
around; at speed his body skips and drags across the water. Pure comedy
juice — no gameplay function.

## 2. Approach

Verlet integration + distance-constraint relaxation (Jakobsen). Chosen
over spring-mass (explodes at 60 Hz with stiff joints) and over adding a
physics engine (11 particles do not justify a dependency).

## 3. Components

### 3.1 `src/ragdoll.ts` (new)

**Particles (11):** hands L/R (pinned), elbows L/R, shoulders L/R, head,
pelvis, knees L/R, feet L/R. Each particle: position + previous position
(velocity is implicit).

**Constraints (14):** hand–elbow ×2, elbow–shoulder ×2, shoulder–shoulder,
shoulder–head ×2, shoulder–pelvis ×2, head–pelvis (anti-fold brace),
pelvis–knee ×2, knee–foot ×2. Rest lengths from a fixed body-proportion
table (~1.7 m figure).

**Step (runs in the fixed 60 Hz loop, after `vessel.update`):**
1. Verlet integrate: `pos += (pos − prev) * damping + gravity·dt²`,
   damping ≈ 0.985; per-step displacement capped (≤ 3 m) to prevent NaN
   spirals on violent landings.
2. 4 relaxation iterations: enforce every distance constraint; re-pin
   both hands to their mount points each iteration.
3. Water (skip & drag): for each particle below `surfaceHeight(x, z)`,
   push y back toward the surface (lerp ~0.6) and damp horizontal
   implied velocity (drag ~6/s). Fast re-entry (impact > ~3 m/s) emits a
   small `Splash.burst` at the particle, rate-limited to ≤ 8 bursts/s
   total so the ragdoll cannot drain the splash pool.

**Mounts:** hull-space grips `(±0.35, 0.5, +1.5)` transformed by the
vessel's position + YXZ orientation (same convention as
`syncVesselMesh`, including the visual float offset).

**Rendering:** one box per bone — upper/lower arms ×2, thighs/shins ×2,
torso slab (shoulder-midpoint → pelvis), head cube. Bright yellow
wetsuit (`0xffd54f`), white helmet head. Per frame each box is placed at
its bone midpoint and quaternion-aligned to the bone direction.
Exposed as a `THREE.Group`.

**API:**
```
class Ragdoll {
  readonly group: THREE.Group
  tuning: { gravity, damping, waterDrag }
  reset(vessel): void                 // snap doll onto the deck
  update(dt, vessel, sampleHeight, splash?): void
  // particles exposed readonly for tests
}
```

### 3.2 Integration (`src/main.ts`)
- Construct after splash; `scene.add(ragdoll.group)`.
- `ragdoll.update(STEP, vessel, sampler, splash)` inside the fixed-step
  loop (deterministic flailing).
- Mesh sync is internal to update (cheap, 12 boxes).

### 3.3 Tuning (`src/tuning.ts`)
"Ragdoll" folder: gravity (4–30, default 14), damping (0.9–0.999,
default 0.985), waterDrag (0–15, default 6).

## 4. Testing

Unit (Vitest, no rendering needed):
- A free chain settles so every constraint is within 5% of rest length.
- Pinned hands remain exactly at their mounts after update.
- A particle forced below a flat surface is pushed up by update.
- 10 s of violent vessel motion produces finite positions (NaN guard).

Play: the comedy is the acceptance test.

## 5. What is real vs hacky

**Real:** Verlet/PBD solver pattern, deterministic fixed-step sim,
constraint table.
**Hacky:** no joint angle limits (elbows bend backwards — funnier), no
self-collision, body has no effect on vessel physics (one-way coupling).

## 6. Risks

High-speed water drag may cause violent oscillation → tunable damping/
drag, displacement cap as backstop. Splash-pool starvation → rate limit.
