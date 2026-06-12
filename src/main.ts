import * as THREE from 'three'
import { defaultWaves, surfaceHeight } from './waves'
import { Ocean } from './ocean'
import { Vessel, KeyboardInput, createVesselMesh, syncVesselMesh, vesselMeshTuning, applyVesselMeshTuning } from './vessel'
import { ChaseCamera } from './camera'
import { Sky } from './sky'
import { Wake } from './wake'
import { Splash } from './splash'
import { Ragdoll } from './ragdoll'
import { ScoreState, ScoreOverlay } from './score'
import { NitroState, NitroFire, NitroBar } from './nitro'
import { AudioSystem } from './audio'
import { TouchControls } from './touch'
import { createTuningPanel } from './tuning'

const STEP = 1 / 60

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0xa6c7d9)

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000)

const sky = new Sky()
scene.add(sky.mesh)

const sun = new THREE.DirectionalLight(0xfff2dd, 2.2)
scene.add(sun)
scene.add(new THREE.HemisphereLight(0xbcd8e6, 0x1a3a4a, 0.9))

const sunState = { azimuth: 0.6, elevation: 0.18 }
const applySun = () => {
  sky.setSun(sunState.azimuth, sunState.elevation)
  sun.position.copy(sky.sunDir).multiplyScalar(100)
}
applySun()

const waves = defaultWaves.map((w) => ({ ...w }))
const ocean = new Ocean(waves, sky.sunDir, sky.horizonColor)
scene.add(ocean.mesh)

const vessel = new Vessel()
const vesselMesh = createVesselMesh()
scene.add(vesselMesh)

const wake = new Wake()
scene.add(wake.mesh)

const splash = new Splash()
scene.add(splash.points)

const ragdoll = new Ragdoll()
scene.add(ragdoll.group)

const score = new ScoreState()
const BEST_BONUS_KEY = 'waverider-best-bonus'
try {
  const stored = localStorage.getItem(BEST_BONUS_KEY)
  if (stored !== null) {
    score.bestBonus = JSON.parse(stored)
  }
} catch {
  // private-mode/quota quirks — best-bonus persistence is a nicety, not a need
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyR') {
    ragdoll.reset(vessel)
    score.suppressSmacks(2) // settling into pose must not pay out
  }
})
const overlay = new ScoreOverlay(document.body)
const scoreFx = { shake: 0.1 }

const nitro = new NitroState()
const nitroFire = new NitroFire()
scene.add(nitroFire.points)
const touch = TouchControls.isTouchDevice() ? new TouchControls(document.body) : null
const nitroBar = new NitroBar(document.body, touch !== null ? 192 : 16)
// the input's raw boost flag is gated through nitro.tick each physics step
const gatedInput = { throttle: 0, steer: 0, boost: false, roll: 0 }

const audio = new AudioSystem()
audio.attach()
score.onBonus = (b) => audio.bonus(b)

const chase = new ChaseCamera(camera)
if (TouchControls.isTouchDevice()) {
  // portrait screens show a narrow horizontal slice — pull the camera in so
  // the jetski and the flailing rider stay readable on a phone
  Object.assign(chase.tuning, { distance: 7.5, height: 3.4, fovBase: 58, fovSpeedFactor: 0.4, airPullback: 1.5 })
}
const input = new KeyboardInput()

if (import.meta.env.DEV) {
  // dev-server-only handle for headless verification harnesses
  ;(window as unknown as Record<string, unknown>).__waverider = { vessel, input, score, nitro, gatedInput }
}
input.attach()

const gui = createTuningPanel({
  waves,
  onWavesChanged: () => ocean.updateWaves(waves),
  vessel: vessel.tuning,
  camera: chase.tuning,
  sun: sunState,
  onSunChanged: applySun,
  oceanFoam: ocean.foam,
  oceanRipple: ocean.ripple,
  wake: wake.tuning,
  splash: splash.tuning,
  ragdoll: ragdoll.tuning,
  score: score.tuning,
  scoreFx,
  vesselMesh: vesselMeshTuning,
  onVesselMeshChanged: applyVesselMeshTuning,
  nitro: nitro.tuning,
  audio: audio.tuning,
})
gui.close() // start collapsed — H or the title bar opens it
if (touch !== null) {
  gui.hide() // the panel covers a phone screen; tuning is a desktop activity
} else {
  const help = document.createElement('div')
  help.style.cssText =
    'position:fixed;bottom:14px;left:50%;transform:translateX(-50%);font:600 13px/1.5 ui-monospace,monospace;' +
    'color:rgba(255,255,255,.75);text-shadow:0 1px 0 rgba(0,0,0,.5);z-index:10;pointer-events:none;' +
    'text-align:center;letter-spacing:.5px;'
  help.innerHTML = 'W/S throttle &nbsp;·&nbsp; A/D steer &nbsp;·&nbsp; Q/E barrel roll &nbsp;·&nbsp; SPACE nitro &nbsp;·&nbsp; R reset rider &nbsp;·&nbsp; H tuning panel'
  document.body.appendChild(help)
}

