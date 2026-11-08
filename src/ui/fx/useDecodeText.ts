import { useEffect, useState } from 'react'
import { useGameStore } from '../../game/state'
import { randomRuneChar } from './menuGlyphs'

function scrambleAt(target: string, t: number): string {
  const frontier = Math.floor(t * target.length)
  let out = ''
  for (let i = 0; i < target.length; i++) {
    const ch = target[i]
    out += ch === ' ' || i < frontier ? ch : randomRuneChar()
  }
  return out
}

/**
 * Decode-in effect: whenever `target` changes it first appears as runes and
 * resolves left-to-right into the real text (the loading stages "translate"
 * themselves). Reduced motion returns the target immediately.
 */
export function useDecodeText(target: string, stepMs = 26): string {
  const reducedMotion = useGameStore(s => s.settings.reducedMotion)
  const [out, setOut] = useState(target)

  useEffect(() => {
    if (reducedMotion || target.length === 0) {
      setOut(target)
      return
    }
    const steps = Math.max(6, Math.ceil(target.length * 1.4))
    let frame = 0
    setOut(scrambleAt(target, 0))
    const id = window.setInterval(() => {
      frame++
      if (frame >= steps) {
        setOut(target)
        clearInterval(id)
        return
      }
      setOut(scrambleAt(target, frame / steps))
    }, stepMs)
    return () => clearInterval(id)
  }, [target, stepMs, reducedMotion])

  return out
}
