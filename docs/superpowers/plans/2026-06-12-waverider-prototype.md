# Waverider Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A browser-based 3D feel-prototype where a placeholder vessel rides and jumps procedural Gerstner waves, with every feel parameter live-tunable.

**Architecture:** One wave displacement function is the single source of truth, implemented twice in line-for-line equivalent form: a GLSL chunk (GPU, displaces the ocean mesh) and a TypeScript function (CPU, drives buoyancy). A custom ~100-line arcade rigid body samples the surface at 4 hull points; differential heights produce pitch/roll (this replaces explicit surface normals — same information, simpler math). A chase camera with asymmetric lag sells speed and airtime.

**Tech Stack:** Three.js, TypeScript, Vite (dev server + build), Vitest (unit tests), lil-gui (tuning panel). No physics engine, no UI framework.

**Spec:** `docs/superpowers/specs/2026-06-12-waverider-prototype-design.md`

**Conventions for this repo:** commit messages are one-liners in the form `## - <message>` (no issue tracker yet). Run all commands from the repo root.

---

## File map

| File | Responsibility |
|---|---|
| `index.html` | Entry page, canvas styling |
| `src/main.ts` | Scene setup, fixed-timestep game loop, wiring |
| `src/waves.ts` | Wave params, CPU Gerstner displacement + surface sampler, GLSL chunk. **No three.js imports** (keeps it pure for tests) |
| `src/ocean.ts` | Ocean plane mesh, shader material, uniform packing, recentering |
| `src/vessel.ts` | Vessel physics (buoyancy/flight/landing), keyboard input, placeholder mesh |
| `src/camera.ts` | Chase camera with lag + FOV response |
| `src/tuning.ts` | lil-gui panel bound to all tunables |
| `tests/waves.test.ts` | Wave math unit tests |
| `tests/vessel.test.ts` | Physics unit tests (injected flat-water samplers) |

---

### Task 1: Project scaffold + hello scene

**Files:**
- Create: `package.json`, `tsconfig.json`, `index.html`, `.gitignore`, `src/main.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "waverider",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "test": "vitest run",
    "preview": "vite preview"
  },
  "dependencies": {
    "three": "^0.177.0",
    "lil-gui": "^0.20.0"
  },
  "devDependencies": {
    "@types/three": "^0.177.0",
    "typescript": "^5.8.0",
    "vite": "^6.3.0",
    "vitest": "^3.1.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM"],
    "types": ["vite/client"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: Create `index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Waverider</title>
  <style>
    html, body { margin: 0; height: 100%; overflow: hidden; background: #a6c7d9; }
    canvas { display: block; }
  </style>
</head>
<body>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
dist/
```

- [ ] **Step 5: Create `src/main.ts` (temporary hello scene — replaced in Tasks 3 and 5)**

```ts
import * as THREE from 'three'

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0xa6c7d9)

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000)
camera.position.set(0, 2, 6)
camera.lookAt(0, 0, 0)

const box = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: 0xff7043 }),
)
scene.add(box)

const sun = new THREE.DirectionalLight(0xffffff, 2)
sun.position.set(3, 5, 2)
scene.add(sun)

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

renderer.setAnimationLoop((time) => {
  box.rotation.y = time / 1000
  renderer.render(scene, camera)
})
```

- [ ] **Step 6: Install and verify**

Run: `npm install`
Expected: completes without errors, creates `node_modules/` and `package-lock.json`.

Run: `npm run build`
Expected: `tsc` passes, vite build emits `dist/` with no errors.

Run: `npm run dev` and open the printed URL (default http://localhost:5173).
Expected: pale blue page with a slowly rotating orange cube. Stop the dev server after checking.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json index.html .gitignore src/main.ts
git commit -m "## - Scaffold Vite + TypeScript + Three.js project with hello scene"
```

---

### Task 2: Wave math (`waves.ts`) — TDD

The single source of truth for the ocean. The CPU function here and the GLSL chunk must stay line-for-line equivalent — each carries a comment pointing at the other.

**Files:**
- Create: `src/waves.ts`
- Test: `tests/waves.test.ts`

