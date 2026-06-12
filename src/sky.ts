import * as THREE from 'three'

const vertexShader = /* glsl */ `
varying vec3 vDir;

void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const fragmentShader = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uHorizonColor;
uniform vec3 uZenithColor;
varying vec3 vDir;

void main() {
  vec3 dir = normalize(vDir);
  float h = clamp(dir.y, 0.0, 1.0);
  vec3 col = mix(uHorizonColor, uZenithColor, pow(h, 0.6));

  float sunAmount = max(dot(dir, uSunDir), 0.0);
  vec3 sunColor = vec3(1.0, 0.9, 0.75);
  col += sunColor * pow(sunAmount, 800.0) * 1.2; // disc
  col += sunColor * pow(sunAmount, 12.0) * 0.25; // glow

  gl_FragColor = vec4(col, 1.0);
}
`

/**
 * Camera-following gradient dome with a sun disc. Owns the sun direction and
 * horizon color — the ocean material and the scene's directional light share
 * these objects by reference, so GUI changes propagate automatically.
 */
export class Sky {
  readonly mesh: THREE.Mesh
  private readonly material: THREE.ShaderMaterial

  constructor() {

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uSunDir: { value: new THREE.Vector3() },
        uHorizonColor: { value: new THREE.Color(0xe6cfa3) },
        uZenithColor: { value: new THREE.Color(0x7fa6bf) },
      },
      side: THREE.BackSide,
      depthWrite: false,
    })

    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), this.material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = -1
  }

  get sunDir(): THREE.Vector3 {
    return this.material.uniforms.uSunDir.value
  }

  get horizonColor(): THREE.Color {
    return this.material.uniforms.uHorizonColor.value
  }

  setSun(azimuth: number, elevation: number) {
    this.sunDir.set(
      Math.sin(azimuth) * Math.cos(elevation),
      Math.sin(elevation),
      Math.cos(azimuth) * Math.cos(elevation),
    )
  }

  /** Keep the dome centred on the camera so it never has a visible edge. */
  update(camera: THREE.Camera) {
    this.mesh.position.copy(camera.position)
  }
}
