import * as THREE from 'three'
import { defaultWaves, surfaceHeight } from './waves'
import { Ocean } from './ocean'
import { Vessel, KeyboardInput, createVesselMesh, syncVesselMesh } from './vessel'
import { ChaseCamera } from './camera'
import { Sky } from './sky'
import { Wake } from './wake'
import { Splash } from './splash'
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

const chase = new ChaseCamera(camera)
const input = new KeyboardInput()
input.attach()

createTuningPanel({
  waves,
  onWavesChanged: () => ocean.updateWaves(waves),
  vessel: vessel.tuning,
  camera: chase.tuning,
})

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

function frame(now: number) {

  const dt = Math.min((now - last) / 1000, 0.1)
  last = now
  accumulator += dt

  while (accumulator >= STEP) {
    simTime += STEP
    vessel.update(STEP, input.state, sampler)
    pendingLanding = Math.max(pendingLanding, vessel.justLanded)
    pendingTakeoff = pendingTakeoff || vessel.justTookOff
    accumulator -= STEP
  }

  syncVesselMesh(vessel, vesselMesh)
  ocean.update(simTime, vessel.position)
  wake.update(dt, simTime, vessel, sampler)
  splash.update(dt, vessel, pendingLanding, pendingTakeoff)
  pendingLanding = 0
  pendingTakeoff = false
  chase.update(dt, vessel)
  sky.update(camera)
  renderer.render(scene, camera)
  requestAnimationFrame(frame)
}

requestAnimationFrame(frame)
