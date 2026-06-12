export interface TouchState {
  throttle: number
  steer: number
  roll: number
  boost: boolean
}

const BASE_STYLE =
  'position:fixed;display:flex;align-items:center;justify-content:center;border-radius:50%;' +
  'background:rgba(255,255,255,.14);border:2px solid rgba(255,255,255,.45);color:#fff;' +
  'font:700 20px/1 ui-monospace,monospace;z-index:20;user-select:none;-webkit-user-select:none;' +
  '-webkit-tap-highlight-color:transparent;touch-action:none;'

/**
 * Two-thumb on-screen controls, additive to the keyboard. Left thumb:
 * steer (water) with roll above it (air). Right thumb: gas with boost
 * above it. Only built on coarse-pointer devices.
 */
export class TouchControls {
  readonly state: TouchState = { throttle: 0, steer: 0, roll: 0, boost: false }

  static isTouchDevice(): boolean {
    return window.matchMedia('(pointer: coarse)').matches
  }

  constructor(parent: HTMLElement) {

    document.body.style.touchAction = 'none'

    // left cluster — steer, with roll above
    this.button(parent, '◀', 'left:18px;bottom:18px;width:72px;height:72px;', (on) => {
      this.state.steer = on ? this.state.steer - 1 : this.state.steer + 1
    })
    this.button(parent, '▶', 'left:104px;bottom:18px;width:72px;height:72px;', (on) => {
      this.state.steer = on ? this.state.steer + 1 : this.state.steer - 1
    })
    this.button(parent, '↺', 'left:26px;bottom:104px;width:56px;height:56px;', (on) => {
      this.state.roll = on ? this.state.roll + 1 : this.state.roll - 1
    })
    this.button(parent, '↻', 'left:112px;bottom:104px;width:56px;height:56px;', (on) => {
      this.state.roll = on ? this.state.roll - 1 : this.state.roll + 1
    })

    // right cluster — gas with boost above
    this.button(parent, 'GAS', 'right:18px;bottom:18px;width:96px;height:96px;font-size:16px;', (on) => {
      this.state.throttle = on ? this.state.throttle + 1 : this.state.throttle - 1
    })
    this.button(
      parent,
      'BOOST',
      'right:34px;bottom:130px;width:64px;height:64px;font-size:11px;' +
        'background:rgba(255,152,0,.25);border-color:rgba(255,183,77,.7);',
      (on) => {
        this.state.boost = on
      },
    )
  }

  private button(parent: HTMLElement, label: string, position: string, toggle: (on: boolean) => void) {

    const el = document.createElement('div')
    el.style.cssText = BASE_STYLE + position
    el.textContent = label
    parent.appendChild(el)

    let held = false
    const set = (on: boolean) => {
      if (on === held) {
        return
      }
      held = on
      el.style.filter = on ? 'brightness(2)' : '' // brighten, preserving each button's own color
      toggle(on)
    }

    el.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      el.setPointerCapture(e.pointerId)
      set(true)
    })
    el.addEventListener('pointerup', () => set(false))
    el.addEventListener('pointercancel', () => set(false))
  }
}
