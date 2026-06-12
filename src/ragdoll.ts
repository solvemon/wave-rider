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
const UP = new THREE.Vector3(0, 1, 0)
const DECK_SNAP_RANGE = 0.45 // only snap particles near the surface — large values teleport side-entries onto ledges
const DECK_FRICTION = 5

// Hull-local collision heightfield baked from public/jet_ski.stl by
// scripts/bake-collision.py (includes seat, handlebar cowl and footwells).
// Regenerate if the model, its load transforms, or the vesselMeshTuning
// defaults change. -100 marks cells with no hull (no collision).
const FIELD_X0 = -0.6
const FIELD_Z0 = -2.0
const FIELD_CELL_X = 0.1
const FIELD_CELL_Z = 0.2
const FIELD_NX = 12
const FIELD_NZ = 20
// prettier-ignore
const FIELD_HEIGHTS = new Float32Array([
  0.53, 0.53, 0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 0.53, 0.54, // z=-1.9
  0.62, 0.62, 0.52, 0.52, 0.52, 0.52, 0.52, 0.52, 0.52, 0.52, 0.62, 0.62, // z=-1.7
  0.63, 0.63, 0.53, 0.94, 1.00, 1.00, 1.00, 0.99, 0.90, 0.53, 0.63, 0.63, // z=-1.5
  0.62, 0.62, 0.52, 0.89, 0.93, 0.93, 0.93, 0.92, 0.82, 0.52, 0.62, 0.62, // z=-1.3
  0.61, 0.61, 0.50, 0.93, 0.97, 0.97, 0.97, 0.96, 0.88, 0.50, 0.61, 0.61, // z=-1.1
  0.59, 0.59, 0.49, 0.95, 0.99, 0.99, 0.99, 0.99, 0.90, 0.49, 0.59, 0.59, // z=-0.9
  0.58, 0.58, 0.48, 0.95, 1.00, 1.00, 1.00, 0.99, 0.91, 0.48, 0.58, 0.58, // z=-0.7
  0.57, 0.57, 0.46, 0.89, 0.94, 0.94, 0.94, 0.93, 0.84, 0.46, 0.57, 0.57, // z=-0.5
  0.55, 0.55, 0.45, 0.84, 0.88, 0.88, 0.88, 0.87, 0.79, 0.45, 0.55, 0.55, // z=-0.3
  0.54, 0.54, 0.43, 0.83, 0.87, 0.87, 0.87, 0.86, 0.77, 0.43, 0.54, 0.54, // z=-0.1
  0.52, 0.52, 0.42, 0.87, 0.91, 0.91, 0.91, 0.90, 0.81, 0.42, 0.52, 0.52, // z=0.1
  0.57, 0.57, 0.45, 0.94, 1.00, 1.00, 1.00, 0.98, 0.89, 0.45, 0.57, 0.57, // z=0.3
  0.80, 0.79, 0.79, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 0.79, 0.79, 0.80, // z=0.5
  0.86, 0.94, 0.94, 1.00, 1.05, 1.05, 1.04, 1.05, 1.00, 0.93, 0.94, 0.86, // z=0.7
  0.86, 0.96, 1.00, 1.00, 1.05, 1.04, 1.04, 1.05, 1.00, 1.00, 0.96, 0.86, // z=0.9
  0.85, 0.96, 1.05, 1.05, 1.03, 1.03, 1.03, 1.03, 1.05, 1.05, 0.96, 0.85, // z=1.1
  0.86, 0.96, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 0.96, 0.86, // z=1.3
  0.82, 0.89, 0.93, 0.93, 0.93, 0.93, 0.93, 0.93, 0.93, 0.93, 0.89, 0.82, // z=1.5
  -100, 0.78, 0.89, 0.89, 0.89, 0.89, 0.89, 0.89, 0.89, 0.89, 0.78, -100, // z=1.7
  -100, -100, 0.71, 0.80, 0.80, 0.80, 0.80, 0.80, 0.81, 0.71, 0.61, -100, // z=1.9
])

function deckHeightAt(lx: number, lz: number): number {

  const ix = Math.floor((lx - FIELD_X0) / FIELD_CELL_X)
  const iz = Math.floor((lz - FIELD_Z0) / FIELD_CELL_Z)
  if (ix < 0 || ix >= FIELD_NX || iz < 0 || iz >= FIELD_NZ) {
    return -100
  }

  return FIELD_HEIGHTS[iz * FIELD_NX + ix]
}

