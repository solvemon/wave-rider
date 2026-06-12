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
