# Waverider Visuals Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stylized foamy water visuals — sky dome + sun, lit ocean with crest foam, stern wake ribbon, pooled splash/spray particles — all live-tunable.

**Architecture:** The sky owns the sun direction and horizon color; the ocean material shares those THREE objects by reference so GUI changes propagate with no plumbing. The GLSL wave chunk gains analytic normals + a crest-compression term (GPU-only; the CPU/GPU displacement equivalence invariant is untouched). Vessel exposes per-step `justLanded`/`justTookOff` event fields; main.ts accumulates them across fixed steps and feeds the splash system. Wake is a CPU-built triangle-strip ribbon conformed to the wave surface. Render order: ocean(0) → wake(1) → splash(2), effects depthWrite off.

**Tech Stack:** Three.js ShaderMaterial GLSL (procedural only, no textures), typed-array particle pool, Vitest for the pure-logic seams.

**Spec:** `docs/superpowers/specs/2026-06-12-waverider-visuals-design.md`
**Conventions:** commits are `## - <one-liner>`. Forward = (sin yaw, 0, cos yaw). Run from repo root.

---

## File map

| File | Change |
|---|---|
| `src/vessel.ts` | Add `justLanded`/`justTookOff` event fields |
| `src/sky.ts` | NEW — gradient dome + sun disc, owns sunDir + horizonColor |
| `src/waves.ts` | GLSL chunk: combined displacement+normal+crest function |
| `src/ocean.ts` | Lit fragment shader (lambert/specular/foam), env-by-reference |
| `src/wake.ts` | NEW — ribbon trail, exported pure `ageSamples` helper |
| `src/splash.ts` | NEW — pooled particles, 3 emitters |
| `src/tuning.ts` | Visuals folder |
| `src/main.ts` | Wiring + per-frame event accumulation |
| `tests/vessel.test.ts`, `tests/wake.test.ts`, `tests/splash.test.ts` | Unit tests for the pure seams |

---

### Task 1: Vessel event fields — TDD

**Files:** Modify `src/vessel.ts`, Test `tests/vessel.test.ts`

- [ ] **Step 1: Add failing tests to `tests/vessel.test.ts`** (inside the `describe('Vessel')` block)

```ts
  it('reports takeoff exactly on the transition step', () => {
    const vessel = new Vessel()
    vessel.update(STEP, noInput, () => -100)
    expect(vessel.justTookOff).toBe(true)
    vessel.update(STEP, noInput, () => -100)
    expect(vessel.justTookOff).toBe(false)
  })

  it('reports landing impact speed on touchdown', () => {
    const vessel = new Vessel()
    vessel.position.y = 4
    let firstImpact = 0
    let impacts = 0
    for (let i = 0; i < 600; i++) {
      vessel.update(STEP, noInput, flatWater)
      if (vessel.justLanded > 0) {
        impacts++
        if (firstImpact === 0) {
          firstImpact = vessel.justLanded
        }
      }
    }
    expect(impacts).toBeGreaterThanOrEqual(1)
    expect(firstImpact).toBeGreaterThan(3) // ~4 m fall at airGravity 11 → ≈9 m/s
  })
```

- [ ] **Step 2:** `npm run test` — both new tests FAIL (fields undefined).

- [ ] **Step 3: Implement in `src/vessel.ts`.** Add fields after `airborne = false`:

```ts
  justTookOff = false // true only on the step the hull left the water
  justLanded = 0 // downward impact speed (m/s) on the touchdown step, else 0
```

At the top of `update()` (first lines of the method body):

```ts
    this.justTookOff = false
    this.justLanded = 0
```

After the `this.airborne = ...` hysteresis line:

```ts
    if (this.airborne && !wasAirborne) {
      this.justTookOff = true
    }
```

In the water branch, inside `if (wasAirborne) {`, BEFORE the absorb line:

```ts
        this.justLanded = Math.max(0, -this.vy)
```

- [ ] **Step 4:** `npm run test` — 15 pass. **Step 5:** Commit:

