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
  { direction: 0.0, amplitude: 2.5, wavelength: 70, steepness: 0.8, speed: 9.0 },
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
 *
 * Converges when mean steepness is below 1 (the fixed-point map is a
 * contraction with constant ≈ Σ steepness / N). The tuning panel caps
 * steepness at 1 per wave, which keeps this safe.
 */
export function surfaceHeight(waves: WaveParams[], x: number, z: number, t: number): number {
  let gx = x
  let gz = z

  for (let i = 0; i < 3; i++) {
    gerstnerDisplace(waves, gx, gz, t, tmp)
    gx = x - tmp.x
    gz = z - tmp.z
  }

  // final sample at the converged grid point
  gerstnerDisplace(waves, gx, gz, t, tmp)

  return tmp.y
}

/**
 * GLSL twin of gerstnerDisplace(). Prepended to the ocean vertex shader.
 * MUST stay line-for-line equivalent to the TypeScript function above.
 *
 * Known limitation: phase is computed in float32 on the GPU from absolute uTime,
 * so visual precision degrades over very long sessions (~hours) and live
 * speed-slider changes cause a phase jump proportional to elapsed time.
 * Acceptable for a feel prototype; a production version should upload per-wave
 * phases accumulated in float64 on the CPU.
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
    disp.y += a * sin(phase);
    disp.z += q * a * d.y * c;
  }
  return disp;
}
`
