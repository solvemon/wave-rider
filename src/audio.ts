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

/**
 * Engine voice v2 — combustion-first. A real engine is mostly PULSED NOISE
 * (exhaust bursts at the firing rate), not tones: broadband noise is
 * amplitude-gated at the firing frequency, run through grit and two fixed
 * "exhaust pipe" resonators. Light oscillator support underneath, and a
 * per-frame pitch wobble so no two cycles are identical (perfect
 * periodicity is what reads as "NES synth").
 */
class EngineVoice {
  private readonly fireOsc: OscillatorNode // gates the combustion noise
  private readonly sub: OscillatorNode
  private readonly saw: OscillatorNode
  private readonly saw2: OscillatorNode
  private readonly boostSaw: OscillatorNode
  private readonly boostGain: GainNode
  private readonly shaper: WaveShaperNode
  private readonly body: BiquadFilterNode
  private readonly gain: GainNode

  constructor(private readonly ctx: AudioContext, destination: AudioNode) {

    this.gain = ctx.createGain()
    this.gain.gain.value = 0
    this.gain.connect(destination)

    this.body = ctx.createBiquadFilter()
    this.body.type = 'lowpass'
    this.body.frequency.value = 800
    this.body.Q.value = 0.7
    this.body.connect(this.gain)

    // fixed exhaust-pipe resonances — these stay put while rpm moves,
    // which is what gives the sound a consistent mechanical "body"
    const pipe1 = this.ctx.createBiquadFilter()
    pipe1.type = 'peaking'
    pipe1.frequency.value = 190
    pipe1.Q.value = 2
    pipe1.gain.value = 7
    const pipe2 = this.ctx.createBiquadFilter()
    pipe2.type = 'peaking'
    pipe2.frequency.value = 680
    pipe2.Q.value = 3
    pipe2.gain.value = 4
    pipe1.connect(pipe2).connect(this.body)

    this.shaper = ctx.createWaveShaper()
    this.shaper.curve = makeDriveCurve(2.8)
    this.shaper.connect(pipe1)

    // combustion core: noise gated at the firing rate (audio-rate AM)
    const noise = ctx.createBufferSource()
    noise.buffer = makeNoiseBuffer(ctx)
    noise.loop = true
    const noiseColor = ctx.createBiquadFilter()
    noiseColor.type = 'lowpass'
    noiseColor.frequency.value = 2200
    const pulseGate = ctx.createGain()
    pulseGate.gain.value = 0.45 // base; fireOsc swings it 0..0.9
    this.fireOsc = ctx.createOscillator()
    this.fireOsc.type = 'square'
    const pulseDepth = ctx.createGain()
    pulseDepth.gain.value = 0.45
    this.fireOsc.connect(pulseDepth).connect(pulseGate.gain)
    noise.connect(noiseColor).connect(pulseGate).connect(this.shaper)

    // light tonal support under the combustion
    this.sub = ctx.createOscillator()
    this.sub.type = 'sine'
    const subGain = ctx.createGain()
    subGain.gain.value = 0.4
    this.sub.connect(subGain).connect(this.shaper)

    this.saw = ctx.createOscillator()
    this.saw.type = 'sawtooth'
    this.saw2 = ctx.createOscillator()
    this.saw2.type = 'sawtooth'
    const sawGain = ctx.createGain()
    sawGain.gain.value = 0.09 // support, not lead — the beating between the
    const sawGain2 = ctx.createGain() // two detuned saws reads as uneven cylinders
    sawGain2.gain.value = 0.09
    this.saw.connect(sawGain).connect(this.shaper)
    this.saw2.connect(sawGain2).connect(this.shaper)

    // nitro layer: hot detuned saw, silent until boosting
    this.boostSaw = ctx.createOscillator()
    this.boostSaw.type = 'sawtooth'
    this.boostSaw.detune.value = -14
    this.boostGain = ctx.createGain()
    this.boostGain.gain.value = 0
    this.boostSaw.connect(this.boostGain).connect(this.shaper)

    this.fireOsc.start()
    this.sub.start()
    this.saw.start()
    this.saw2.start()
    this.boostSaw.start()
    noise.start()
  }