export interface RagdollTuning {
  gravity: number
  damping: number
  waterDrag: number
  mountX: number // half-spread of the hand grips (handlebar width)
  mountY: number // grip height above the physics point
  mountZ: number // grip forward position
}

// mount defaults are a first guess at the jetski handlebar — tune live
export const defaultRagdollTuning: RagdollTuning = {
  gravity: 14,
  damping: 0.985,
  waterDrag: 6,
  mountX: 0.2,
  mountY: 1.0,
  mountZ: 0.7,
}

export interface RagdollParticle {
  pos: THREE.Vector3
  prev: THREE.Vector3
}

interface Constraint {
  a: number
  b: number
  rest: number
}

// Oversized on purpose (~2.2 m figure) so he reads clearly from the chase cam.
const SCALE = 1.3

// (a, b, rest length)
const CONSTRAINTS: Constraint[] = [
  { a: HAND_L, b: ELBOW_L, rest: 0.28 * SCALE },
  { a: HAND_R, b: ELBOW_R, rest: 0.28 * SCALE },
  { a: ELBOW_L, b: SHOULDER_L, rest: 0.3 * SCALE },
  { a: ELBOW_R, b: SHOULDER_R, rest: 0.3 * SCALE },
  { a: SHOULDER_L, b: SHOULDER_R, rest: 0.36 * SCALE },
  { a: SHOULDER_L, b: HEAD, rest: 0.28 * SCALE },
  { a: SHOULDER_R, b: HEAD, rest: 0.28 * SCALE },
  { a: SHOULDER_L, b: PELVIS, rest: 0.55 * SCALE },
  { a: SHOULDER_R, b: PELVIS, rest: 0.55 * SCALE },
  { a: HEAD, b: PELVIS, rest: 0.75 * SCALE }, // anti-fold brace
  { a: PELVIS, b: KNEE_L, rest: 0.42 * SCALE },
  { a: PELVIS, b: KNEE_R, rest: 0.42 * SCALE },
  { a: KNEE_L, b: FOOT_L, rest: 0.4 * SCALE },
  { a: KNEE_R, b: FOOT_R, rest: 0.4 * SCALE },
  { a: KNEE_L, b: KNEE_R, rest: 0.3 * SCALE }, // keeps the legs from merging into one
]

// resting pose offsets in vessel-local space: a riding posture — hands on
// the bars, pelvis over the seat, feet in the footwells (constraint
// relaxation + the hull heightfield settle him onto the model in frames)
const POSE: [number, number, number][] = [
  [-0.2, 1.0, 0.7],
  [0.2, 1.0, 0.7],
  [-0.3, 0.65, 0.45],
  [0.3, 0.65, 0.45],
  [-0.23, 0.7, 0.15],
  [0.23, 0.7, 0.15],
  [0, 0.9, 0.0],
  [0, 0.5, -0.5],
  [-0.3, 0.3, -0.95],
  [0.3, 0.3, -0.95],
  [-0.45, 0.1, -1.3],
  [0.45, 0.1, -1.3],
]

// thighs are handled separately — they render from fanned-out hip points
const LIMB_BONES: [number, number][] = [
  [HAND_L, ELBOW_L],
  [HAND_R, ELBOW_R],
  [ELBOW_L, SHOULDER_L],
  [ELBOW_R, SHOULDER_R],
  [KNEE_L, FOOT_L],
  [KNEE_R, FOOT_R],
]

