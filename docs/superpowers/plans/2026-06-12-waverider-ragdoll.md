# Ragdoll Rider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A blocky Verlet ragdoll whose hands are pinned to the front deck, tossed around by jumps and skipping across the water at speed.

**Architecture:** 12 Verlet particles + 14 distance constraints relaxed 4× per fixed step, hands hard-pinned to vessel-space mounts each iteration. Water contact pushes particles to the surface and damps horizontal motion (skip & drag), emitting rate-limited bursts through the existing Splash pool. Rendering is 10 boxes synced to bone midpoints. One-way coupling: the doll never affects vessel physics.

**Tech Stack:** Plain TypeScript + three.js math classes; Vitest for solver behavior.

**Spec:** `docs/superpowers/specs/2026-06-12-waverider-ragdoll-design.md`
**Conventions:** commits `## - <one-liner>`; forward = (sin yaw, 0, cos yaw); mesh orientation YXZ with x=−pitch, z=−roll.

---

### Task 1: Ragdoll solver + meshes — TDD

**Files:**
- Modify: `src/vessel.ts` (export `VISUAL_FLOAT_OFFSET`)
- Create: `src/ragdoll.ts`
- Test: `tests/ragdoll.test.ts`

- [ ] **Step 1:** In `src/vessel.ts`, change `const VISUAL_FLOAT_OFFSET = 0.25` to `export const VISUAL_FLOAT_OFFSET = 0.25` (the ragdoll mounts must match the rendered hull, not the physics point).

- [ ] **Step 2: Write failing tests — `tests/ragdoll.test.ts`:**

```ts
import { describe, expect, it } from 'vitest'
import { Ragdoll } from '../src/ragdoll'
import { Vessel, VISUAL_FLOAT_OFFSET } from '../src/vessel'

const STEP = 1 / 60
const flatWater = () => 0

function makeDoll() {
  const vessel = new Vessel()
  const doll = new Ragdoll()
  doll.reset(vessel)
  return { vessel, doll }
}

describe('Ragdoll', () => {
  it('settles with every constraint near its rest length', () => {
    const { vessel, doll } = makeDoll()
    for (let i = 0; i < 240; i++) {
      doll.update(STEP, vessel, flatWater)
    }
    expect(doll.maxConstraintError()).toBeLessThan(0.05)
  })

  it('keeps the hands pinned to the deck mounts', () => {
    const { vessel, doll } = makeDoll()
    for (let i = 0; i < 60; i++) {
      doll.update(STEP, vessel, flatWater)
    }
    const handL = doll.particles[0].pos
    expect(handL.x).toBeCloseTo(-0.35, 3)
    expect(handL.y).toBeCloseTo(0.5 + VISUAL_FLOAT_OFFSET, 3)
    expect(handL.z).toBeCloseTo(1.5, 3)
  })

  it('pushes submerged particles back toward the surface', () => {
    const { vessel, doll } = makeDoll()
    const foot = doll.particles[10]
    foot.pos.y = -5
    foot.prev.y = -5
    doll.update(STEP, vessel, flatWater)
    expect(foot.pos.y).toBeGreaterThan(-5)
  })

  it('stays finite through violent vessel motion', () => {
    const { vessel, doll } = makeDoll()
    for (let i = 0; i < 600; i++) {
      vessel.position.set(Math.sin(i * 0.5) * 30, Math.cos(i * 0.7) * 8, i * 1.5)
      vessel.yaw = i * 0.3
      vessel.pitch = Math.sin(i) * 0.8
      doll.update(STEP, vessel, flatWater)
    }
    for (const p of doll.particles) {
      expect(Number.isFinite(p.pos.x + p.pos.y + p.pos.z)).toBe(true)
    }
  })
})
```

- [ ] **Step 3:** `npm run test` — ragdoll tests FAIL (module missing); 20 others pass.

- [ ] **Step 4: Create `src/ragdoll.ts`:**