  update(rpm: number, boosting: boolean, volume: number) {

    const t = this.ctx.currentTime

    // per-frame random wobble, smoothed into a lope by setTargetAtTime —
    // cycle-to-cycle irregularity is what separates "motor" from "synth"
    const wobble = (Math.random() - 0.5) * (1.2 + rpm * 2.5)
    const f = 28 + rpm * 72 + wobble

    this.fireOsc.frequency.setTargetAtTime(f, t, SMOOTH)
    this.sub.frequency.setTargetAtTime(f, t, SMOOTH)
    this.saw.frequency.setTargetAtTime(f * 2, t, SMOOTH)
    this.saw2.frequency.setTargetAtTime(f * 2 * 1.013, t, SMOOTH)
    this.boostSaw.frequency.setTargetAtTime(f * 3, t, SMOOTH)
    this.boostGain.gain.setTargetAtTime(boosting ? 0.35 : 0, t, SMOOTH)
    this.body.frequency.setTargetAtTime(800 + rpm * 1500, t, SMOOTH)
    this.gain.gain.setTargetAtTime((0.16 + rpm * 0.22) * volume, t, SMOOTH)
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
const SFX_EXTENSIONS = ['ogg', 'mp3', 'wav']
type SfxName = (typeof SFX_NAMES)[number]

/** One-shot sample slots — drop files in public/sfx/<name>.{ogg,mp3,wav} and they play. */
class Sfx {
  private readonly buffers = new Map<SfxName, AudioBuffer>()

  constructor(private readonly ctx: AudioContext, private readonly destination: AudioNode) {
    for (const name of SFX_NAMES) {
      this.load(name, 0)
    }
  }

  private load(name: SfxName, extIndex: number) {
    if (extIndex >= SFX_EXTENSIONS.length) {
      return // no asset for this slot — stays silent
    }
    fetch(`${import.meta.env.BASE_URL}sfx/${name}.${SFX_EXTENSIONS[extIndex]}`)
      .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error('missing'))))
      .then((data) => this.ctx.decodeAudioData(data))
      .then((buffer) => this.buffers.set(name, buffer))
      .catch(() => this.load(name, extIndex + 1))
  }

  play(name: SfxName, volume = 1, options: { rate?: number; delay?: number; lowpassHz?: number } = {}) {

    const buffer = this.buffers.get(name)
    if (buffer === undefined) {
      return
    }

    const source = this.ctx.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = (options.rate ?? 1) * (0.95 + Math.random() * 0.1)
    const gain = this.ctx.createGain()
    gain.gain.value = volume

    let tail: AudioNode = gain
    if (options.lowpassHz !== undefined) {
      const filter = this.ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = options.lowpassHz
      gain.connect(filter)
      tail = filter
    }

    source.connect(gain)
    tail.connect(this.destination)
    source.start(this.ctx.currentTime + (options.delay ?? 0))
  }

  /** Synthesized low "whomp" — fakes the low-end mass small recordings lack. */
  thump(volume: number) {

    const t = this.ctx.currentTime
    const osc = this.ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(55, t)
    osc.frequency.exponentialRampToValueAtTime(28, t + 0.25)

    const gain = this.ctx.createGain()
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(volume, t + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4)

    osc.connect(gain).connect(this.destination)
    osc.start(t)
    osc.stop(t + 0.45)
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
    if (impact <= 3 || this.sfx === null) {
      return
    }

    // layered "big splash": harder landings pitch lower and hit heavier
    const force = Math.min((impact - 3) / 9, 1) // 0..1 over the 3..12 m/s range
    const volume = 0.5 + force * 0.5
    const baseRate = 0.85 - force * 0.3
    this.sfx.play('splash', volume, { rate: baseRate }) // main event, pitched down
    this.sfx.play('splash', volume * 0.45, { rate: baseRate * 1.7 }) // initial slap
    this.sfx.play('splash', volume * 0.85, { rate: baseRate * 0.5, delay: 0.03, lowpassHz: 500 }) // heavy body
    this.sfx.thump(0.25 + force * 0.55)
  }

  tookOff() {
    this.sfx?.play('takeoff', 0.7)
  }

  bonus(b: Bonus) {
    this.sfx?.play(b.big ? 'big-bonus' : 'bonus', 0.8)
  }
}