```bash
git add src/vessel.ts tests/vessel.test.ts
git commit -m "## - Expose per-step landing and takeoff events on the vessel"
```

---

### Task 2: Sky dome + sun

**Files:** Create `src/sky.ts`, Modify `src/main.ts`

- [ ] **Step 1: Create `src/sky.ts`:**

```ts
import * as THREE from 'three'

const vertexShader = /* glsl */ `
varying vec3 vDir;

void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const fragmentShader = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uHorizonColor;
uniform vec3 uZenithColor;
varying vec3 vDir;

void main() {
  vec3 dir = normalize(vDir);
  float h = clamp(dir.y, 0.0, 1.0);
  vec3 col = mix(uHorizonColor, uZenithColor, pow(h, 0.6));

  float sunAmount = max(dot(dir, uSunDir), 0.0);
  vec3 sunColor = vec3(1.0, 0.9, 0.75);
  col += sunColor * pow(sunAmount, 800.0) * 1.2; // disc
  col += sunColor * pow(sunAmount, 12.0) * 0.25; // glow

  gl_FragColor = vec4(col, 1.0);
}
`

/**
 * Camera-following gradient dome with a sun disc. Owns the sun direction and
 * horizon color — the ocean material and the scene's directional light share
 * these objects by reference, so GUI changes propagate automatically.
 */
export class Sky {
  readonly mesh: THREE.Mesh
  private readonly material: THREE.ShaderMaterial

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uSunDir: { value: new THREE.Vector3() },
        uHorizonColor: { value: new THREE.Color(0xe6cfa3) },
        uZenithColor: { value: new THREE.Color(0x7fa6bf) },
      },
      side: THREE.BackSide,
      depthWrite: false,
    })

    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), this.material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = -1
  }

  get sunDir(): THREE.Vector3 {
    return this.material.uniforms.uSunDir.value
  }

  get horizonColor(): THREE.Color {
    return this.material.uniforms.uHorizonColor.value
  }

  setSun(azimuth: number, elevation: number) {
    this.sunDir.set(
      Math.sin(azimuth) * Math.cos(elevation),
      Math.sin(elevation),
      Math.cos(azimuth) * Math.cos(elevation),
    )
  }

  /** Keep the dome centred on the camera so it never has a visible edge. */
  update(camera: THREE.Camera) {
    this.mesh.position.copy(camera.position)
  }
}
```

- [ ] **Step 2: Wire into `src/main.ts`.** Add import `import { Sky } from './sky'`. After the `camera` is created and BEFORE the lights:

```ts
const sky = new Sky()
scene.add(sky.mesh)

const sunState = { azimuth: 0.6, elevation: 0.18 }
const applySun = () => {
  sky.setSun(sunState.azimuth, sunState.elevation)
  sun.position.copy(sky.sunDir).multiplyScalar(100)
}
```

Keep the existing `sun` DirectionalLight but call `applySun()` right after both lights are added. In the render loop, add `sky.update(camera)` immediately after `chase.update(dt, vessel)`.

- [ ] **Step 3:** `npm run test` (15 pass), `npm run build` (clean), then visual check via dev server: gradient sky with a warm low sun ahead-right, no visible dome edge. **Step 4:** Commit:

```bash
git add src/sky.ts src/main.ts
git commit -m "## - Add gradient sky dome with sun disc as the scene light source of truth"
```

---

### Task 3: Ocean lighting + foam

**Files:** Modify `src/waves.ts` (GLSL export only), `src/ocean.ts`, `src/main.ts` (constructor call)

- [ ] **Step 1: Replace the `gerstnerGLSL` export in `src/waves.ts`** with (keep the existing doc comment about the float32 time horizon, extend it as shown):

