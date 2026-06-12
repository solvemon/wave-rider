import GUI from 'lil-gui'
import type { WaveParams } from './waves'
import type { VesselTuning } from './vessel'
import type { CameraTuning } from './camera'

export interface TuningTargets {
  waves: WaveParams[]
  onWavesChanged: () => void
  vessel: VesselTuning
  camera: CameraTuning
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

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyH') {
      gui.show(gui._hidden)
    }
  })

  return gui
}