- [ ] **Step 1: Write the failing tests — `tests/waves.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { defaultWaves, gerstnerDisplace, surfaceHeight } from '../src/waves'

describe('gerstnerDisplace', () => {
  it('is deterministic for identical inputs', () => {
    const a = gerstnerDisplace(defaultWaves, 12.3, -7.8, 4.2, { x: 0, y: 0, z: 0 })
    const b = gerstnerDisplace(defaultWaves, 12.3, -7.8, 4.2, { x: 0, y: 0, z: 0 })
    expect(a).toEqual(b)
  })

  it('stays within the summed amplitude bound', () => {
    const maxAmplitude = defaultWaves.reduce((sum, w) => sum + w.amplitude, 0)
    for (let i = 0; i < 200; i++) {
      const out = gerstnerDisplace(defaultWaves, i * 3.7, i * -2.3, i * 0.31, { x: 0, y: 0, z: 0 })
      expect(Math.abs(out.y)).toBeLessThanOrEqual(maxAmplitude + 1e-9)
    }
  })
})

describe('surfaceHeight', () => {
  it('matches the displaced grid point (CPU/GPU agreement)', () => {
    // A grid point (x0, z0) is rendered at (x0 + d.x, d.y, z0 + d.z).
    // Sampling the surface at that displaced XZ must return ~d.y, otherwise
    // physics and visuals disagree.
    const t = 5.0
    for (const [x0, z0] of [[3.7, -2.1], [-15.2, 8.9], [40.1, 33.3]]) {
      const d = gerstnerDisplace(defaultWaves, x0, z0, t, { x: 0, y: 0, z: 0 })
      const h = surfaceHeight(defaultWaves, x0 + d.x, z0 + d.z, t)
      expect(h).toBeCloseTo(d.y, 1)
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test`
Expected: FAIL — cannot resolve `../src/waves`.

- [ ] **Step 3: Implement `src/waves.ts`**

```ts
export interface WaveParams {
  direction: number // radians, direction of travel
  amplitude: number // metres
  wavelength: number // metres
  steepness: number // 0..1 share of the self-intersection limit
  speed: number // phase speed, m/s
}

export interface Vec3 {
  x: number
  y: number
  z: number
}

export const NUM_WAVES = 6

// Two big jumpable swells + four chop layers for surface texture.
export const defaultWaves: WaveParams[] = [
  { direction: 0.0, amplitude: 1.4, wavelength: 70, steepness: 0.8, speed: 9.0 },
  { direction: 0.6, amplitude: 0.9, wavelength: 47, steepness: 0.7, speed: 7.0 },
  { direction: -0.9, amplitude: 0.25, wavelength: 16, steepness: 0.5, speed: 4.0 },
  { direction: 1.8, amplitude: 0.18, wavelength: 11, steepness: 0.5, speed: 3.4 },
  { direction: 2.6, amplitude: 0.12, wavelength: 7, steepness: 0.4, speed: 2.6 },
  { direction: -2.2, amplitude: 0.08, wavelength: 4.5, steepness: 0.3, speed: 2.1 },
]

/**
 * Sum of Gerstner displacements for the undisplaced grid point (x0, z0) at
 * time t. Gerstner waves move points horizontally toward crests as well as
 * vertically, which is what gives waves their sharp tops.
 *
 * MUST stay line-for-line equivalent to gerstnerDisplace() in gerstnerGLSL
 * below — physics and visuals share this math.
 */
export function gerstnerDisplace(waves: WaveParams[], x0: number, z0: number, t: number, out: Vec3): Vec3 {
  out.x = 0
  out.y = 0
  out.z = 0

  for (const w of waves) {
    const k = (2 * Math.PI) / w.wavelength
    const dx = Math.cos(w.direction)
    const dz = Math.sin(w.direction)
    const q = w.steepness / (k * Math.max(w.amplitude, 0.001) * waves.length)
    const phase = k * (dx * x0 + dz * z0) - k * w.speed * t
    const c = Math.cos(phase)

    out.x += q * w.amplitude * dx * c
    out.z += q * w.amplitude * dz * c
    out.y += w.amplitude * Math.sin(phase)
  }

  return out
}

const tmp: Vec3 = { x: 0, y: 0, z: 0 }

/**
 * Height of the rendered surface above world (x, z). Because Gerstner waves
 * displace horizontally, this inverts the horizontal displacement by fixed-
 * point iteration before reading the height — sharing height alone would let
 * the vessel drift off the visual surface.
 */
export function surfaceHeight(waves: WaveParams[], x: number, z: number, t: number): number {
  let gx = x
  let gz = z

  for (let i = 0; i < 3; i++) {
    gerstnerDisplace(waves, gx, gz, t, tmp)
    gx = x - tmp.x
    gz = z - tmp.z
  }

  gerstnerDisplace(waves, gx, gz, t, tmp)

  return tmp.y
}

/**
 * GLSL twin of gerstnerDisplace(). Prepended to the ocean vertex shader.
 * MUST stay line-for-line equivalent to the TypeScript function above.
 */
export const gerstnerGLSL = /* glsl */ `
const int NUM_WAVES = ${NUM_WAVES};
uniform vec4 uWaveA[NUM_WAVES]; // dirX, dirZ, amplitude, wavelength
uniform vec2 uWaveB[NUM_WAVES]; // steepness, speed
uniform float uTime;