```ts
/**
 * GLSL twin of gerstnerDisplace(). Prepended to the ocean vertex shader.
 * The DISPLACEMENT lines MUST stay line-for-line equivalent to the
 * TypeScript function above — physics and visuals share that math. The
 * normal and crest accumulation are GPU-only visual extras; the CPU never
 * needs them, so the equivalence invariant covers displacement only.
 *
 * Known limitation: phase is computed in float32 on the GPU from absolute
 * uTime, so visual precision degrades over very long sessions (~hours) and
 * live speed-slider changes cause a phase jump proportional to elapsed
 * time. Acceptable for a feel prototype; a production version should
 * upload per-wave phases accumulated in float64 on the CPU.
 */
export const gerstnerGLSL = /* glsl */ `
const int NUM_WAVES = ${NUM_WAVES};
uniform vec4 uWaveA[NUM_WAVES]; // dirX, dirZ, amplitude, wavelength
uniform vec2 uWaveB[NUM_WAVES]; // steepness, speed
uniform float uTime;

void gerstnerSurface(vec2 p, out vec3 disp, out vec3 normal, out float crest) {
  disp = vec3(0.0);
  vec3 n = vec3(0.0, 1.0, 0.0);
  crest = 0.0;
  for (int i = 0; i < NUM_WAVES; i++) {
    float k = 6.28318530718 / uWaveA[i].w;
    vec2 d = uWaveA[i].xy;
    float a = uWaveA[i].z;
    float q = uWaveB[i].x / (k * max(a, 0.001) * float(NUM_WAVES));
    float phase = k * dot(d, p) - k * uWaveB[i].y * uTime;
    float c = cos(phase);
    float s = sin(phase);
    disp.x += q * a * d.x * c;
    disp.y += a * s;
    disp.z += q * a * d.y * c;
    float ka = k * a;
    n.x -= d.x * ka * c;
    n.z -= d.y * ka * c;
    n.y -= q * ka * s;
    crest += q * ka * s;
  }
  normal = normalize(n);
}

vec3 gerstnerDisplace(vec2 p) {
  vec3 disp;
  vec3 n;
  float crest;
  gerstnerSurface(p, disp, n, crest);
  return disp;
}
`
```

`crest` is the horizontal compression term (Σ q·k·a·sin) — it peaks exactly where Gerstner crests sharpen; range with default waves ≈ ±0.53.

- [ ] **Step 2: Update `src/ocean.ts`.** New vertex shader:

```ts
const vertexShader = gerstnerGLSL + /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vHeight;
varying float vCrest;

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vec3 disp;
  vec3 normal;
  float crest;
  gerstnerSurface(worldPos.xz, disp, normal, crest);
  worldPos.xyz += disp;
  vWorldPos = worldPos.xyz;
  vNormal = normal;
  vHeight = disp.y;
  vCrest = crest;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`
```

New fragment shader (note: fragment declares its own `uTime` — the uniforms object feeds both stages by name):

```ts
const fragmentShader = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uHorizonColor;
uniform float uFoamThreshold;
uniform float uFoamIntensity;
uniform float uTime;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vHeight;
varying float vCrest;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

void main() {
  vec3 deep = vec3(0.04, 0.16, 0.27);
  vec3 shallow = vec3(0.12, 0.45, 0.52);

  float h = clamp(vHeight * 0.15 + 0.5, 0.0, 1.0);
  vec3 col = mix(deep, shallow, h);

  vec3 n = normalize(vNormal);
  float diff = max(dot(n, uSunDir), 0.0);
  col *= 0.55 + 0.45 * diff;

  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  vec3 halfDir = normalize(uSunDir + viewDir);
  float spec = pow(max(dot(n, halfDir), 0.0), 120.0);
  col += vec3(1.0, 0.92, 0.8) * spec * 0.9;

  float fresnel = pow(1.0 - max(viewDir.y, 0.0), 3.0);
  col = mix(col, uHorizonColor, fresnel * 0.5);

  float breakup = noise(vWorldPos.xz * 0.9 + uTime * 0.25) * 0.6
                + noise(vWorldPos.xz * 2.7 - uTime * 0.15) * 0.4;
  float foam = smoothstep(uFoamThreshold, uFoamThreshold + 0.18, vCrest * (0.55 + 0.9 * breakup));
  col = mix(col, vec3(0.96, 0.97, 0.94), foam * uFoamIntensity);

  float dist = length(vWorldPos.xz - cameraPosition.xz);
  col = mix(col, uHorizonColor, smoothstep(120.0, 190.0, dist));

  gl_FragColor = vec4(col, 1.0);
}
`
```

