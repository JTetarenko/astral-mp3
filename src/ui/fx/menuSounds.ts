/**
 * Ambient interactivity for the menu chrome.
 *
 * - First-gesture bootstrap: autoplay policy means no AudioContext exists
 *   until a user gesture, so the chant drone requested on the select screen
 *   sits pending. The first pointerdown anywhere creates the context, syncs
 *   volume and kicks the kit load — loadSfxKit() then starts the pending
 *   drone itself (droneWanted flag in sfx.ts).
 * - Delegated bone-click ticks: hover + click on every interactive menu
 *   element, so individual screens never wire sounds by hand.
 */
import { ensureContext } from '../../audio/audioEngine'
import { loadSfxKit, setSfxVolume, sfxUiClick, sfxUiHover } from '../../audio/sfx'
import { useGameStore } from '../../game/state'

const INTERACTIVE = '.btn, .track-row, .toggle-label, .hub-tab, .item-tile, .attr-plus'
const HOVER_MIN_GAP_MS = 70

export function installMenuSounds(): () => void {
  let lastHover = 0

  const bootstrap = () => {
    ensureContext()
    setSfxVolume(useGameStore.getState().settings.sfxVolume)
    void loadSfxKit()
  }

  const onPointerOver = (e: PointerEvent) => {
    const el = e.target as Element | null
    if (!el?.closest?.(INTERACTIVE)) return
    const now = performance.now()
    if (now - lastHover < HOVER_MIN_GAP_MS) return
    lastHover = now
    sfxUiHover()
  }

  const onClick = (e: MouseEvent) => {
    const el = e.target as Element | null
    if (!el?.closest?.(INTERACTIVE)) return
    sfxUiClick()
  }

  document.addEventListener('pointerdown', bootstrap, { once: true, capture: true })
  document.addEventListener('pointerover', onPointerOver, true)
  document.addEventListener('click', onClick, true)
  return () => {
    document.removeEventListener('pointerdown', bootstrap, true)
    document.removeEventListener('pointerover', onPointerOver, true)
    document.removeEventListener('click', onClick, true)
  }
}