vec3 gerstnerDisplace(vec2 p) {
  vec3 disp = vec3(0.0);
  for (int i = 0; i < NUM_WAVES; i++) {
    float k = 6.28318530718 / uWaveA[i].w;
    vec2 d = uWaveA[i].xy;
    float a = uWaveA[i].z;
    float q = uWaveB[i].x / (k * max(a, 0.001) * float(NUM_WAVES));
    float phase = k * dot(d, p) - k * uWaveB[i].y * uTime;
    float c = cos(phase);
    disp.x += q * a * d.x * c;
    disp.z += q * a * d.y * c;
    disp.y += a * sin(phase);
  }
  return disp;
}
`
```

Note: `q` divides steepness by `k * amplitude * numWaves` (the GPU Gems 1 ch. 1 formulation) so the summed surface cannot self-intersect even when the tuning panel pushes all steepness sliders to 1. The `max(amplitude, 0.001)` guards the division when a slider hits 0.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test`
Expected: PASS — 3 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add src/waves.ts tests/waves.test.ts
git commit -m "## - Add Gerstner wave displacement math with CPU surface sampler and GLSL twin"
```

---

### Task 3: Ocean mesh + shader (`ocean.ts`)

**Files:**
- Create: `src/ocean.ts`
- Modify: `src/main.ts` (replace hello scene with an ocean viewer — replaced again in Task 5)

- [ ] **Step 1: Implement `src/ocean.ts`**

```ts
import * as THREE from 'three'
import { NUM_WAVES, WaveParams, gerstnerGLSL } from './waves'

const OCEAN_SIZE = 400
const SEGMENTS = 512

const vertexShader = gerstnerGLSL + /* glsl */ `
varying vec3 vWorldPos;
varying float vHeight;

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vec3 disp = gerstnerDisplace(worldPos.xz);
  worldPos.xyz += disp;
  vWorldPos = worldPos.xyz;
  vHeight = disp.y;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`

const fragmentShader = /* glsl */ `
varying vec3 vWorldPos;
varying float vHeight;

void main() {
  vec3 deep = vec3(0.04, 0.16, 0.27);
  vec3 shallow = vec3(0.12, 0.45, 0.52);
  vec3 sky = vec3(0.65, 0.78, 0.85);

  float h = clamp(vHeight * 0.25 + 0.5, 0.0, 1.0);
  vec3 col = mix(deep, shallow, h);

  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float fresnel = pow(1.0 - max(viewDir.y, 0.0), 3.0);
  col = mix(col, sky, fresnel * 0.6);

  float dist = length(vWorldPos.xz - cameraPosition.xz);
  col = mix(col, sky, smoothstep(120.0, 190.0, dist));

  gl_FragColor = vec4(col, 1.0);
}
`

export class Ocean {
  readonly mesh: THREE.Mesh
  private readonly material: THREE.ShaderMaterial

  constructor(waves: WaveParams[]) {
    const geometry = new THREE.PlaneGeometry(OCEAN_SIZE, OCEAN_SIZE, SEGMENTS, SEGMENTS)
    geometry.rotateX(-Math.PI / 2)

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uWaveA: { value: Array.from({ length: NUM_WAVES }, () => new THREE.Vector4()) },
        uWaveB: { value: Array.from({ length: NUM_WAVES }, () => new THREE.Vector2()) },
      },
    })

    this.mesh = new THREE.Mesh(geometry, this.material)
    this.mesh.frustumCulled = false
    this.updateWaves(waves)
  }

  /** Re-pack wave params into uniforms. Call whenever the tuning panel changes them. */
  updateWaves(waves: WaveParams[]) {
    for (let i = 0; i < NUM_WAVES; i++) {
      const w = waves[i]
      this.material.uniforms.uWaveA.value[i].set(Math.cos(w.direction), Math.sin(w.direction), w.amplitude, w.wavelength)
      this.material.uniforms.uWaveB.value[i].set(w.steepness, w.speed)
    }
  }

  /**
   * Recenter the plane on the vessel so the ocean is endless. Snapped to the
   * vertex grid spacing so vertices land on the same world positions every
   * frame (no swimming).
   */
  update(time: number, center: THREE.Vector3) {
    this.material.uniforms.uTime.value = time
    const step = OCEAN_SIZE / SEGMENTS
    this.mesh.position.x = Math.round(center.x / step) * step
    this.mesh.position.z = Math.round(center.z / step) * step
  }
}
```

Notes:
- The vertex shader displaces in *world* space (`modelMatrix * position` first), so recentering the mesh never changes the wave field — waves are a deterministic function of world position and time.
- `frustumCulled = false` because vertex displacement breaks the precomputed bounding volume.
- `cameraPosition` is a built-in uniform Three.js injects into ShaderMaterial fragment shaders — no manual declaration needed.

- [ ] **Step 2: Replace `src/main.ts` with a static ocean viewer**

