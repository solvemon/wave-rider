import GUI from 'lil-gui'
import type { WaveParams } from './waves'
import type { VesselTuning } from './vessel'
import type { CameraTuning } from './camera'
import type { WakeTuning } from './wake'
import type { SplashTuning } from './splash'
import type { RagdollTuning } from './ragdoll'
import type { ScoreTuning } from './score'
import type { VesselMeshTuning } from './vessel'
import type { NitroTuning } from './nitro'
import type { AudioTuning } from './audio'

export interface TuningTargets {
  waves: WaveParams[]
  onWavesChanged: () => void
  vessel: VesselTuning
  camera: CameraTuning
  sun: { azimuth: number; elevation: number }
  onSunChanged: () => void
  oceanFoam: { threshold: number; intensity: number }
  oceanRipple: { strength: number }
  wake: WakeTuning
  splash: SplashTuning
  ragdoll: RagdollTuning
  score: ScoreTuning
  scoreFx: { shake: number }
  vesselMesh: VesselMeshTuning
  onVesselMeshChanged: () => void
  nitro: NitroTuning
  audio: AudioTuning
}

/** Builds the live tuning panel. Press H to show/hide. */
export function createTuningPanel(targets: TuningTargets): GUI {

  const gui = new GUI({ title: 'Waverider tuning (H to hide)' })

  const wavesFolder = gui.addFolder('Waves')
  targets.waves.forEach((w, i) => {
    const f = wavesFolder.addFolder(i < 2 ? `Swell ${i + 1}` : `Chop ${i - 1}`)
    f.add(w, 'amplitude', 0, 3, 0.01).onChange(targets.onWavesChanged)
    f.add(w, 'wavelength', 2, 120, 0.5).onChange(targets.onWavesChanged)
    f.add(w, 'steepness', 0, 1, 0.01).onChange(targets.onWavesChanged)
    f.add(w, 'speed', 0, 15, 0.1).onChange(targets.onWavesChanged)
    f.add(w, 'direction', -Math.PI, Math.PI, 0.01).onChange(targets.onWavesChanged)
    if (i > 1) {
      f.close()
    }
  })

  const v = targets.vessel
  const physics = gui.addFolder('Physics')
  physics.add(v, 'gravity', 4, 40, 0.5)
  physics.add(v, 'buoyancySpring', 10, 150, 1)
  physics.add(v, 'buoyancyDamping', 0, 20, 0.1)
  physics.add(v, 'thrust', 2, 40, 0.5)
  physics.add(v, 'reverseThrust', 0, 20, 0.5)
  physics.add(v, 'waterDrag', 0.05, 2, 0.01)
  physics.add(v, 'planingLift', 0, 1.5, 0.01)
  physics.add(v, 'lateralGrip', 0.2, 10, 0.1)
  physics.add(v, 'turnRate', 0.3, 4, 0.05)
  physics.add(v, 'steerIdleAuthority', 0, 1, 0.01)
  physics.add(v, 'bankFactor', 0, 1, 0.01)
  physics.add(v, 'orientSpring', 2, 40, 0.5)
  physics.add(v, 'orientDamping', 0, 20, 0.1)

  const air = gui.addFolder('Air')
  air.add(v, 'airGravity', 2, 30, 0.5)
  air.add(v, 'airPitchAuthority', 0, 1, 0.01)
  air.add(v, 'rollRate', 1, 10, 0.1)
  air.add(v, 'autoLevelSpring', 0, 30, 0.5)
  air.add(v, 'autoLevelDamping', 0, 15, 0.1)
  air.add(v, 'landingAbsorb', 0, 1, 0.01)
  air.add(v, 'speedKeptOnLanding', 0.5, 1, 0.01)

  const c = targets.camera
  const cam = gui.addFolder('Camera')
  cam.add(c, 'distance', 4, 20, 0.5)
  cam.add(c, 'height', 1, 10, 0.25)
  cam.add(c, 'posLag', 0.5, 10, 0.1)
  cam.add(c, 'lookLag', 0.5, 12, 0.1)
  cam.add(c, 'fovBase', 40, 90, 1)
  cam.add(c, 'fovSpeedFactor', 0, 2, 0.05)
  cam.add(c, 'airPullback', 0, 6, 0.25)

  const visuals = gui.addFolder('Visuals')
  visuals.add(targets.sun, 'azimuth', -Math.PI, Math.PI, 0.01).onChange(targets.onSunChanged)
  visuals.add(targets.sun, 'elevation', 0.03, 1.2, 0.01).onChange(targets.onSunChanged)
  visuals.add(targets.oceanFoam, 'threshold', 0, 1, 0.01).name('foamThreshold')
  visuals.add(targets.oceanFoam, 'intensity', 0, 1.5, 0.01).name('foamIntensity')
  visuals.add(targets.oceanRipple, 'strength', 0, 1, 0.01).name('rippleStrength')
  visuals.add(targets.wake, 'width', 0.5, 6, 0.1).name('wakeWidth')
  visuals.add(targets.wake, 'lifetime', 0.5, 6, 0.1).name('wakeLifetime')
  visuals.add(targets.splash, 'sprayRate', 0, 3, 0.05)
  visuals.add(targets.splash, 'splashIntensity', 0, 3, 0.05)

  const rag = gui.addFolder('Ragdoll')
  rag.add(targets.ragdoll, 'gravity', 4, 30, 0.5)
  rag.add(targets.ragdoll, 'damping', 0.9, 0.999, 0.001)
  rag.add(targets.ragdoll, 'waterDrag', 0, 15, 0.25)
  rag.add(targets.ragdoll, 'mountX', 0.05, 0.8, 0.01)
  rag.add(targets.ragdoll, 'mountY', 0.2, 2, 0.01)
  rag.add(targets.ragdoll, 'mountZ', -2, 2, 0.01)

  const vesselMesh = gui.addFolder('Vessel')
  vesselMesh.add(targets.vesselMesh, 'scale', 0.5, 2, 0.01).onChange(targets.onVesselMeshChanged)
  vesselMesh.add(targets.vesselMesh, 'offsetY', -0.5, 1.5, 0.01).onChange(targets.onVesselMeshChanged)
  vesselMesh.add(targets.vesselMesh, 'rotY', -Math.PI, Math.PI, 0.01).onChange(targets.onVesselMeshChanged)

  const scoreFolder = gui.addFolder('Score')
  scoreFolder.add(targets.score, 'airRate', 5, 100, 1)
  scoreFolder.add(targets.score, 'airBigBonus', 0, 150, 1)
  scoreFolder.add(targets.score, 'smackThreshold', 1, 8, 0.1)
  scoreFolder.add(targets.score, 'megaThreshold', 3, 15, 0.1)
  scoreFolder.add(targets.scoreFx, 'shake', 0, 0.2, 0.005).name('shakeScale')
  scoreFolder.add(targets.score, 'bigThreshold', 50, 500, 5)
  scoreFolder.add(targets.score, 'rollPoints', 50, 500, 10)

  const nitroFolder = gui.addFolder('Nitro')
  nitroFolder.add(targets.nitro, 'pointsToFull', 200, 2000, 10)
  nitroFolder.add(targets.nitro, 'drainTime', 1, 6, 0.1)
  nitroFolder.add(targets.vessel, 'boostThrust', 10, 60, 1)

  const audioFolder = gui.addFolder('Audio')
  audioFolder.add(targets.audio, 'master', 0, 1, 0.01)
  audioFolder.add(targets.audio, 'engine', 0, 1, 0.01)
  audioFolder.add(targets.audio, 'music', 0, 1, 0.01)

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyH') {
      gui.show(gui._hidden)
    }
  })

  return gui
}
