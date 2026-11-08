import { useEffect, useMemo, useRef } from 'react'
import { useGameStore } from '../../game/state'

/** Runic inscription orbiting the big sigil ring (spaces = engraving gaps). */
const RING_TEXT = 'ᚠ ᚢ ᚦ ᚨ ᚱ ᚲ ᚷ ᚹ ᚺ ᚾ ᛁ ᛃ ᛇ ᛈ ᛉ ᛊ ᛏ ᛒ ᛖ ᛗ ᛚ ᛜ ᛞ ᛟ '

interface Mote {
  x: number
  y: number
  r: number
  v: number
  sway: number
  swayAmp: number
  tw: number
  color: string
}

/**
 * Drifting ember/spore canvas. Additive-blended dots rising through the
 * menu with a faint halo. First frame is drawn synchronously so a parked
 * rAF (hidden pane / headless) still shows the field.
 */
function Motes() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const reducedMotion = useGameStore(s => s.settings.reducedMotion)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const css = getComputedStyle(document.documentElement)
    const colors = ['--primary', '--hud-glow', '--hud-accent']
      .map(v => css.getPropertyValue(v).trim())
      .filter(Boolean)
    if (colors.length === 0) colors.push('#ffb066')

    let w = 0
    let h = 0
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = Math.max(1, Math.round(w * dpr))
      canvas.height = Math.max(1, Math.round(h * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()

    const spawn = (anywhere: boolean): Mote => ({
      x: Math.random() * w,
      y: anywhere ? Math.random() * h : h + 10,
      r: 0.6 + Math.random() * 1.7,
      v: 6 + Math.random() * 15,
      sway: Math.random() * Math.PI * 2,
      swayAmp: 4 + Math.random() * 16,
      tw: Math.random() * Math.PI * 2,
      color: colors[(Math.random() * colors.length) | 0],
    })
    const motes: Mote[] = Array.from({ length: 46 }, () => spawn(true))
    const speed = reducedMotion ? 0.45 : 1

    let raf = 0
    let last = performance.now()
    const render = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      ctx.clearRect(0, 0, w, h)
      ctx.globalCompositeOperation = 'lighter'
      for (const m of motes) {
        m.y -= m.v * speed * dt
        m.sway += dt * 0.6
        m.tw += dt * (reducedMotion ? 0.7 : 2.1)
        if (m.y < -12) Object.assign(m, spawn(false))
        const x = m.x + Math.sin(m.sway) * m.swayAmp
        const a = 0.2 + 0.34 * (0.5 + 0.5 * Math.sin(m.tw))
        ctx.fillStyle = m.color
        ctx.globalAlpha = a
        ctx.beginPath()
        ctx.arc(x, m.y, m.r, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalAlpha = a * 0.22
        ctx.beginPath()
        ctx.arc(x, m.y, m.r * 3.2, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    const loop = (now: number) => {
      render(now)
      raf = requestAnimationFrame(loop)
    }
    loop(last)
    // The pane can mount hidden (0-ish layout) or resize later — a window
    // 'resize' event never fires for either, so observe the element itself.
    // Re-render immediately so a parked rAF still leaves a fresh still frame.
    const ro = new ResizeObserver(() => {
      const pw = w
      const ph = h
      resize()
      if (pw < 4 || ph < 4) {
        for (const m of motes) Object.assign(m, spawn(true))
      } else if (w !== pw || h !== ph) {
        for (const m of motes) {
          m.x *= w / pw
          m.y *= h / ph
        }
      }
      render(performance.now())
    })
    ro.observe(canvas)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [reducedMotion])

  return <canvas ref={canvasRef} className="fx-motes" />
}

/** Huge slow counter-rotating ritual ring — geometry plus a runic inscription. */
export function SigilRing() {
  const ticks = useMemo(() => Array.from({ length: 36 }, (_, i) => i * 10), [])
  return (
    <div className="sigil-ring">
      <svg viewBox="0 0 400 400">
        <defs>
          <path
            id="sigil-text-path"
            d="M 200 34 A 166 166 0 1 1 199.99 34"
            fill="none"
          />
        </defs>
        <g className="ring-a">
          <circle cx="200" cy="200" r="197" className="ring-line ring-dash-fine" />
          <text className="ring-runes-text">
            <textPath href="#sigil-text-path">{RING_TEXT}</textPath>
          </text>
          <circle cx="200" cy="200" r="140" className="ring-line ring-dash-wide" />
        </g>
        <g className="ring-b">
          <circle cx="200" cy="200" r="152" className="ring-line" opacity="0.5" />
          {ticks.map(a => (
            <line
              key={a}
              x1="200"
              y1="44"
              x2="200"
              y2={a % 30 === 0 ? '58' : '51'}
              className="ring-line"
              transform={`rotate(${a} 200 200)`}
            />
          ))}
          {[0, 120, 240].map(a => (
            <polygon
              key={a}
              points="200,116 194,128 206,128"
              className="ring-sigil"
              transform={`rotate(${a} 200 200)`}
            />
          ))}
        </g>
      </svg>
    </div>
  )
}

/**
 * Periodic "signal corruption" sweep: stamps `.glitch-now` on the app root
 * for ~150–320ms every 5–14s so every glitch element (headlines, panels,
 * scanlines) convulses in the same instant.
 */
function useGlitchBursts(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    const root = document.querySelector('.app')
    if (!root) return
    let alive = true
    let onTimer = 0
    let offTimer = 0
    const schedule = () => {
      onTimer = window.setTimeout(
        () => {
          if (!alive) return
          root.classList.add('glitch-now')
          offTimer = window.setTimeout(
            () => {
              root.classList.remove('glitch-now')
              if (alive) schedule()
            },
            150 + Math.random() * 170,
          )
        },
        5000 + Math.random() * 9000,
      )
    }
    schedule()
    return () => {
      alive = false
      clearTimeout(onTimer)
      clearTimeout(offTimer)
      root.classList.remove('glitch-now')
    }
  }, [enabled])
}

interface MenuAtmosphereProps {
  /** Show the big sigil ring (loading brings its own ritual circle). */
  ring?: boolean
}

/**
 * Full-screen backdrop stack for the menu screens: light shaft, sigil ring,
 * ember motes, film grain, scanlines, vignette and corner transmission tags.
 * Pointer-transparent; sits behind the screen's content (`.fx-layer`).
 */
export function MenuAtmosphere({ ring = true }: MenuAtmosphereProps) {
  const reducedMotion = useGameStore(s => s.settings.reducedMotion)
  const prefersReduced = useMemo(
    () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  )
  useGlitchBursts(!reducedMotion && !prefersReduced)

  return (
    <div className="fx-layer" aria-hidden>
      <div className="fx-shaft" />
      {ring && <SigilRing />}
      <Motes />
      <div className="fx-grain" />
      <div className="fx-scan" />
      <div className="fx-vignette" />
      <div className="fx-corner fx-corner-tl">
        <span className="fx-dot" />
        VOID LINK — STABLE
      </div>
      <div className="fx-corner fx-corner-br">THE DEEP LISTENS</div>
    </div>
  )
}