```ts
import * as THREE from 'three'
import { defaultWaves } from './waves'
import { Ocean } from './ocean'

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0xa6c7d9)

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000)
camera.position.set(0, 10, -25)
camera.lookAt(0, 0, 20)

const ocean = new Ocean(defaultWaves)
scene.add(ocean.mesh)

const center = new THREE.Vector3()

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

renderer.setAnimationLoop((time) => {
  ocean.update(time / 1000, center)
  renderer.render(scene, camera)
})
```

- [ ] **Step 3: Verify visually**

Run: `npm run test` — Expected: still 3 passing (no regression).
Run: `npm run build` — Expected: no type errors.
Run: `npm run dev`, open the URL.
Expected: an animated ocean — two large slow swells rolling roughly away from the camera with smaller chop on top, deep teal in troughs, lighter at crests, fading to sky at the horizon. No flickering, no visible mesh edge, smooth 60 fps. Stop the server.

- [ ] **Step 4: Commit**

```bash
git add src/ocean.ts src/main.ts
git commit -m "## - Add GPU-displaced ocean mesh with stylized shading and recentering"
```

---

### Task 4: Vessel physics (`vessel.ts`) — TDD

The heart of the prototype. The vessel samples the surface at 4 hull points; the average drives buoyancy (heave) and the differences drive pitch/roll targets. All states use semi-implicit Euler at a fixed 60 Hz step.

Conventions (used consistently here, in `camera.ts`, and in mesh sync):
- Forward at `yaw = 0` is **+Z**; forward vector is `(sin yaw, 0, cos yaw)`. Steer input +1 = right (D key) and increases yaw.
- `pitch` positive = nose up. `roll` positive = starboard (right) side down.
- Equilibrium draft on calm water is `gravity / buoyancySpring` metres below the surface (0.3 m with defaults).

**Files:**
- Create: `src/vessel.ts`
- Test: `tests/vessel.test.ts`

- [ ] **Step 1: Write the failing tests — `tests/vessel.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { Vessel } from '../src/vessel'

const STEP = 1 / 60
const flatWater = () => 0
const noInput = { throttle: 0, steer: 0 }

function run(vessel: Vessel, seconds: number, input = noInput, sampler: (x: number, z: number) => number = flatWater) {
  const steps = Math.round(seconds / STEP)
  for (let i = 0; i < steps; i++) {
    vessel.update(STEP, input, sampler)
  }
}

describe('Vessel', () => {
  it('settles to its draft depth on flat water', () => {
    const vessel = new Vessel()
    vessel.position.y = 1
    run(vessel, 10)
    const draft = vessel.tuning.gravity / vessel.tuning.buoyancySpring
    expect(vessel.position.y).toBeCloseTo(-draft, 1)
    expect(Math.abs(vessel.vy)).toBeLessThan(0.05)
  })

  it('goes airborne when the surface drops away', () => {
    const vessel = new Vessel()
    vessel.update(STEP, noInput, () => -100)
    expect(vessel.airborne).toBe(true)
    const vyBefore = vessel.vy
    vessel.update(STEP, noInput, () => -100)
    expect(vessel.vy).toBeLessThan(vyBefore)
  })

  it('accelerates forward under throttle and tracks its heading', () => {
    const vessel = new Vessel()
    vessel.position.y = -0.3
    run(vessel, 5, { throttle: 1, steer: 0 })
    expect(vessel.speed).toBeGreaterThan(5)
    expect(vessel.position.z).toBeGreaterThan(20)
    expect(Math.abs(vessel.position.x)).toBeLessThan(0.001)
  })

  it('turns toward steer input once moving', () => {
    const vessel = new Vessel()
    vessel.position.y = -0.3
    run(vessel, 3, { throttle: 1, steer: 1 })
    expect(vessel.yaw).toBeGreaterThan(0.1)
    expect(vessel.position.x).toBeGreaterThan(1)
  })

  it('lands without exploding after a long drop', () => {
    const vessel = new Vessel()
    vessel.position.y = 6
    run(vessel, 20)
    const draft = vessel.tuning.gravity / vessel.tuning.buoyancySpring
    expect(vessel.position.y).toBeCloseTo(-draft, 1)
    expect(Math.abs(vessel.vy)).toBeLessThan(0.05)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test`
Expected: FAIL — cannot resolve `../src/vessel`. The waves tests still pass.

- [ ] **Step 3: Implement `src/vessel.ts`**