Ocean class: constructor becomes `constructor(waves: WaveParams[], sunDir: THREE.Vector3, horizonColor: THREE.Color)`; add public field `foam = { threshold: 0.22, intensity: 0.9 }`; uniforms gain:

```ts
        uSunDir: { value: sunDir },
        uHorizonColor: { value: horizonColor },
        uFoamThreshold: { value: 0.22 },
        uFoamIntensity: { value: 0.9 },
```

(shared by reference — no per-frame copying needed for sun/horizon). In `update()`, after setting uTime:

```ts
    this.material.uniforms.uFoamThreshold.value = this.foam.threshold
    this.material.uniforms.uFoamIntensity.value = this.foam.intensity
```

- [ ] **Step 3:** In `src/main.ts` change the ocean construction to `const ocean = new Ocean(waves, sky.sunDir, sky.horizonColor)` (must come after `sky`).

- [ ] **Step 4:** `npm run test` (15 — wave displacement tests unchanged), `npm run build`, visual check: lit waves with sun streak, chunky white foam on sharp crests, horizon blends into sky. **Step 5:** Commit:

```bash
git add src/waves.ts src/ocean.ts src/main.ts
git commit -m "## - Light the ocean with analytic Gerstner normals and add procedural crest foam"
```

---

### Task 4: Wake ribbon — TDD on the pure helper

**Files:** Create `src/wake.ts`, `tests/wake.test.ts`; Modify `src/main.ts`

- [ ] **Step 1: Create `tests/wake.test.ts`:**

```ts
import { describe, expect, it } from 'vitest'
import { ageSamples, WakeSample } from '../src/wake'

describe('ageSamples', () => {
  it('ages every sample and expires the oldest past the lifetime', () => {
    const samples: WakeSample[] = [
      { x: 0, z: 0, age: 2.4 },
      { x: 1, z: 0, age: 1.0 },
      { x: 2, z: 0, age: 0.1 },
    ]
    ageSamples(samples, 0.2, 2.5)
    expect(samples).toHaveLength(2)
    expect(samples[0].age).toBeCloseTo(1.2)
    expect(samples[1].age).toBeCloseTo(0.3)
  })

  it('keeps order oldest-first and handles emptying completely', () => {
    const samples: WakeSample[] = [{ x: 0, z: 0, age: 5 }]
    ageSamples(samples, 1, 2.5)
    expect(samples).toHaveLength(0)
  })
})
```

- [ ] **Step 2:** `npm run test` — FAIL (cannot resolve ../src/wake).

- [ ] **Step 3: Create `src/wake.ts`:**

```ts
import * as THREE from 'three'
import type { Vessel } from './vessel'

const MAX_SAMPLES = 96
const SAMPLE_INTERVAL = 0.05
const MIN_WAKE_SPEED = 4
const STERN_OFFSET = 2

export interface WakeSample {
  x: number
  z: number
  age: number
}

export interface WakeTuning {
  width: number
  lifetime: number
}

export const defaultWakeTuning: WakeTuning = { width: 2.6, lifetime: 2.5 }

/** Advances ages in place and drops expired samples from the front (oldest first). */
export function ageSamples(samples: WakeSample[], dt: number, lifetime: number): WakeSample[] {

  for (const s of samples) {
    s.age += dt
  }
  while (samples.length > 0 && samples[0].age > lifetime) {
    samples.shift()
  }

  return samples
}

const vertexShader = /* glsl */ `
attribute float aAlpha;
attribute float aSide;
varying float vAlpha;
varying float vSide;
varying vec3 vWorldPos;

