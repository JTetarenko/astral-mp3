import { useFrame } from '@react-three/fiber'
import { spawnPointsIfNeeded, streamWorld, updateGate } from '../game/worldState'
import { snapController } from './snapController'

/**
 * Drives the endless world from the frame loop at priority -85: after the
 * audio bus (-100) and visual tuning (-90), before every scene component (0).
 * Reads the player transform from the snapController (previous frame's — the
 * 24u stream threshold makes that irrelevant).
 */
export function WorldStreamer() {
  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.1)
    const t = clock.elapsedTime
    const pos = snapController.pos
    const fwd = snapController.forward
    streamWorld(pos.x, pos.z, t)
    spawnPointsIfNeeded(pos.x, pos.y, pos.z, fwd.x, fwd.z, t)
    updateGate(dt, pos.x, pos.y, pos.z, fwd.x, fwd.z, t)
  }, -85)
  return null
}
