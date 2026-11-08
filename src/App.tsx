import { useEffect } from 'react'
import { startDrone, stopDrone } from './audio/sfx'
import { getRealmForDepth, shiftCostForDepth } from './game/realms'
import { DEBUG_MODE, useGameStore } from './game/state'
import { applyTheme, DEFAULT_THEME_ID } from './theme/palettes'
import { PlayScene } from './scene/PlayScene'
import { TrackSelect } from './ui/TrackSelect'
import { LoadingScreen } from './ui/LoadingScreen'
import { Hud } from './ui/Hud'
import { EndScreen } from './ui/EndScreen'
import { HubScreen } from './ui/hub/HubScreen'
import { DebugOverlay } from './ui/DebugOverlay'
import { VisualSettingsControls } from './ui/VisualSettingsControls'
import { VolumeControls } from './ui/VolumeControls'
import { GlitchText } from './ui/fx/GlitchText'
import { installMenuSounds } from './ui/fx/menuSounds'
import { runeForString, runeMaskStyle } from './ui/fx/menuGlyphs'

const GATE_HELP: Array<[string, string]> = [
  ['MOUSE', 'look · flick to a glowing point'],
  ['LMB', 'astral snap · strike THROUGH a horror'],
  ['RMB', 'crystal bow · tap / draw / overdraw volley'],
  ['E', 'banish nova — 2 charge, sheds the swarm'],
  ['WASD', 'drift · SPACE / SHIFT — rise / sink'],
  ['W W (HOLD)', 'sprint · 1 / 2 — consume rites'],
  ['V', 'toggle camera · ESC — pause'],
]

function BeginGate() {
  const begin = useGameStore(s => s.begin)
  const track = useGameStore(s => s.currentTrack)
  const analysis = useGameStore(s => s.analysis)
  const depth = useGameStore(s => s.depth)
  const realm = getRealmForDepth(depth).realm
  return (
    <div className="screen gate" onClick={begin} data-testid="begin-gate">
      <div className="gate-inner">
        <i className="atlas-rune gate-rune" style={runeMaskStyle(runeForString(track?.file ?? ''))} />
        <GlitchText as="h2" className="gate-track" text={track?.name ?? ''} />
        <div className="gate-meta">
          SIGIL {analysis ? analysis.seed.toString(16).toUpperCase() : ''} · {analysis?.bpm} BPM ·{' '}
          DEPTH {depth + 1} — {realm.label}
        </div>
        <div className="gate-cta">
          <GlitchText text="BEGIN THE RITE" />
        </div>
        <div className="gate-sub">CLICK TO DESCEND — THE VOID TAKES YOUR CURSOR</div>
        <ul className="gate-help">
          {GATE_HELP.map(([key, desc]) => (
            <li key={key}>
              <b>{key}</b>
              <span>{desc}</span>
            </li>
          ))}
          <li>
            <b>{shiftCostForDepth(depth)} PTS</b>
            <span>
              charge the <em>REALM GATE</em> — snap it to descend
            </span>
          </li>
        </ul>
      </div>
    </div>
  )
}

function PauseOverlay() {
  const resumeGame = useGameStore(s => s.resumeGame)
  const quitToMenu = useGameStore(s => s.quitToMenu)
  const settings = useGameStore(s => s.settings)
  const setSettings = useGameStore(s => s.setSettings)
  return (
    <div className="screen pause" data-testid="pause">
      <div className="panel pause-panel">
        <h2 className="pause-title">SUSPENDED</h2>
        <button
          className="btn btn-ghost setting-btn"
          onClick={() =>
            setSettings({ viewMode: settings.viewMode === 'third' ? 'first' : 'third' })
          }
        >
          <span className="sl-name">CAMERA</span>
          <span className="sl-value">
            {settings.viewMode === 'third' ? 'THIRD PERSON' : 'FIRST PERSON'} · V
          </span>
        </button>
        <label className="slider-label">
          <span className="sl-head">
            <span className="sl-name">SENSITIVITY</span>
            <span className="sl-value">{settings.sensitivity.toFixed(2)}</span>
          </span>
          <input
            type="range"
            min={0.5}
            max={3}
            step={0.05}
            value={settings.sensitivity}
            onChange={e => setSettings({ sensitivity: Number(e.target.value) })}
          />
        </label>
        <VolumeControls />
        <VisualSettingsControls />
        <div className="end-buttons">
          <button className="btn" onClick={resumeGame}>
            RESUME
          </button>
          <button className="btn btn-ghost" onClick={quitToMenu}>
            EXIT TO MENU
          </button>
        </div>
      </div>
    </div>
  )
}

export function App() {
  const screen = useGameStore(s => s.screen)
  const started = useGameStore(s => s.started)
  const paused = useGameStore(s => s.paused)
  const depth = useGameStore(s => s.depth)
  const reducedMotion = useGameStore(s => s.settings.reducedMotion)

  // Menu chrome uses the default theme; in the world the realm's palette
  // drives the HUD CSS vars (re-applied under each shift's whiteout). The
  // Sanctum wears the gilded ashGold — sacred ground, not the void.
  useEffect(() => {
    const inWorld = screen === 'play' || screen === 'end'
    applyTheme(
      inWorld ? getRealmForDepth(depth).paletteId : screen === 'hub' ? 'ashGold' : DEFAULT_THEME_ID,
    )
  }, [screen, depth])

  // Ambient synth drone on the contemplative screens; silent until the first
  // user gesture has created the audio context.
  useEffect(() => {
    if (screen === 'select' || screen === 'end' || screen === 'hub') startDrone()
    else stopDrone()
  }, [screen])

  // Bone-click hovers/ticks on all menu chrome + the first-gesture audio
  // bootstrap that lets the pending chant drone actually start.
  useEffect(() => installMenuSounds(), [])

  const inWorld = screen === 'play' || screen === 'end'

  return (
    <div className={`app${screen === 'end' ? ' app-blur' : ''}${reducedMotion ? ' rm' : ''}`}>
      {inWorld && <PlayScene />}
      {screen === 'select' && <TrackSelect />}
      {screen === 'hub' && <HubScreen />}
      {screen === 'loading' && <LoadingScreen />}
      {screen === 'play' && started && !paused && <Hud />}
      {screen === 'play' && !started && <BeginGate />}
      {screen === 'play' && started && paused && <PauseOverlay />}
      {screen === 'end' && <EndScreen />}
      {DEBUG_MODE && <DebugOverlay />}
    </div>
  )
}
