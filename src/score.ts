export type BonusKind = 'airtime' | 'snorkel' | 'smack' | 'headSmack' | 'megaSmack'

export interface Bonus {
  kind: BonusKind
  name: string
  points: number
}

// every bonus rolls a random flavor: surf bro / deadpan nautical / maximum dumb
const NAME_POOLS: Record<BonusKind, string[]> = {
  airtime: ['BIG AIR', 'UNSCHEDULED FLIGHT', 'YEEEET'],
  snorkel: ['SNORKEL TIME', 'PERISCOPE DOWN', 'GLUG GLUG GLUG'],
  smack: ['DECK SMACK', 'HULL INSPECTION', 'BONK'],
  headSmack: ['FACE CHECK', "CAPTAIN'S INSPECTION", 'FACE BONK'],
  megaSmack: ['MEGA SMACK', 'INSURANCE CLAIM', 'MEGA BONK'],
}

export interface ScoreTuning {
  airRate: number // points per second of airtime
  airBigBonus: number // quadratic term — big jumps pay disproportionately more
  snorkelRate: number // points per full second head-under
  smackFactor: number
  headFactor: number
  megaFactor: number
  smackThreshold: number // m/s into the deck before a hit counts
  megaThreshold: number
}

// Calibrated from playtesting: routine wave-chop bouncing peaks around
// 4 m/s into the deck — the threshold sits just above it so only real
// slams score. Airtime outvalues passive smacks on purpose.
export const defaultScoreTuning: ScoreTuning = {
  airRate: 30,
  airBigBonus: 40,
  snorkelRate: 25,
  smackFactor: 12,
  headFactor: 18,
  megaFactor: 24,
  smackThreshold: 7,
  megaThreshold: 10,
}

const MIN_AIR_SECONDS = 0.5
const SMACK_COOLDOWN = 0.25
const SMACK_WINDOW = 2 // smacks only score in the seconds after a real jump landing

/** Pure scoring logic — no DOM, deterministic via the injected RNG. */
export class ScoreState {
  total = 0
  tuning: ScoreTuning = { ...defaultScoreTuning }
  /** Audio hook: subscribe when sound assets land. */
  onBonus?: (bonus: Bonus) => void
  private airSeconds = 0
  private snorkelSeconds = 0
  private smackCooldown = 0
  private suppressTimer = 0
  private smackWindow = 0
  private readonly queue: Bonus[] = []

  constructor(private readonly random: () => number = Math.random) {}

  /** True while smack scoring is paused (e.g. right after a ragdoll reset). */
  get smacksSuppressed(): boolean {
    return this.suppressTimer > 0
  }

  /** Pause smack scoring — the ragdoll reset slams the doll into pose, which must not pay out. */
  suppressSmacks(seconds: number) {
    this.suppressTimer = Math.max(this.suppressTimer, seconds)
  }

  tick(dt: number, vesselAirborne: boolean, headSubmerged: boolean) {

    this.smackCooldown = Math.max(0, this.smackCooldown - dt)
    this.suppressTimer = Math.max(0, this.suppressTimer - dt)
    this.smackWindow = Math.max(0, this.smackWindow - dt)
    if (vesselAirborne) {
      this.airSeconds += dt
    }

    if (headSubmerged) {
      this.snorkelSeconds += dt
      if (this.snorkelSeconds >= 1) {
        this.snorkelSeconds -= 1
        this.award('snorkel', this.tuning.snorkelRate)
      }
    } else {
      this.snorkelSeconds = 0
    }
  }

  /**
   * Call when the vessel touches down — pays out accumulated airtime
   * (quadratic in duration: big jumps pay disproportionately) and opens
   * the window in which ragdoll smacks count as stunt damage.
   */
  landed() {

    if (this.airSeconds >= MIN_AIR_SECONDS) {
      const t = this.airSeconds
      this.award('airtime', Math.round(t * this.tuning.airRate + t * t * this.tuning.airBigBonus))
      this.smackWindow = SMACK_WINDOW
    }
    this.airSeconds = 0
  }

  deckImpact(force: number, head: boolean) {

    // smacks only count in a jump's aftermath — idle wave heave bumps the
    // doll against the hull constantly and must never score
    if (this.smackWindow <= 0) {
      return
    }
    if (force < this.tuning.smackThreshold || this.smackCooldown > 0 || this.suppressTimer > 0) {
      return
    }
    this.smackCooldown = SMACK_COOLDOWN

    if (force >= this.tuning.megaThreshold) {
      this.award('megaSmack', Math.round(force * this.tuning.megaFactor))
    } else if (head) {
      this.award('headSmack', Math.round(force * this.tuning.headFactor))
    } else {
      this.award('smack', Math.round(force * this.tuning.smackFactor))
    }
  }

  /** Returns and clears the pending bonus queue (consumed by the overlay). */
  drain(): Bonus[] {
    return this.queue.splice(0, this.queue.length)
  }

  private award(kind: BonusKind, points: number) {

    const pool = NAME_POOLS[kind]
    const bonus: Bonus = { kind, name: pool[Math.floor(this.random() * pool.length)], points }

    this.total += points
    this.queue.push(bonus)
    this.onBonus?.(bonus)
  }
}

const POPUP_POOL_SIZE = 8

/** DOM presentation: retro counter top-left + pooled floating popups. */
export class ScoreOverlay {
  private readonly counter: HTMLDivElement
  private readonly popups: HTMLDivElement[] = []
  private nextPopup = 0

  constructor(parent: HTMLElement) {

    this.counter = document.createElement('div')
    this.counter.style.cssText =
      'position:fixed;top:14px;left:18px;font:700 28px/1 ui-monospace,monospace;color:#fff;' +
      'text-shadow:0 2px 0 rgba(0,0,0,.45);z-index:10;pointer-events:none;'
    this.counter.textContent = '0'
    parent.appendChild(this.counter)

    for (let i = 0; i < POPUP_POOL_SIZE; i++) {
      const el = document.createElement('div')
      el.style.cssText =
        'position:fixed;font:800 22px/1 ui-monospace,monospace;color:#fff;' +
        'text-shadow:0 2px 0 rgba(0,0,0,.5);z-index:10;pointer-events:none;opacity:0;' +
        'will-change:transform,opacity;'
      parent.appendChild(el)
      this.popups.push(el)
    }
  }

  setTotal(total: number) {
    this.counter.textContent = String(total)
  }

  popup(text: string, x: number, y: number, big: boolean) {

    const el = this.popups[this.nextPopup]
    this.nextPopup = (this.nextPopup + 1) % POPUP_POOL_SIZE

    el.style.transition = 'none'
    el.style.transform = 'translate(-50%, 0)'
    el.style.left = `${x}px`
    el.style.top = `${y}px`
    el.style.opacity = '1'
    el.style.fontSize = big ? '36px' : '22px'
    el.style.color = big ? '#ffd54f' : '#ffffff'
    el.textContent = text

    void el.offsetWidth // reflow so the transition restarts cleanly
    el.style.transition = 'transform 1.2s ease-out, opacity 1.2s ease-out'
    el.style.transform = 'translate(-50%, -70px)'
    el.style.opacity = '0'
  }
}