void main() {
  vAlpha = aAlpha;
  vSide = aSide;
  vWorldPos = position;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`

const fragmentShader = /* glsl */ `
uniform float uTime;
varying float vAlpha;
varying float vSide;
varying vec3 vWorldPos;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

void main() {
  float edge = 1.0 - vSide * vSide;
  float n = noise(vWorldPos.xz * 1.8 + uTime * 0.15);
  float a = vAlpha * edge * smoothstep(0.2, 0.75, n * 0.7 + 0.3);
  gl_FragColor = vec4(0.94, 0.97, 0.96, a);
}
`

/**
 * Stern wake: a triangle-strip ribbon over recent stern positions, widening
 * and fading with age, y-conformed to the wave surface each frame. Vertex
 * positions are world-space (mesh stays at the origin).
 */
export class Wake {
  readonly mesh: THREE.Mesh
  tuning: WakeTuning = { ...defaultWakeTuning }
  private readonly samples: WakeSample[] = []
  private sinceSample = 0
  private readonly geometry = new THREE.BufferGeometry()
  private readonly positions = new Float32Array(MAX_SAMPLES * 2 * 3)
  private readonly alphas = new Float32Array(MAX_SAMPLES * 2)
  private readonly material: THREE.ShaderMaterial

  constructor() {

    const indices: number[] = []
    for (let i = 0; i < MAX_SAMPLES - 1; i++) {
      const a = i * 2
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }

    const sides = new Float32Array(MAX_SAMPLES * 2)
    for (let i = 0; i < MAX_SAMPLES * 2; i++) {
      sides[i] = i % 2 === 0 ? -1 : 1
    }

    this.geometry.setIndex(indices)
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    this.geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1))
    this.geometry.setAttribute('aSide', new THREE.BufferAttribute(sides, 1))
    this.geometry.setDrawRange(0, 0)

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: { uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    })

    this.mesh = new THREE.Mesh(this.geometry, this.material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 1
  }

  update(dt: number, time: number, vessel: Vessel, sampleHeight: (x: number, z: number) => number) {

    this.material.uniforms.uTime.value = time
    ageSamples(this.samples, dt, this.tuning.lifetime)

    this.sinceSample += dt
    if (!vessel.airborne && Math.abs(vessel.speed) > MIN_WAKE_SPEED && this.sinceSample >= SAMPLE_INTERVAL) {
      this.sinceSample = 0
      this.samples.push({
        x: vessel.position.x - Math.sin(vessel.yaw) * STERN_OFFSET,
        z: vessel.position.z - Math.cos(vessel.yaw) * STERN_OFFSET,
        age: 0,
      })
      if (this.samples.length > MAX_SAMPLES) {
        this.samples.shift()
      }
    }

    const n = this.samples.length
    for (let i = 0; i < n; i++) {
      const s = this.samples[i]
      const prev = this.samples[Math.max(i - 1, 0)]
      const next = this.samples[Math.min(i + 1, n - 1)]

      let dx = next.x - prev.x
      let dz = next.z - prev.z
      const len = Math.hypot(dx, dz) || 1
      dx /= len
      dz /= len

      const ageT = s.age / this.tuning.lifetime
      const half = 0.35 + this.tuning.width * 0.5 * ageT
      const y = sampleHeight(s.x, s.z) + 0.06
      const alpha = Math.max(1 - ageT, 0) * 0.8
      const v = i * 2

      this.positions[v * 3] = s.x - dz * half
      this.positions[v * 3 + 1] = y
      this.positions[v * 3 + 2] = s.z + dx * half
      this.positions[v * 3 + 3] = s.x + dz * half
      this.positions[v * 3 + 4] = y
      this.positions[v * 3 + 5] = s.z - dx * half
      this.alphas[v] = alpha
      this.alphas[v + 1] = alpha
    }

    this.geometry.attributes.position.needsUpdate = true
    this.geometry.attributes.aAlpha.needsUpdate = true
    this.geometry.setDrawRange(0, Math.max(n - 1, 0) * 6)
  }
}
```

- [ ] **Step 4:** Wire into `src/main.ts`: import `{ Wake }`, after splash-less vessel setup add `const wake = new Wake()` + `scene.add(wake.mesh)`, and in the loop after `ocean.update(...)` add `wake.update(dt, simTime, vessel, sampler)`.

- [ ] **Step 5:** `npm run test` (17), `npm run build`, visual check: white fading ribbon behind the moving boat, conforms to waves, gaps while airborne. **Step 6:** Commit:

```bash
git add src/wake.ts tests/wake.test.ts src/main.ts
git commit -m "## - Add stern wake ribbon conformed to the wave surface"
```

---

### Task 5: Splash particles — TDD on the pool

**Files:** Create `src/splash.ts`, `tests/splash.test.ts`; Modify `src/main.ts`

- [ ] **Step 1: Create `tests/splash.test.ts`:**

```ts
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { Splash } from '../src/splash'
import { Vessel } from '../src/vessel'

describe('Splash', () => {
  it('spawns the requested burst and expires it over time', () => {
    const splash = new Splash()
    splash.burst(new THREE.Vector3(0, 0, 0), 10, 3)
    expect(splash.aliveCount()).toBe(10)
    splash.update(3, new Vessel(), 0, false) // max particle life is well under 3 s
    expect(splash.aliveCount()).toBe(0)
  })

  it('recycles the pool instead of overflowing', () => {
    const splash = new Splash()
    splash.burst(new THREE.Vector3(0, 0, 0), 600, 3)
    expect(splash.aliveCount()).toBeLessThanOrEqual(512)
  })

  it('emits a landing burst sized by impact', () => {
    const splash = new Splash()
    splash.update(1 / 60, new Vessel(), 8, false)
    expect(splash.aliveCount()).toBeGreaterThan(30)
  })
})
```

- [ ] **Step 2:** `npm run test` — FAIL (cannot resolve ../src/splash).

- [ ] **Step 3: Create `src/splash.ts`:**

```ts
import * as THREE from 'three'
import type { Vessel } from './vessel'

const CAPACITY = 512
const GRAVITY = 16

export interface SplashTuning {
  sprayRate: number // bow spray multiplier
  splashIntensity: number // landing burst multiplier
}

export const defaultSplashTuning: SplashTuning = { sprayRate: 1, splashIntensity: 1 }

const vertexShader = /* glsl */ `
attribute float aLife;
attribute float aSize;
varying float vLife;

void main() {
  vLife = aLife;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (180.0 / -mv.z) * (0.6 + 0.4 * vLife);
  gl_Position = projectionMatrix * mv;
}
`

const fragmentShader = /* glsl */ `
varying float vLife;

void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.18, d) * vLife * 0.85;
  if (a < 0.01) {
    discard;
  }
  gl_FragColor = vec4(0.95, 0.98, 1.0, a);
}
`

/**
 * One pooled particle system for all water spray. Fixed capacity; the spawn
 * cursor recycles the oldest slot. Three emitters live in update():
 * landing burst, takeoff puff, bow spray.
 */
export class Splash {
  readonly points: THREE.Points
  tuning: SplashTuning = { ...defaultSplashTuning }
  private readonly geometry = new THREE.BufferGeometry()
  private readonly positions = new Float32Array(CAPACITY * 3)
  private readonly velocities = new Float32Array(CAPACITY * 3)
  private readonly life = new Float32Array(CAPACITY)
  private readonly maxLife = new Float32Array(CAPACITY)
  private readonly lifeAttr = new Float32Array(CAPACITY)
  private readonly sizeAttr = new Float32Array(CAPACITY)
  private cursor = 0
  private sprayCarry = 0

  constructor() {

    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    this.geometry.setAttribute('aLife', new THREE.BufferAttribute(this.lifeAttr, 1))
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizeAttr, 1))

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
    })

    this.points = new THREE.Points(this.geometry, material)
    this.points.frustumCulled = false
    this.points.renderOrder = 2
  }

  aliveCount(): number {

    let count = 0
    for (let i = 0; i < CAPACITY; i++) {
      if (this.life[i] > 0) {
        count++
      }
    }

    return count
  }

  burst(center: THREE.Vector3, count: number, speed: number) {

    for (let j = 0; j < count; j++) {
      const angle = Math.random() * Math.PI * 2
      const radial = (0.4 + Math.random() * 0.6) * speed
      this.spawn(
        center.x + Math.cos(angle) * 0.8,
        center.y + 0.1,
        center.z + Math.sin(angle) * 0.8,
        Math.cos(angle) * radial,
        (0.5 + Math.random() * 0.9) * speed * 0.55 + 1.0,
        Math.sin(angle) * radial,
        0.5 + Math.random() * 0.7,
        1.4 + Math.random() * 1.6,
      )
    }
  }

  update(dt: number, vessel: Vessel, landedImpact: number, tookOff: boolean) {

    const t = this.tuning

    if (landedImpact > 2) {
      const count = Math.min(Math.round(landedImpact * 9 * t.splashIntensity), 110)
      this.burst(vessel.position, count, Math.min(landedImpact * 0.55, 8))
    }
    if (tookOff) {
      this.burst(vessel.position, 14, 2.5)
    }

    const speed = Math.abs(vessel.speed)
    if (!vessel.airborne && speed > 8) {
      const sinYaw = Math.sin(vessel.yaw)
      const cosYaw = Math.cos(vessel.yaw)
      this.sprayCarry += t.sprayRate * 90 * Math.min((speed - 8) / 25, 1) * dt
      while (this.sprayCarry >= 1) {
        this.sprayCarry -= 1
        const side = Math.random() < 0.5 ? -1 : 1
        this.spawn(
          vessel.position.x + sinYaw * 1.8 + cosYaw * 0.9 * side,
          vessel.position.y + 0.15,
          vessel.position.z + cosYaw * 1.8 - sinYaw * 0.9 * side,
          vessel.vx * 0.35 + cosYaw * side * (1.5 + Math.random() * 2.0),
          1.5 + Math.random() * 2.0,
          vessel.vz * 0.35 - sinYaw * side * (1.5 + Math.random() * 2.0),
          0.35 + Math.random() * 0.35,
          0.8 + Math.random() * 0.9,
        )
      }
    }

    for (let i = 0; i < CAPACITY; i++) {
      if (this.life[i] <= 0) {
        continue
      }
      this.life[i] -= dt
      if (this.life[i] <= 0) {
        this.lifeAttr[i] = 0
        this.sizeAttr[i] = 0
        continue
      }
      this.velocities[i * 3 + 1] -= GRAVITY * dt
      this.positions[i * 3] += this.velocities[i * 3] * dt
      this.positions[i * 3 + 1] += this.velocities[i * 3 + 1] * dt
      this.positions[i * 3 + 2] += this.velocities[i * 3 + 2] * dt
      this.lifeAttr[i] = this.life[i] / this.maxLife[i]
    }

    this.geometry.attributes.position.needsUpdate = true
    this.geometry.attributes.aLife.needsUpdate = true
    this.geometry.attributes.aSize.needsUpdate = true
  }

  private spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, lifeSeconds: number, size: number) {

    const i = this.cursor
    this.cursor = (this.cursor + 1) % CAPACITY

    this.positions[i * 3] = x
    this.positions[i * 3 + 1] = y
    this.positions[i * 3 + 2] = z
    this.velocities[i * 3] = vx
    this.velocities[i * 3 + 1] = vy
    this.velocities[i * 3 + 2] = vz
    this.life[i] = lifeSeconds
    this.maxLife[i] = lifeSeconds
    this.lifeAttr[i] = 1
    this.sizeAttr[i] = size
  }
}
```

