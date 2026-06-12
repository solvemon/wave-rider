import type { Vessel } from './vessel'
import type { Bonus } from './score'

export interface AudioTuning {
  master: number
  engine: number
}

export const defaultAudioTuning: AudioTuning = { master: 0.5, engine: 0.8 }

const IDLE_RPM = 0.15
const SPOOL_RATE = 4 // 1/s — how fast rpm chases its target

/**
 * Virtual engine: rpm chases a target derived from throttle and load.
 * Pure and voice-agnostic — swap the synth for samples later, keep this.
 */
export class EngineModel {
  rpm = 0

  update(dt: number, throttle: number, airborne: boolean, boosting: boolean): number {

    let target = IDLE_RPM + Math.max(throttle, 0) * 0.65
    if (airborne) {
      target += 0.3 // unloaded — the prop screams
    }
    if (boosting) {
      target += 0.15
    }
    target = Math.min(target, 1.2)

    this.rpm += (target - this.rpm) * Math.min(SPOOL_RATE * dt, 1)

    return this.rpm
  }

  /** Momentary load spike (landing slap). */
  bogDown(amount: number) {
    this.rpm = Math.max(this.rpm - amount, IDLE_RPM * 0.7)
  }
}

function makeNoiseBuffer(ctx: AudioContext): AudioBuffer {

  const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) {
    data[i] = Math.random() * 2 - 1
  }

  return buffer
}

function makeDriveCurve(amount: number) {

  const curve = new Float32Array(256)
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1
    curve[i] = Math.tanh(x * amount)
  }

  return curve
}

const SMOOTH = 0.04 // setTargetAtTime time constant — kills zipper noise

/** Arcade engine voice: harmonics + hiss through grit and a fixed-range body filter. */
class EngineVoice {
  private readonly saw: OscillatorNode
  private readonly square: OscillatorNode
  private readonly sub: OscillatorNode
  private readonly boostSaw: OscillatorNode
  private readonly boostGain: GainNode
  private readonly noiseGain: GainNode
  private readonly shaper: WaveShaperNode
  private readonly body: BiquadFilterNode
  private readonly gain: GainNode

  constructor(private readonly ctx: AudioContext, destination: AudioNode) {

    this.gain = ctx.createGain()
    this.gain.gain.value = 0
    this.gain.connect(destination)

    this.body = ctx.createBiquadFilter()
    this.body.type = 'lowpass'
    this.body.frequency.value = 900
    this.body.Q.value = 0.8
    this.body.connect(this.gain)

    this.shaper = ctx.createWaveShaper()
    this.shaper.curve = makeDriveCurve(2.2)
    this.shaper.connect(this.body)

    this.saw = ctx.createOscillator()
    this.saw.type = 'sawtooth'
    this.square = ctx.createOscillator()
    this.square.type = 'square'
    this.square.detune.value = 6
    this.sub = ctx.createOscillator()
    this.sub.type = 'sine'

    const sawGain = ctx.createGain()
    sawGain.gain.value = 0.5
    const squareGain = ctx.createGain()
    squareGain.gain.value = 0.18
    const subGain = ctx.createGain()
    subGain.gain.value = 0.45
    this.saw.connect(sawGain).connect(this.shaper)
    this.square.connect(squareGain).connect(this.shaper)
    this.sub.connect(subGain).connect(this.shaper)

    // nitro layer: hot detuned saw, silent until boosting
    this.boostSaw = ctx.createOscillator()
    this.boostSaw.type = 'sawtooth'
    this.boostSaw.detune.value = -14
    this.boostGain = ctx.createGain()
    this.boostGain.gain.value = 0
    this.boostSaw.connect(this.boostGain).connect(this.shaper)

    const noise = ctx.createBufferSource()
    noise.buffer = makeNoiseBuffer(ctx)
    noise.loop = true
    const noiseFilter = ctx.createBiquadFilter()
    noiseFilter.type = 'bandpass'
    noiseFilter.frequency.value = 1400
    noiseFilter.Q.value = 0.6
    this.noiseGain = ctx.createGain()
    this.noiseGain.gain.value = 0
    noise.connect(noiseFilter).connect(this.noiseGain).connect(this.body)

    this.saw.start()
    this.square.start()
    this.sub.start()
    this.boostSaw.start()
    noise.start()
  }