```ts
import * as THREE from 'three'

export interface VesselInput {
  throttle: number // -1..1, W = +1
  steer: number // -1..1, D = +1 (right)
}

export type SurfaceSampler = (x: number, z: number) => number

export interface VesselTuning {
  gravity: number // m/s² in/near water
  airGravity: number // m/s² airborne — lower than gravity reads floatier
  buoyancySpring: number
  buoyancyDamping: number
  thrust: number
  reverseThrust: number
  waterDrag: number
  turnRate: number // rad/s at full grip
  bankFactor: number // extra roll into turns
  orientSpring: number // how eagerly the hull follows the water surface
  orientDamping: number
  autoLevelSpring: number // air: pulls pitch/roll toward level
  autoLevelDamping: number
  airPitchAuthority: number // radians of pitch target at full stick
  landingAbsorb: number // 0..1 share of downward speed removed on touchdown
  speedKeptOnLanding: number // 0..1 share of forward speed kept on touchdown
}

export const defaultTuning: VesselTuning = {
  gravity: 18,
  airGravity: 11,
  buoyancySpring: 60,
  buoyancyDamping: 8,
  thrust: 14,
  reverseThrust: 6,
  waterDrag: 0.5,
  turnRate: 1.6,
  bankFactor: 0.35,
  orientSpring: 18,
  orientDamping: 7,
  autoLevelSpring: 8,
  autoLevelDamping: 4,
  airPitchAuthority: 0.35,
  landingAbsorb: 0.6,
  speedKeptOnLanding: 0.85,
}

const HULL_HALF_LENGTH = 2
const HULL_HALF_WIDTH = 0.9
const AIRBORNE_THRESHOLD = -0.05 // metres of clearance before we call it flight

export class Vessel {
  readonly position = new THREE.Vector3(0, 0, 0)
  vy = 0 // vertical velocity
  speed = 0 // forward speed along heading
  yaw = 0
  pitch = 0 // nose-up positive
  roll = 0 // starboard-down positive
  pitchVel = 0
  rollVel = 0
  airborne = false

  constructor(public tuning: VesselTuning = { ...defaultTuning }) {}

  update(dt: number, input: VesselInput, sampleHeight: SurfaceSampler) {

    const t = this.tuning
    const sinYaw = Math.sin(this.yaw)
    const cosYaw = Math.cos(this.yaw)

    const hBow = sampleHeight(this.position.x + sinYaw * HULL_HALF_LENGTH, this.position.z + cosYaw * HULL_HALF_LENGTH)
    const hStern = sampleHeight(this.position.x - sinYaw * HULL_HALF_LENGTH, this.position.z - cosYaw * HULL_HALF_LENGTH)
    const hPort = sampleHeight(this.position.x - cosYaw * HULL_HALF_WIDTH, this.position.z + sinYaw * HULL_HALF_WIDTH)
    const hStarboard = sampleHeight(this.position.x + cosYaw * HULL_HALF_WIDTH, this.position.z - sinYaw * HULL_HALF_WIDTH)

    const waterline = (hBow + hStern + hPort + hStarboard) / 4
    const submersion = waterline - this.position.y
    const wasAirborne = this.airborne
    this.airborne = submersion < AIRBORNE_THRESHOLD

    if (this.airborne) {
      this.vy -= t.airGravity * dt

      const airPitchTarget = input.throttle * t.airPitchAuthority
      this.pitchVel += (t.autoLevelSpring * (airPitchTarget - this.pitch) - t.autoLevelDamping * this.pitchVel) * dt
      this.rollVel += (t.autoLevelSpring * -this.roll - t.autoLevelDamping * this.rollVel) * dt
    } else {
      if (wasAirborne) {
        if (this.vy < 0) {
          this.vy *= 1 - t.landingAbsorb
        }
        this.speed *= t.speedKeptOnLanding
      }

      const springAccel = Math.max(submersion, 0) * t.buoyancySpring
      this.vy += (springAccel - t.buoyancyDamping * this.vy - t.gravity) * dt

      const grip = THREE.MathUtils.clamp(this.speed / 8, 0, 1)
      const throttleAccel = input.throttle >= 0 ? input.throttle * t.thrust : input.throttle * t.reverseThrust
      this.speed += (throttleAccel - t.waterDrag * this.speed) * dt
      this.yaw += input.steer * t.turnRate * grip * dt

      const targetPitch = Math.atan2(hBow - hStern, HULL_HALF_LENGTH * 2)
      const targetRoll = Math.atan2(hPort - hStarboard, HULL_HALF_WIDTH * 2) + input.steer * t.bankFactor * grip
      this.pitchVel += (t.orientSpring * (targetPitch - this.pitch) - t.orientDamping * this.pitchVel) * dt
      this.rollVel += (t.orientSpring * (targetRoll - this.roll) - t.orientDamping * this.rollVel) * dt
    }

    this.pitch += this.pitchVel * dt
    this.roll += this.rollVel * dt
    this.position.x += sinYaw * this.speed * dt
    this.position.z += cosYaw * this.speed * dt
    this.position.y += this.vy * dt
  }
}

export function createVesselMesh(): THREE.Group {

  const group = new THREE.Group()

  const hull = new THREE.Mesh(
    new THREE.BoxGeometry(HULL_HALF_WIDTH * 2, 0.6, HULL_HALF_LENGTH * 2),
    new THREE.MeshStandardMaterial({ color: 0xff7043 }),
  )
  hull.position.y = 0.1
  group.add(hull)

  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.0, 0.5, 1.2),
    new THREE.MeshStandardMaterial({ color: 0xfff3e0 }),
  )
  cabin.position.set(0, 0.55, -0.4)
  group.add(cabin)

  return group
}

export function syncVesselMesh(vessel: Vessel, mesh: THREE.Object3D) {

  mesh.position.copy(vessel.position)
  mesh.rotation.order = 'YXZ'
  mesh.rotation.y = vessel.yaw
  // Three's +X rotation tips local +Z (our bow) downward, hence the sign flips.
  mesh.rotation.x = -vessel.pitch
  mesh.rotation.z = -vessel.roll
}

export class KeyboardInput {
  readonly state: VesselInput = { throttle: 0, steer: 0 }
  private readonly pressed = new Set<string>()

  attach() {
    window.addEventListener('keydown', (e) => {
      this.pressed.add(e.code)
      this.refresh()
    })
    window.addEventListener('keyup', (e) => {
      this.pressed.delete(e.code)
      this.refresh()
    })
  }

  private refresh() {

    const p = this.pressed

    this.state.throttle =
      (p.has('KeyW') || p.has('ArrowUp') ? 1 : 0) - (p.has('KeyS') || p.has('ArrowDown') ? 1 : 0)
    this.state.steer =
      (p.has('KeyD') || p.has('ArrowRight') ? 1 : 0) - (p.has('KeyA') || p.has('ArrowLeft') ? 1 : 0)
  }
}
```