- [ ] **Step 4: Wire into `src/main.ts`.** Import `{ Splash }`, add `const splash = new Splash()` + `scene.add(splash.points)`. Events must be accumulated ACROSS fixed physics steps (a landing in the first of two steps would otherwise be lost). Replace the physics loop body and add the splash update:

```ts
let pendingLanding = 0
let pendingTakeoff = false

// inside frame(), the accumulator loop becomes:
  while (accumulator >= STEP) {
    simTime += STEP
    vessel.update(STEP, input.state, sampler)
    pendingLanding = Math.max(pendingLanding, vessel.justLanded)
    pendingTakeoff = pendingTakeoff || vessel.justTookOff
    accumulator -= STEP
  }

// after wake.update(...):
  splash.update(dt, vessel, pendingLanding, pendingTakeoff)
  pendingLanding = 0
  pendingTakeoff = false
```

- [ ] **Step 5:** `npm run test` (20), `npm run build`, visual check: bow V-spray at speed, splash burst on landings. **Step 6:** Commit:

```bash
git add src/splash.ts tests/splash.test.ts src/main.ts
git commit -m "## - Add pooled splash particles for landings, takeoffs and bow spray"
```

---

### Task 6: Visuals tuning folder + final verification

**Files:** Modify `src/tuning.ts`, `src/main.ts`