  update(rpm: number, boosting: boolean, volume: number) {

    const t = this.ctx.currentTime
    const f = 45 + rpm * 110

    this.saw.frequency.setTargetAtTime(f, t, SMOOTH)
    this.square.frequency.setTargetAtTime(f * 2, t, SMOOTH)
    this.sub.frequency.setTargetAtTime(f * 0.5, t, SMOOTH)
    this.boostSaw.frequency.setTargetAtTime(f * 1.5, t, SMOOTH)
    this.boostGain.gain.setTargetAtTime(boosting ? 0.4 : 0, t, SMOOTH)
    this.noiseGain.gain.setTargetAtTime(0.05 + rpm * 0.18, t, SMOOTH)
    this.body.frequency.setTargetAtTime(900 + rpm * 1800, t, SMOOTH)
    this.gain.gain.setTargetAtTime((0.12 + rpm * 0.2) * volume, t, SMOOTH)
  }
}

/** Speed-scaled water rush; ducked in the air. */
class WaterAmbience {
  private readonly filter: BiquadFilterNode
  private readonly gain: GainNode

  constructor(private readonly ctx: AudioContext, destination: AudioNode) {

    this.gain = ctx.createGain()
    this.gain.gain.value = 0
    this.gain.connect(destination)

    this.filter = ctx.createBiquadFilter()
    this.filter.type = 'lowpass'
    this.filter.frequency.value = 400
    this.filter.connect(this.gain)

    const noise = ctx.createBufferSource()
    noise.buffer = makeNoiseBuffer(ctx)
    noise.loop = true
    noise.connect(this.filter)
    noise.start()
  }

  update(speed: number, airborne: boolean) {

    const t = this.ctx.currentTime
    const s = Math.min(Math.abs(speed) / 40, 1)
    this.gain.gain.setTargetAtTime(airborne ? 0.02 : 0.04 + s * 0.14, t, 0.1)
    this.filter.frequency.setTargetAtTime(400 + s * 1600, t, 0.1)
  }
}

const SFX_NAMES = ['bonus', 'big-bonus', 'splash', 'takeoff', 'nitro'] as const
type SfxName = (typeof SFX_NAMES)[number]

/** One-shot sample slots — drop files in public/sfx/<name>.mp3 and they play. */
class Sfx {
  private readonly buffers = new Map<SfxName, AudioBuffer>()

  constructor(private readonly ctx: AudioContext, private readonly destination: AudioNode) {
    for (const name of SFX_NAMES) {
      fetch(`${import.meta.env.BASE_URL}sfx/${name}.mp3`)
        .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error('missing'))))
        .then((data) => ctx.decodeAudioData(data))
        .then((buffer) => this.buffers.set(name, buffer))
        .catch(() => {}) // slot stays silent until an asset shows up
    }
  }

  play(name: SfxName, volume = 1) {

    const buffer = this.buffers.get(name)
    if (buffer === undefined) {
      return
    }

    const source = this.ctx.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = 0.9 + Math.random() * 0.2
    const gain = this.ctx.createGain()
    gain.gain.value = volume
    source.connect(gain).connect(this.destination)
    source.start()
  }
}

/**
 * Facade. AudioContext starts on the first key press (browser gesture rule);
 * everything no-ops until then.
 */
export class AudioSystem {
  tuning: AudioTuning = { ...defaultAudioTuning }
  readonly model = new EngineModel()
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private voice: EngineVoice | null = null
  private water: WaterAmbience | null = null
  private sfx: Sfx | null = null
  private wasBoosting = false

  /** Call once; arms a one-time gesture listener that boots the audio graph. */
  attach() {
    window.addEventListener(
      'keydown',
      () => {
        this.ctx = new AudioContext()
        this.master = this.ctx.createGain()
        this.master.connect(this.ctx.destination)
        this.voice = new EngineVoice(this.ctx, this.master)
        this.water = new WaterAmbience(this.ctx, this.master)
        this.sfx = new Sfx(this.ctx, this.master)
      },
      { once: true },
    )
  }

  update(dt: number, vessel: Vessel, boosting: boolean, throttle: number) {

    const rpm = this.model.update(dt, throttle, vessel.airborne, boosting)
    if (this.ctx === null || this.master === null) {
      return
    }

    this.master.gain.setTargetAtTime(this.tuning.master, this.ctx.currentTime, 0.05)
    this.voice?.update(rpm, boosting, this.tuning.engine)
    this.water?.update(vessel.speed, vessel.airborne)

    if (boosting && !this.wasBoosting) {
      this.sfx?.play('nitro')
    }
    this.wasBoosting = boosting
  }

  landed(impact: number) {
    this.model.bogDown(Math.min(impact * 0.04, 0.35))
    if (impact > 3) {
      this.sfx?.play('splash', Math.min(impact / 10, 1))
    }
  }

  tookOff() {
    this.sfx?.play('takeoff', 0.7)
  }

  bonus(b: Bonus) {
    this.sfx?.play(b.big ? 'big-bonus' : 'bonus', 0.8)
  }
}