```ts
import * as THREE from 'three'
import { VISUAL_FLOAT_OFFSET } from './vessel'
import type { Vessel, SurfaceSampler } from './vessel'
import type { Splash } from './splash'

// particle indices
const HAND_L = 0
const HAND_R = 1
const ELBOW_L = 2
const ELBOW_R = 3
const SHOULDER_L = 4
const SHOULDER_R = 5
const HEAD = 6
const PELVIS = 7
const KNEE_L = 8
const KNEE_R = 9
const FOOT_L = 10
const FOOT_R = 11
const PARTICLE_COUNT = 12

const ITERATIONS = 4
const MAX_STEP_MOVE = 3 // metres per step — NaN backstop on violent landings
const SPLASH_MIN_IMPACT = 3
const SPLASH_INTERVAL = 0.125 // ≤ 8 bursts/s so the doll can't drain the pool
const MOUNT_L = new THREE.Vector3(-0.35, 0.5 + VISUAL_FLOAT_OFFSET, 1.5)
const MOUNT_R = new THREE.Vector3(0.35, 0.5 + VISUAL_FLOAT_OFFSET, 1.5)
const UP = new THREE.Vector3(0, 1, 0)

export interface RagdollTuning {
  gravity: number
  damping: number
  waterDrag: number
}

export const defaultRagdollTuning: RagdollTuning = { gravity: 14, damping: 0.985, waterDrag: 6 }

export interface RagdollParticle {
  pos: THREE.Vector3
  prev: THREE.Vector3
}

interface Constraint {
  a: number
  b: number
  rest: number
}

// (a, b, rest length) — ~1.7 m figure
const CONSTRAINTS: Constraint[] = [
  { a: HAND_L, b: ELBOW_L, rest: 0.28 },
  { a: HAND_R, b: ELBOW_R, rest: 0.28 },
  { a: ELBOW_L, b: SHOULDER_L, rest: 0.3 },
  { a: ELBOW_R, b: SHOULDER_R, rest: 0.3 },
  { a: SHOULDER_L, b: SHOULDER_R, rest: 0.36 },
  { a: SHOULDER_L, b: HEAD, rest: 0.28 },
  { a: SHOULDER_R, b: HEAD, rest: 0.28 },
  { a: SHOULDER_L, b: PELVIS, rest: 0.55 },
  { a: SHOULDER_R, b: PELVIS, rest: 0.55 },
  { a: HEAD, b: PELVIS, rest: 0.75 }, // anti-fold brace
  { a: PELVIS, b: KNEE_L, rest: 0.42 },
  { a: PELVIS, b: KNEE_R, rest: 0.42 },
  { a: KNEE_L, b: FOOT_L, rest: 0.4 },
  { a: KNEE_R, b: FOOT_R, rest: 0.4 },
]

// resting pose offsets in vessel-local space (hands land on the mounts)
const POSE: [number, number, number][] = [
  [-0.35, 0.5, 1.5],
  [0.35, 0.5, 1.5],
  [-0.3, 0.45, 1.25],
  [0.3, 0.45, 1.25],
  [-0.18, 0.5, 1.0],
  [0.18, 0.5, 1.0],
  [0, 0.65, 0.85],
  [0, 0.45, 0.45],
  [-0.12, 0.4, 0.05],
  [0.12, 0.4, 0.05],
  [-0.14, 0.35, -0.35],
  [0.14, 0.35, -0.35],
]

const LIMB_BONES: [number, number][] = [
  [HAND_L, ELBOW_L],
  [HAND_R, ELBOW_R],
  [ELBOW_L, SHOULDER_L],
  [ELBOW_R, SHOULDER_R],
  [PELVIS, KNEE_L],
  [PELVIS, KNEE_R],
  [KNEE_L, FOOT_L],
  [KNEE_R, FOOT_R],
]

/**
 * Verlet ragdoll pinned by the hands to the front deck. Position-based:
 * integrate, relax distance constraints, re-pin hands each iteration —
 * stable by construction, no spring stiffness to explode. One-way coupling:
 * the vessel moves the doll, never the reverse.
 */
export class Ragdoll {
  readonly group = new THREE.Group()
  tuning: RagdollTuning = { ...defaultRagdollTuning }
  readonly particles: RagdollParticle[] = []
  private readonly limbMeshes: { mesh: THREE.Mesh; a: number; b: number }[] = []
  private readonly torsoMesh: THREE.Mesh
  private readonly headMesh: THREE.Mesh
  private readonly mountL = new THREE.Vector3()
  private readonly mountR = new THREE.Vector3()
  private readonly orientation = new THREE.Quaternion()
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ')
  private readonly tmp = new THREE.Vector3()
  private splashCooldown = 0

  constructor() {

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      this.particles.push({ pos: new THREE.Vector3(), prev: new THREE.Vector3() })
    }

    const wetsuit = new THREE.MeshStandardMaterial({ color: 0xffd54f })
    for (const [a, b] of LIMB_BONES) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.11, 1, 0.11), wetsuit)
      this.limbMeshes.push({ mesh, a, b })
      this.group.add(mesh)
    }

    this.torsoMesh = new THREE.Mesh(new THREE.BoxGeometry(0.34, 1, 0.18), wetsuit)
    this.group.add(this.torsoMesh)

    this.headMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.22, 0.22),
      new THREE.MeshStandardMaterial({ color: 0xfafafa }),
    )
    this.group.add(this.headMesh)
  }

  /** Worst relative constraint-length error — exposed for tests. */
  maxConstraintError(): number {

    let worst = 0
    for (const c of CONSTRAINTS) {
      const dist = this.particles[c.a].pos.distanceTo(this.particles[c.b].pos)
      worst = Math.max(worst, Math.abs(dist - c.rest) / c.rest)
    }

    return worst
  }

  /** Snap the doll into its deck pose with zero velocity. */
  reset(vessel: Vessel) {

    this.computeMounts(vessel)
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const p = this.particles[i]
      this.tmp.set(POSE[i][0], POSE[i][1] + VISUAL_FLOAT_OFFSET, POSE[i][2])
        .applyQuaternion(this.orientation)
        .add(vessel.position)
      p.pos.copy(this.tmp)
      p.prev.copy(this.tmp)
    }
    this.syncMeshes()
  }

  update(dt: number, vessel: Vessel, sampleHeight: SurfaceSampler, splash?: Splash) {

    const t = this.tuning
    this.computeMounts(vessel)
    this.splashCooldown = Math.max(0, this.splashCooldown - dt)

    for (const p of this.particles) {
      const vx = (p.pos.x - p.prev.x) * t.damping
      const vy = (p.pos.y - p.prev.y) * t.damping
      const vz = (p.pos.z - p.prev.z) * t.damping
      const move = Math.hypot(vx, vy, vz)
      const scale = move > MAX_STEP_MOVE ? MAX_STEP_MOVE / move : 1
      p.prev.copy(p.pos)
      p.pos.x += vx * scale
      p.pos.y += vy * scale - t.gravity * dt * dt
      p.pos.z += vz * scale
    }

    for (let iter = 0; iter < ITERATIONS; iter++) {
      this.particles[HAND_L].pos.copy(this.mountL)
      this.particles[HAND_R].pos.copy(this.mountR)
      for (const c of CONSTRAINTS) {
        const pa = this.particles[c.a].pos
        const pb = this.particles[c.b].pos
        let dx = pb.x - pa.x
        let dy = pb.y - pa.y
        let dz = pb.z - pa.z
        const dist = Math.hypot(dx, dy, dz) || 1e-6
        const push = ((dist - c.rest) / dist) * 0.5
        dx *= push
        dy *= push
        dz *= push
        pa.x += dx
        pa.y += dy
        pa.z += dz
        pb.x -= dx
        pb.y -= dy
        pb.z -= dz
      }
    }
    this.particles[HAND_L].pos.copy(this.mountL)
    this.particles[HAND_R].pos.copy(this.mountR)

    // skip & drag: submerged parts get pushed up and slowed sideways
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      if (i === HAND_L || i === HAND_R) {
        continue
      }
      const p = this.particles[i]
      const surface = sampleHeight(p.pos.x, p.pos.z)
      if (p.pos.y < surface) {
        const impact = (p.prev.y - p.pos.y) / dt
        p.pos.y += (surface - p.pos.y) * 0.6
        const drag = Math.min(t.waterDrag * dt, 1)
        p.prev.x += (p.pos.x - p.prev.x) * drag
        p.prev.z += (p.pos.z - p.prev.z) * drag
        if (splash && impact > SPLASH_MIN_IMPACT && this.splashCooldown <= 0) {
          this.splashCooldown = SPLASH_INTERVAL
          splash.burst(p.pos, 6, Math.min(impact * 0.4, 4))
        }
      }
    }

    this.syncMeshes()
  }

  private computeMounts(vessel: Vessel) {

    this.euler.set(-vessel.pitch, vessel.yaw, -vessel.roll)
    this.orientation.setFromEuler(this.euler)
    this.mountL.copy(MOUNT_L).applyQuaternion(this.orientation).add(vessel.position)
    this.mountR.copy(MOUNT_R).applyQuaternion(this.orientation).add(vessel.position)
  }

  private syncMeshes() {

    for (const { mesh, a, b } of this.limbMeshes) {
      this.placeBone(mesh, this.particles[a].pos, this.particles[b].pos)
    }

    this.tmp.copy(this.particles[SHOULDER_L].pos).add(this.particles[SHOULDER_R].pos).multiplyScalar(0.5)
    this.placeBone(this.torsoMesh, this.tmp, this.particles[PELVIS].pos)

    this.headMesh.position.copy(this.particles[HEAD].pos)
  }

  private placeBone(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3) {

    mesh.position.copy(a).add(b).multiplyScalar(0.5)
    this.tmp.copy(b).sub(a)
    const len = Math.max(this.tmp.length(), 0.001)
    mesh.scale.y = len
    mesh.quaternion.setFromUnitVectors(UP, this.tmp.divideScalar(len))
  }
}
```