Physics notes for the implementer:
- `grip` scales steering with speed so the vessel can't spin in place — arcade-standard.
- Buoyancy spring only pushes up (`Math.max(submersion, 0)`) — water never sucks the hull down; gravity handles descent.
- The `AIRBORNE_THRESHOLD` of −0.05 m means tiny chop doesn't flicker the airborne state; only a real gap under the hull triggers flight.
- In the air, throttle doubles as pitch control (W = nose up) and `autoLevelSpring` guarantees a survivable attitude — deliberate arcade cheat per the spec.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test`
Expected: PASS — 8 tests total (3 waves + 5 vessel), 0 failures.

- [ ] **Step 5: Commit**

```bash
git add src/vessel.ts tests/vessel.test.ts
git commit -m "## - Add arcade vessel physics with 4-point buoyancy, flight and landing states"
```

---

### Task 5: Chase camera + full game loop

**Files:**
- Create: `src/camera.ts`
- Modify: `src/main.ts` (replace ocean viewer with the full game)

- [ ] **Step 1: Implement `src/camera.ts`**

```ts
import * as THREE from 'three'
import type { Vessel } from './vessel'

export interface CameraTuning {
  distance: number
  height: number
  posLag: number // higher = snappier position follow
  lookLag: number // higher = snappier aim; keep above posLag so speed reads as lag
  fovBase: number
  fovSpeedFactor: number
  airPullback: number // extra distance while airborne
}

export const defaultCameraTuning: CameraTuning = {
  distance: 9,
  height: 4,
  posLag: 3.5,
  lookLag: 6,
  fovBase: 60,
  fovSpeedFactor: 0.5,
  airPullback: 2,
}

export class ChaseCamera {
  private readonly desired = new THREE.Vector3()
  private readonly lookPoint = new THREE.Vector3()
  private readonly lookTarget = new THREE.Vector3()
  private initialized = false

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    public tuning: CameraTuning = { ...defaultCameraTuning },
  ) {}

  update(dt: number, vessel: Vessel) {

    const t = this.tuning
    const sinYaw = Math.sin(vessel.yaw)
    const cosYaw = Math.cos(vessel.yaw)

    const back = t.distance + (vessel.airborne ? t.airPullback : 0)
    this.desired.set(
      vessel.position.x - sinYaw * back,
      vessel.position.y + t.height,
      vessel.position.z - cosYaw * back,
    )
    this.lookTarget.set(
      vessel.position.x + sinYaw * 4,
      vessel.position.y,
      vessel.position.z + cosYaw * 4,
    )

    if (!this.initialized) {
      this.camera.position.copy(this.desired)
      this.lookPoint.copy(this.lookTarget)
      this.initialized = true
    }

    // Frame-rate-independent smoothing; position lags more than aim on purpose.
    const posAlpha = 1 - Math.exp(-t.posLag * dt)
    const lookAlpha = 1 - Math.exp(-t.lookLag * dt)
    this.camera.position.lerp(this.desired, posAlpha)
    this.lookPoint.lerp(this.lookTarget, lookAlpha)
    this.camera.lookAt(this.lookPoint)

    const targetFov = t.fovBase + Math.min(Math.abs(vessel.speed) * t.fovSpeedFactor, 25)
    this.camera.fov += (targetFov - this.camera.fov) * posAlpha
    this.camera.updateProjectionMatrix()
  }
}
```

- [ ] **Step 2: Replace `src/main.ts` with the full game**

```ts
import * as THREE from 'three'
import { defaultWaves, surfaceHeight } from './waves'
import { Ocean } from './ocean'
import { Vessel, KeyboardInput, createVesselMesh, syncVesselMesh } from './vessel'
import { ChaseCamera } from './camera'

