import * as THREE from 'three'

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0xa6c7d9)

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000)
camera.position.set(0, 2, 6)
camera.lookAt(0, 0, 0)

const box = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: 0xff7043 }),
)
scene.add(box)

const sun = new THREE.DirectionalLight(0xffffff, 2)
sun.position.set(3, 5, 2)
scene.add(sun)

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

renderer.setAnimationLoop((time) => {
  box.rotation.y = time / 1000
  renderer.render(scene, camera)
})