- [ ] **Step 5:** `npm run test` — 24 pass. **Step 6:** Commit:

```bash
git add src/vessel.ts src/ragdoll.ts tests/ragdoll.test.ts
git commit -m "## - Add Verlet ragdoll rider pinned by the hands to the front deck"
```

---

### Task 2: Wiring + R-key reset + tuning folder

**Files:** Modify `src/main.ts`, `src/tuning.ts`

- [ ] **Step 1: `src/main.ts`** — import `{ Ragdoll }` from './ragdoll'; after `splash` setup:

```ts
const ragdoll = new Ragdoll()
scene.add(ragdoll.group)
ragdoll.reset(vessel)

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyR') {
    ragdoll.reset(vessel)
  }
})
```

Inside the fixed-step loop, after `vessel.update(...)` (so the doll sees this step's transform):

```ts
    ragdoll.update(STEP, vessel, sampler, splash)
```

Add `ragdoll: ragdoll.tuning` to the `createTuningPanel` call.

- [ ] **Step 2: `src/tuning.ts`** — add `import type { RagdollTuning } from './ragdoll'`, add `ragdoll: RagdollTuning` to `TuningTargets`, and after the Visuals folder:

```ts
  const rag = gui.addFolder('Ragdoll')
  rag.add(targets.ragdoll, 'gravity', 4, 30, 0.5)
  rag.add(targets.ragdoll, 'damping', 0.9, 0.999, 0.001)
  rag.add(targets.ragdoll, 'waterDrag', 0, 15, 0.25)
```

- [ ] **Step 3:** `npm run test` (24), `npm run build` (clean). Headless screenshot sweep: doll visible kneeling at the bow at idle; flailing during a jump; skipping on water at speed. Human playtest for comedy. **Step 4:** Commit:

```bash
git add src/main.ts src/tuning.ts
git commit -m "## - Wire ragdoll rider into the game loop with R-key reset and tuning folder"
```

---

## Plan self-review record

- **Spec coverage:** §3.1 solver/constraints/mounts/water/render → Task 1; §3.2 integration + fixed-step determinism → Task 2; §3.3 tuning → Task 2; §4 tests (convergence, pinning, water push, NaN guard) → Task 1 Step 2. Spec says "11 particles" but the listed roster is 12 — the spec text will be corrected to 12 in Task 2's commit.
- **Placeholders:** none.
- **Type consistency:** `Ragdoll.particles[i].pos/.prev` used by tests matches `RagdollParticle`; `maxConstraintError()` defined and used; `SurfaceSampler` imported from vessel; `splash.burst(Vector3, count, speed)` matches Splash's existing signature; `VISUAL_FLOAT_OFFSET` export consumed in both ragdoll.ts and tests.
