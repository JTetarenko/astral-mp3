import { useFrame } from '@react-three/fiber'
import { Matrix4 } from 'three'
import { hudProjection } from './hudProjection'

const viewProj = new Matrix4()

/**
 * Copies the camera's view-projection matrix + viewport into hudProjection
 * each frame for the DOM combat UI. Mounted AFTER PlayerRig so it sees this
 * frame's post-snapController camera. Priority MUST stay 0 — any positive
 * priority flips R3F into manual-render mode and blanks the scene.
 */
export function HudBridge() {
  useFrame(({ camera, size }) => {
    camera.updateMatrixWorld()
    viewProj.copy(camera.projectionMatrix).multiply(camera.matrixWorldInverse)
    const e = viewProj.elements
    for (let i = 0; i < 16; i++) hudProjection.m[i] = e[i]
    hudProjection.vw = size.width
    hudProjection.vh = size.height
    hudProjection.gen++
  }, 0)
  return null
}