- [ ] **Step 1: Extend `TuningTargets` in `src/tuning.ts`:**

```ts
import type { WakeTuning } from './wake'
import type { SplashTuning } from './splash'

export interface TuningTargets {
  waves: WaveParams[]
  onWavesChanged: () => void
  vessel: VesselTuning
  camera: CameraTuning
  sun: { azimuth: number; elevation: number }
  onSunChanged: () => void
  oceanFoam: { threshold: number; intensity: number }
  wake: WakeTuning
  splash: SplashTuning
}
```

Add after the Camera folder:

```ts
  const visuals = gui.addFolder('Visuals')
  visuals.add(targets.sun, 'azimuth', -Math.PI, Math.PI, 0.01).onChange(targets.onSunChanged)
  visuals.add(targets.sun, 'elevation', 0.03, 1.2, 0.01).onChange(targets.onSunChanged)
  visuals.add(targets.oceanFoam, 'threshold', 0, 1, 0.01).name('foamThreshold')
  visuals.add(targets.oceanFoam, 'intensity', 0, 1.5, 0.01).name('foamIntensity')
  visuals.add(targets.wake, 'width', 0.5, 6, 0.1).name('wakeWidth')
  visuals.add(targets.wake, 'lifetime', 0.5, 6, 0.1).name('wakeLifetime')
  visuals.add(targets.splash, 'sprayRate', 0, 3, 0.05)
  visuals.add(targets.splash, 'splashIntensity', 0, 3, 0.05)
```