ragdoll.reset(vessel)

let simTime = 0
const sampler = (x: number, z: number) => surfaceHeight(waves, x, z, simTime)

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

let last = performance.now()
let accumulator = 0
// Landing/takeoff events are per-physics-step; accumulate them across the
// fixed steps of a frame so a multi-step frame can't drop one.
let pendingLanding = 0
let pendingTakeoff = false
let pendingImpactForce = 0
const lastImpactPoint = new THREE.Vector3()
const popupWorld = new THREE.Vector3()
const popupProjected = new THREE.Vector3()

function frame(now: number) {

  const dt = Math.min((now - last) / 1000, 0.1)
  last = now
  accumulator += dt

  let frameBoosting = false

  while (accumulator >= STEP) {
    simTime += STEP
    // boost implies full throttle — one button does both, no gas-juggling
    const boostWanted = input.state.boost === true || touch?.state.boost === true
    gatedInput.throttle = THREE.MathUtils.clamp(
      input.state.throttle + (touch?.state.throttle ?? 0) + (boostWanted ? 1 : 0),
      -1,
      1,
    )
    gatedInput.steer = THREE.MathUtils.clamp(input.state.steer + (touch?.state.steer ?? 0), -1, 1)
    gatedInput.roll = THREE.MathUtils.clamp((input.state.roll ?? 0) + (touch?.state.roll ?? 0), -1, 1)
    gatedInput.boost = nitro.tick(STEP, boostWanted)
    frameBoosting = frameBoosting || gatedInput.boost
    vessel.update(STEP, gatedInput, sampler)
    ragdoll.update(STEP, vessel, sampler, splash)
    pendingLanding = Math.max(pendingLanding, vessel.justLanded)
    pendingTakeoff = pendingTakeoff || vessel.justTookOff
    const headSubmerged = ragdoll.headPos.y < sampler(ragdoll.headPos.x, ragdoll.headPos.z)
    score.tick(STEP, vessel.airborne, headSubmerged)
    if (vessel.justLanded > 0) {
      score.landed()
    }
    if (vessel.justBarrelRolled) {
      score.barrelRoll()
    }
    if (ragdoll.deckImpact) {
      score.deckImpact(ragdoll.deckImpact.force, ragdoll.deckImpact.head)
      if (ragdoll.deckImpact.force > pendingImpactForce) {
        pendingImpactForce = ragdoll.deckImpact.force
        lastImpactPoint.copy(ragdoll.deckImpact.point)
      }
    }
    accumulator -= STEP
  }

  syncVesselMesh(vessel, vesselMesh)
  ocean.update(simTime, vessel.position)
  wake.update(dt, simTime, vessel, sampler)
  splash.update(dt, vessel, pendingLanding, pendingTakeoff)
  nitroFire.update(dt, vessel, frameBoosting)
  nitroBar.set(nitro.charge)
  if (pendingLanding > 0) {
    audio.landed(pendingLanding)
  }
  if (pendingTakeoff) {
    audio.tookOff()
  }
  audio.update(dt, vessel, frameBoosting, Math.max(gatedInput.throttle, 0))
  pendingLanding = 0
  pendingTakeoff = false
  chase.update(dt, vessel)
  sky.update(camera)
  renderer.render(scene, camera)

  if (pendingImpactForce >= score.tuning.smackThreshold && !score.smacksSuppressed) {
    splash.burst(lastImpactPoint, Math.min(Math.round(pendingImpactForce * 4), 40), Math.min(pendingImpactForce, 6))
    chase.shake(Math.min(pendingImpactForce * scoreFx.shake, 0.5))
  }
  pendingImpactForce = 0

  for (const bonus of score.drain()) {
    if (bonus.big) {
      nitro.addBonus(bonus.points)
    }
    if (bonus === score.bestBonus) {
      try {
        localStorage.setItem(BEST_BONUS_KEY, JSON.stringify(bonus))
      } catch {
        // ignore storage failures
      }
    }
    if (bonus.kind === 'snorkel') {
      popupWorld.copy(ragdoll.headPos)
    } else if (bonus.kind === 'airtime' || bonus.kind === 'barrelRoll') {
      popupWorld.copy(vessel.position)
    } else {
      popupWorld.copy(lastImpactPoint)
    }
    popupWorld.y += 1
    popupProjected.copy(popupWorld).project(camera)
    overlay.popup(
      `${bonus.name} +${bonus.points}`,
      (popupProjected.x * 0.5 + 0.5) * window.innerWidth,
      (-popupProjected.y * 0.5 + 0.5) * window.innerHeight,
      bonus.big,
    )
  }
  overlay.setTotal(score.total)
  overlay.setBest(score.bestBonus)

  requestAnimationFrame(frame)
}

requestAnimationFrame(frame)
