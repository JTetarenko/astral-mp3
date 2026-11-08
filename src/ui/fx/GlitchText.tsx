import { useEffect, useState } from 'react'
import { useGameStore } from '../../game/state'
import { randomRuneChar } from './menuGlyphs'

interface GlitchTextProps {
  text: string
  className?: string
  as?: 'span' | 'div' | 'h1' | 'h2' | 'h3'
  /** Occasional single-character rune corruption (disable for long body copy). */
  scramble?: boolean
}

/**
 * Headline that reads like a transmission from the deep: CSS pseudo-elements
 * carry RGB-split slice glitches (see `.glitch-text` — intensified while the
 * app root holds `.glitch-now`), and every few seconds a character or two
 * briefly corrupts into a rune before snapping back.
 * Fully inert under reduced motion.
 */
export function GlitchText({ text, className, as: Tag = 'span', scramble = true }: GlitchTextProps) {
  const reducedMotion = useGameStore(s => s.settings.reducedMotion)
  const [display, setDisplay] = useState(text)

  useEffect(() => {
    setDisplay(text)
  }, [text])

  useEffect(() => {
    if (reducedMotion || !scramble || text.length === 0) return
    let alive = true
    let corruptTimer = 0
    let restoreTimer = 0
    const schedule = () => {
      corruptTimer = window.setTimeout(
        () => {
          if (!alive) return
          const chars = text.split('')
          const hits = 1 + ((Math.random() * 2) | 0)
          for (let i = 0; i < hits; i++) {
            const idx = (Math.random() * chars.length) | 0
            if (chars[idx] !== ' ') chars[idx] = randomRuneChar()
          }
          setDisplay(chars.join(''))
          restoreTimer = window.setTimeout(
            () => {
              if (!alive) return
              setDisplay(text)
              schedule()
            },
            80 + Math.random() * 110,
          )
        },
        2600 + Math.random() * 6500,
      )
    }
    schedule()
    return () => {
      alive = false
      clearTimeout(corruptTimer)
      clearTimeout(restoreTimer)
      setDisplay(text)
    }
  }, [text, scramble, reducedMotion])

  return (
    <Tag className={`glitch-text${className ? ` ${className}` : ''}`} data-text={display}>
      {display}
    </Tag>
  )
}
