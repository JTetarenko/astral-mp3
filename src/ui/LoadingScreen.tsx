import { useGameStore } from '../game/state'
import { MenuAtmosphere } from './fx/MenuAtmosphere'
import { runeForString, runeMaskStyle } from './fx/menuGlyphs'
import { useDecodeText } from './fx/useDecodeText'

const STAGE_LABELS: Record<string, string> = {
  download: 'CHANNELING SIGNAL',
  decode: 'DECODING WAVEFORM',
  analyze: 'READING RESONANCE',
  build: 'FORGING REALM',
}

const RING_R = 104
const RING_C = 2 * Math.PI * RING_R

export function LoadingScreen() {
  const loading = useGameStore(s => s.loading)
  const track = useGameStore(s => s.currentTrack)
  const stageText = useDecodeText(STAGE_LABELS[loading.stage] ?? '...')
  const p = Math.min(1, Math.max(0.02, loading.progress))

  return (
    <div className="screen loading-screen" data-testid="loading">
      <MenuAtmosphere ring={false} />
      <div className="menu-core">
        <div className="ritual-circle">
          <svg viewBox="0 0 240 240">
            <circle cx="120" cy="120" r="114" className="rc-dash rc-spin" />
            <circle cx="120" cy="120" r={RING_R} className="rc-track" />
            <circle
              cx="120"
              cy="120"
              r={RING_R}
              className="rc-progress"
              strokeDasharray={RING_C}
              strokeDashoffset={RING_C * (1 - p)}
              transform="rotate(-90 120 120)"
            />
            <circle cx="120" cy="120" r="88" className="rc-dash rc-spin-rev" />
          </svg>
          <i
            className="atlas-rune ritual-rune"
            style={runeMaskStyle(runeForString(track?.file ?? ''))}
          />
        </div>
        <h2 className="loading-track">{track?.name ?? ''}</h2>
        <div className="loading-stage">{stageText}</div>
        <div className="progress-outer">
          <div className="progress-inner" style={{ transform: `scaleX(${p})` }} />
        </div>
        <div className="loading-pct">{Math.round(p * 100)}%</div>
      </div>
    </div>
  )
}
