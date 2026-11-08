import { useFrame, useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import type { PerspectiveCamera } from 'three'
import { useGameStore } from '../game/state'
import { requestLock, snapController } from './snapController'

const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight']

/** Binds pointer-lock + input to the snapController and drives it every frame. */
export function PlayerRig() {
  const gl = useThree(s => s.gl)
  const camera = useThree(s => s.camera) as PerspectiveCamera

  useEffect(() => {
    const canvas = gl.domElement
    snapController.canvasEl = canvas
    snapController.sensitivity = useGameStore.getState().settings.sensitivity
    snapController.viewMode = useGameStore.getState().settings.viewMode

    const onMouseMove = (e: MouseEvent) => {
      if (snapController.pointerLocked) snapController.onMouseMove(e.movementX, e.movementY)
    }
    const onMouseDown = (e: MouseEvent) => {
      const st = useGameStore.getState()
      if (st.screen !== 'play' || !st.started || st.paused) return
      if (e.button === 0) {
        if (!snapController.pointerLocked) {
          requestLock(canvas)
          return
        }
        snapController.queueSnap()
      } else if (e.button === 2 && snapController.pointerLocked) {
        // RMB begins a cast: tap = quick bolt, hold = bowstring draw. The
        // buffered edge lets a click mid-pull start the windup on landing.
        snapController.castHeld = true
        snapController.queueCast()
      }
    }
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 2) snapController.castHeld = false
    }
    const onContextMenu = (e: Event) => {
      // Firefox fires contextmenu even under pointer lock — RMB is a weapon
      if (snapController.pointerLocked) e.preventDefault()
    }
    let lastWTap = -9
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'KeyV' && !e.repeat) {
        const st = useGameStore.getState()
        if (st.screen === 'play') {
          st.setSettings({ viewMode: st.settings.viewMode === 'third' ? 'first' : 'third' })
        }
        return
      }
      // combat intents — the KeyV pattern: flag now, snapController consumes
      if (e.code === 'KeyE' && !e.repeat) {
        const st = useGameStore.getState()
        if (st.screen === 'play' && st.started && !st.paused) snapController.queueNova()
        return
      }
      if ((e.code === 'Digit1' || e.code === 'Digit2') && !e.repeat) {
        const st = useGameStore.getState()
        if (st.screen === 'play' && st.started && !st.paused) {
          snapController.consumableQueued = e.code === 'Digit1' ? 0 : 1
        }
        return
      }
      if (!MOVE_KEYS.includes(e.code)) return
      e.preventDefault()
      // double-tap W and hold -> sprint (released with the key)
      if (e.code === 'KeyW' && !e.repeat) {
        const now = performance.now() / 1000
        if (now - lastWTap < 0.28) snapController.sprintHeld = true
        lastWTap = now
      }
      snapController.keys.add(e.code)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (!MOVE_KEYS.includes(e.code)) return
      if (e.code === 'KeyW') snapController.sprintHeld = false
      snapController.keys.delete(e.code)
    }
    const onLockChange = () => {
      const locked = document.pointerLockElement === canvas
      snapController.pointerLocked = locked
      const st = useGameStore.getState()
      // Esc released the lock mid-run -> pause (covers Chrome's ~1.3s re-lock cooldown)
      if (!locked && st.screen === 'play' && st.started && !st.paused) st.setPaused(true)
    }
    const onLockError = () => {
      snapController.pointerLocked = false
    }
    const onBlur = () => {
      snapController.keys.clear()
      snapController.sprintHeld = false
      snapController.castHeld = false
    }
    const onVisibility = () => {
      if (document.hidden) {
        const st = useGameStore.getState()
        if (st.screen === 'play' && st.started && !st.paused) st.setPaused(true)
      }
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('mouseup', onMouseUp)
    document.addEventListener('contextmenu', onContextMenu)
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('keyup', onKeyUp)
    document.addEventListener('pointerlockchange', onLockChange)
    document.addEventListener('pointerlockerror', onLockError)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('mouseup', onMouseUp)
      document.removeEventListener('contextmenu', onContextMenu)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('keyup', onKeyUp)
      document.removeEventListener('pointerlockchange', onLockChange)
      document.removeEventListener('pointerlockerror', onLockError)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', onBlur)
      snapController.canvasEl = null
    }
  }, [gl])

  useFrame(({ clock }, rawDt) => {
    const st = useGameStore.getState()
    if (st.screen !== 'play' || st.paused) return
    const dt = Math.min(rawDt, 0.1)
    snapController.update(dt, clock.elapsedTime, camera)
  })

  return null
}