const STEP = 1 / 60

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0xa6c7d9)

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000)

const sun = new THREE.DirectionalLight(0xfff2dd, 2.2)
sun.position.set(40, 60, -30)
scene.add(sun)
scene.add(new THREE.HemisphereLight(0xbcd8e6, 0x1a3a4a, 0.9))

const waves = defaultWaves.map((w) => ({ ...w }))
const ocean = new Ocean(waves)
scene.add(ocean.mesh)

const vessel = new Vessel()
const vesselMesh = createVesselMesh()
scene.add(vesselMesh)

const chase = new ChaseCamera(camera)
const input = new KeyboardInput()
input.attach()

let simTime = 0
const sampler = (x: number, z: number) => surfaceHeight(waves, x, z, simTime)

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

let last = performance.now()
let accumulator = 0

function frame(now: number) {

  const dt = Math.min((now - last) / 1000, 0.1)
  last = now
  accumulator += dt

  while (accumulator >= STEP) {
    simTime += STEP
    vessel.update(STEP, input.state, sampler)
    accumulator -= STEP
  }

  syncVesselMesh(vessel, vesselMesh)
  ocean.update(simTime, vessel.position)
  chase.update(dt, vessel)
  renderer.render(scene, camera)
  requestAnimationFrame(frame)
}

requestAnimationFrame(frame)
```

Notes:
- Physics runs at a fixed 60 Hz inside the accumulator loop (deterministic feel regardless of display refresh); camera smoothing uses real frame `dt`.
- `waves` is a mutable copy of the defaults — Task 6 binds the tuning panel to this array.
- The `dt` clamp (0.1 s) prevents a physics explosion after a backgrounded tab.

- [ ] **Step 3: Verify by playing**

Run: `npm run test` — Expected: 8 passing.
Run: `npm run build` — Expected: no type errors.
Run: `npm run dev`, open the URL, and check each of these:

1. The vessel bobs on the swell, pitching and rolling with the surface — never sliding through wave faces or hovering above them (this is the CPU/GPU agreement check, the project's core invariant).
2. Hold W: vessel accelerates, camera lags back then catches up, FOV widens slightly.
3. Drive up the back of a big swell at speed: vessel launches, hangs floatier than real gravity, auto-levels, lands with a cushioned (not crashy) re-entry, keeps most forward speed.
4. A/D steering banks the hull into turns; no turning when stationary.
5. Drive in one direction for ~60 s: ocean never ends, no visible recentering pop.

Stop the server.

- [ ] **Step 4: Commit**

```bash
git add src/camera.ts src/main.ts
git commit -m "## - Add chase camera and full game loop with fixed-timestep physics"
```

---

### Task 6: Tuning panel (`tuning.ts`)

The most important tool in the project — feel is found by twiddling these live, not by editing code.

**Files:**
- Create: `src/tuning.ts`
- Modify: `src/main.ts` (two small additions)

- [ ] **Step 1: Implement `src/tuning.ts`**

```ts
import GUI from 'lil-gui'
import type { WaveParams } from './waves'
import type { VesselTuning } from './vessel'
import type { CameraTuning } from './camera'

export interface TuningTargets {
  waves: WaveParams[]
  onWavesChanged: () => void
  vessel: VesselTuning
  camera: CameraTuning
}