- [ ] **Step 2:** Update the `createTuningPanel` call in `src/main.ts`:

```ts
createTuningPanel({
  waves,
  onWavesChanged: () => ocean.updateWaves(waves),
  vessel: vessel.tuning,
  camera: chase.tuning,
  sun: sunState,
  onSunChanged: applySun,
  oceanFoam: ocean.foam,
  wake: wake.tuning,
  splash: splash.tuning,
})
```

- [ ] **Step 3: Full verification.** `npm run test` (20 pass), `npm run build` (clean). Headless screenshot sweep (idle foam + sky, full-throttle wake + spray, post-landing splash) and human playtest: sun slider moves the sun AND the water lighting AND the boat lighting together; foam responds to threshold slider live.

- [ ] **Step 4:** Commit:

```bash
git add src/tuning.ts src/main.ts
git commit -m "## - Add Visuals tuning folder for sun, foam, wake and spray"
```

---

## Plan self-review record

- **Spec coverage:** §3.1 sky → Task 2; §3.2 ocean shading/foam → Task 3; §3.3 vessel events → Task 1; §3.4 wake → Task 4; §3.5 splash/emitters → Task 5; §3.6 tuning → Task 6; §4 data flow (event accumulation across steps) → Task 5 Step 4; §6 testing → Tasks 1/4/5 + Task 6 Step 3.
- **Placeholders:** none — full code everywhere.
- **Type consistency:** `Sky.sunDir`/`horizonColor` getters (Task 2) match Ocean constructor args (Task 3) and `applySun` (Task 2); `vessel.justLanded`/`justTookOff` (Task 1) match main.ts accumulation (Task 5); `WakeTuning`/`SplashTuning`/`ocean.foam` shapes (Tasks 3–5) match TuningTargets (Task 6); `wake.update(dt, simTime, vessel, sampler)` signature consistent between Tasks 4 and 5.
