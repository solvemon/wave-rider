# Waverider — Touch Controls Design

Date: 2026-06-12
Status: Approved (user-specified)

## 1. Concept

On-screen controls for touch devices, additive to keyboard: throttle,
boost, steer, roll. Desktop play is unchanged (controls only appear on
coarse-pointer devices).

## 2. Layout (two-thumb arcade)

- **Left cluster:** steer ◀ ▶ (two 72 px circles, bottom-left); roll
  ↺ ↻ (two 56 px circles above them — in the air the left thumb slides
  up from steer to roll, mirroring when each is useful).
- **Right cluster:** GAS (96 px, bottom-right) with BOOST (64 px,
  orange) above it.
- Semi-transparent circles, large hit areas, no tap highlight; active
  state brightens. Nitro bar moves up (bottom 120 px) on touch devices
  so the steer buttons don't cover it.

## 3. Implementation (`src/touch.ts`, new)

- `TouchControls` builds fixed-position DOM buttons; per-button Pointer
  Events (down/up/cancel + pointer capture) maintain a state object
  `{ throttle, steer, roll, boost }` — multi-touch safe.
- `TouchControls.isTouchDevice()` = `matchMedia('(pointer: coarse)')`.
- Main merges keyboard + touch per fixed step (sum, clamp ±1) into the
  existing gated input. Nothing downstream changes.

## 4. Mobile fixes that ride along

- **Audio gesture:** AudioContext currently starts on keydown only —
  mobile has no keyboard. `attach()` also arms pointerdown, with an
  idempotent init guard.
- Tuning panel auto-hides on touch devices (it covers a phone screen).
- `touch-action: none` + no user-select on the page so gestures don't
  scroll/zoom.

## 5. Testing

Input merge covered by existing physics tests (same gated input path).
Touch DOM verified headless via Puppeteer touchscreen emulation: GAS
press → vessel accelerates; buttons absent on fine-pointer desktops.