/** Builds the live tuning panel. Press H to show/hide. */
export function createTuningPanel(targets: TuningTargets): GUI {

  const gui = new GUI({ title: 'Waverider tuning (H to hide)' })

  const wavesFolder = gui.addFolder('Waves')
  targets.waves.forEach((w, i) => {
    const f = wavesFolder.addFolder(i < 2 ? `Swell ${i + 1}` : `Chop ${i - 1}`)
    f.add(w, 'amplitude', 0, 3, 0.01).onChange(targets.onWavesChanged)
    f.add(w, 'wavelength', 2, 120, 0.5).onChange(targets.onWavesChanged)
    f.add(w, 'steepness', 0, 1, 0.01).onChange(targets.onWavesChanged)
    f.add(w, 'speed', 0, 15, 0.1).onChange(targets.onWavesChanged)
    f.add(w, 'direction', -Math.PI, Math.PI, 0.01).onChange(targets.onWavesChanged)
    if (i > 1) {
      f.close()
    }
  })

  const v = targets.vessel
  const physics = gui.addFolder('Physics')
  physics.add(v, 'gravity', 4, 40, 0.5)
  physics.add(v, 'buoyancySpring', 10, 150, 1)
  physics.add(v, 'buoyancyDamping', 0, 20, 0.1)
  physics.add(v, 'thrust', 2, 40, 0.5)
  physics.add(v, 'reverseThrust', 0, 20, 0.5)
  physics.add(v, 'waterDrag', 0.05, 2, 0.01)
  physics.add(v, 'turnRate', 0.3, 4, 0.05)
  physics.add(v, 'bankFactor', 0, 1, 0.01)
  physics.add(v, 'orientSpring', 2, 40, 0.5)
  physics.add(v, 'orientDamping', 0, 20, 0.1)

  const air = gui.addFolder('Air')
  air.add(v, 'airGravity', 2, 30, 0.5)
  air.add(v, 'airPitchAuthority', 0, 1, 0.01)
  air.add(v, 'autoLevelSpring', 0, 30, 0.5)
  air.add(v, 'autoLevelDamping', 0, 15, 0.1)
  air.add(v, 'landingAbsorb', 0, 1, 0.01)
  air.add(v, 'speedKeptOnLanding', 0.5, 1, 0.01)

  const c = targets.camera
  const cam = gui.addFolder('Camera')
  cam.add(c, 'distance', 4, 20, 0.5)
  cam.add(c, 'height', 1, 10, 0.25)
  cam.add(c, 'posLag', 0.5, 10, 0.1)
  cam.add(c, 'lookLag', 0.5, 12, 0.1)
  cam.add(c, 'fovBase', 40, 90, 1)
  cam.add(c, 'fovSpeedFactor', 0, 2, 0.05)
  cam.add(c, 'airPullback', 0, 6, 0.25)

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyH') {
      gui.show(gui._hidden)
    }
  })

  return gui
}
```

- [ ] **Step 2: Wire it into `src/main.ts`**

Add to the imports:

```ts
import { createTuningPanel } from './tuning'
```

Add after `input.attach()` (before the `simTime` declaration):

```ts
createTuningPanel({
  waves,
  onWavesChanged: () => ocean.updateWaves(waves),
  vessel: vessel.tuning,
  camera: chase.tuning,
})
```

- [ ] **Step 3: Verify by tuning**

Run: `npm run build` — Expected: no type errors.
Run: `npm run dev`, open the URL, and check:

1. Panel appears top-right with Waves / Physics / Air / Camera folders; H hides and shows it.
2. Drag Swell 1 amplitude to 3: waves grow visibly AND the vessel rides the bigger waves correctly (CPU and GPU read the same params live).
3. Drag Swell 1 steepness to 1 with others high: crests sharpen, surface never folds through itself.
4. Lower airGravity to 4 and jump: noticeably floatier hangtime.
5. Set landingAbsorb to 0 and land a jump: harsher re-entry bounce (then put it back).

Stop the server.

- [ ] **Step 4: Commit**

```bash
git add src/tuning.ts src/main.ts
git commit -m "## - Add live tuning panel for waves, physics, air and camera parameters"
```

---

### Task 7: README + final verification

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create `README.md`**

```markdown
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

## Playtesting — what to look for

Chase the two big swells (they travel roughly north/north-east), drive up
the back of one at full throttle, and jump it. Then open the tuning panel
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
```

- [ ] **Step 2: Full verification pass**

Run: `npm run test`
Expected: 8 tests passing.

Run: `npm run build`
Expected: clean type-check and bundle.

Run: `npm run dev`, open the URL, play for two minutes: bob, drive, jump, land, tune. Confirm the five checks from Task 5 Step 3 and the five from Task 6 Step 3 still hold. Stop the server.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "## - Add README with quick start, controls and playtesting guide"
```

---

## Plan self-review record

- **Spec coverage:** §4 stack → Task 1; §6 ocean (6 Gerstner waves, shared function, horizontal-displacement inversion, 512² recentered plane, stylized shading) → Tasks 2–3; §7 vessel physics (4-point sampling, buoyancy spring/damping, thrust/steer/banking, floaty air state, auto-level, cushioned landing, speed kept) → Task 4; §8 camera/input → Tasks 4–5; §9 tuning panel (all listed groups) → Task 6; §12 tests (determinism + CPU/GPU agreement fixture) → Tasks 2 and 4. The spec's "height + normal" sampling is implemented as 4-point differential heights — equivalent information, noted in the header.
- **Placeholders:** none — every step carries full code or exact commands.
- **Type consistency:** `surfaceHeight`/`gerstnerDisplace`/`defaultWaves` (Tasks 2→3→5), `Vessel.tuning`/`VesselTuning` (Tasks 4→6), `ChaseCamera.tuning`/`CameraTuning` (Tasks 5→6), `createTuningPanel(TuningTargets)` (Task 6 ↔ main.ts) all match.