const HIP_HALF_WIDTH = 0.13 * SCALE

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
  /** Strongest deck hit this step (force in m/s into the deck), or null. */
  deckImpact: { force: number; head: boolean; point: THREE.Vector3 } | null = null
  private readonly impactPoint = new THREE.Vector3()
  private readonly limbMeshes: { mesh: THREE.Mesh; a: number; b: number }[] = []
  private readonly torsoMesh: THREE.Mesh
  private readonly headMesh: THREE.Mesh
  private readonly thighMeshL: THREE.Mesh
  private readonly thighMeshR: THREE.Mesh
  private readonly bodyRight = new THREE.Vector3()
  private readonly hip = new THREE.Vector3()
  private readonly mountL = new THREE.Vector3()
  private readonly mountR = new THREE.Vector3()
  private readonly orientation = new THREE.Quaternion()
  private readonly invOrientation = new THREE.Quaternion()
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ')
  private readonly tmp = new THREE.Vector3()
  private readonly shoulderMid = new THREE.Vector3() // placeBone reuses tmp — keep these distinct
  private splashCooldown = 0

  constructor() {

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      this.particles.push({ pos: new THREE.Vector3(), prev: new THREE.Vector3() })
    }

    const wetsuit = new THREE.MeshStandardMaterial({ color: 0xffd54f })
    for (const [a, b] of LIMB_BONES) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.14 * SCALE, 1, 0.14 * SCALE), wetsuit)
      this.limbMeshes.push({ mesh, a, b })
      this.group.add(mesh)
    }

    this.torsoMesh = new THREE.Mesh(new THREE.BoxGeometry(0.34 * SCALE, 1, 0.18 * SCALE), wetsuit)
    this.group.add(this.torsoMesh)

    this.thighMeshL = new THREE.Mesh(new THREE.BoxGeometry(0.14 * SCALE, 1, 0.14 * SCALE), wetsuit)
    this.thighMeshR = new THREE.Mesh(new THREE.BoxGeometry(0.14 * SCALE, 1, 0.14 * SCALE), wetsuit)
    this.group.add(this.thighMeshL, this.thighMeshR)

    this.headMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.26 * SCALE, 0.26 * SCALE, 0.26 * SCALE),
      new THREE.MeshStandardMaterial({ color: 0xfafafa }),
    )
    this.group.add(this.headMesh)
  }

  get headPos(): THREE.Vector3 {
    return this.particles[HEAD].pos
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
    this.deckImpact = null
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

    // deck collision: rest on the hull top instead of falling through it
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      if (i === HAND_L || i === HAND_R) {
        continue
      }
      const p = this.particles[i]
      this.tmp.copy(p.pos).sub(vessel.position).applyQuaternion(this.invOrientation)
      const hullTop = deckHeightAt(this.tmp.x, this.tmp.z)
      if (this.tmp.y < hullTop && this.tmp.y > hullTop - DECK_SNAP_RANGE) {
        // closing speed of the particle onto the (possibly moving) deck
        const closing = (p.prev.y - p.pos.y) / dt + vessel.vy
        if (closing > 0 && (this.deckImpact === null || closing > this.deckImpact.force)) {
          this.impactPoint.copy(p.pos)
          this.deckImpact = { force: closing, head: i === HEAD, point: this.impactPoint }
        }
        this.tmp.y = hullTop
        p.pos.copy(this.tmp.applyQuaternion(this.orientation).add(vessel.position))
        // Inelastic vertical contact: snapping pos without touching prev
        // would inject snap-distance/dt of upward velocity — a particle
        // dragged under a taller heightfield cell would launch the doll.
        p.prev.y = p.pos.y
        const friction = Math.min(DECK_FRICTION * dt, 1)
        p.prev.x += (p.pos.x - p.prev.x) * friction
        p.prev.z += (p.pos.z - p.prev.z) * friction
      }
    }

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

    const t = this.tuning
    this.euler.set(-vessel.pitch, vessel.yaw, -vessel.roll)
    this.orientation.setFromEuler(this.euler)
    this.invOrientation.copy(this.orientation).invert()
    this.mountL.set(-t.mountX, t.mountY + VISUAL_FLOAT_OFFSET, t.mountZ)
      .applyQuaternion(this.orientation).add(vessel.position)
    this.mountR.set(t.mountX, t.mountY + VISUAL_FLOAT_OFFSET, t.mountZ)
      .applyQuaternion(this.orientation).add(vessel.position)
  }

  private syncMeshes() {

    for (const { mesh, a, b } of this.limbMeshes) {
      this.placeBone(mesh, this.particles[a].pos, this.particles[b].pos)
    }

    this.shoulderMid.copy(this.particles[SHOULDER_L].pos).add(this.particles[SHOULDER_R].pos).multiplyScalar(0.5)
    this.placeBone(this.torsoMesh, this.shoulderMid, this.particles[PELVIS].pos)

    // thighs render from hips fanned out along the body's right axis, so the
    // legs read as two even though physics shares one pelvis particle
    this.bodyRight.copy(this.particles[SHOULDER_R].pos).sub(this.particles[SHOULDER_L].pos).normalize()
    this.hip.copy(this.particles[PELVIS].pos).addScaledVector(this.bodyRight, -HIP_HALF_WIDTH)
    this.placeBone(this.thighMeshL, this.hip, this.particles[KNEE_L].pos)
    this.hip.copy(this.particles[PELVIS].pos).addScaledVector(this.bodyRight, HIP_HALF_WIDTH)
    this.placeBone(this.thighMeshR, this.hip, this.particles[KNEE_R].pos)

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
