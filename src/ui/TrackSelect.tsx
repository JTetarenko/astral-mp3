import { useEffect, useMemo } from 'react'
import { useGameStore } from '../game/state'
import { loadProgress } from '../game/progress'
import { levelForXp } from '../game/rpg'
import { VisualSettingsControls } from './VisualSettingsControls'
import { VolumeControls } from './VolumeControls'
import { GlitchText } from './fx/GlitchText'
import { MenuAtmosphere } from './fx/MenuAtmosphere'
import { runeForString, runeMaskStyle } from './fx/menuGlyphs'
import type { TrackManifestEntry } from '../types'

/** Divider glyph indices — an arbitrary but fixed inscription. */
const DIVIDER_RUNES = [3, 7, 0, 10, 5]

function formatSize(bytes: number): string {
  return `${(bytes / 1048576).toFixed(1)} MB`
}

export function TrackSelect() {
  const tracks = useGameStore(s => s.tracks)
  const tracksLoaded = useGameStore(s => s.tracksLoaded)
  const error = useGameStore(s => s.error)
  const settings = useGameStore(s => s.settings)
  const refreshTracks = useGameStore(s => s.refreshTracks)
  const selectTrack = useGameStore(s => s.selectTrack)
  const setSettings = useGameStore(s => s.setSettings)
  const enterHub = useGameStore(s => s.enterHub)
  const shards = useGameStore(s => s.rpg.shards)
  const rpgLevel = useGameStore(s => s.rpg.xp)
  const progress = useMemo(loadProgress, [])

  useEffect(() => {
    void refreshTracks()
  }, [refreshTracks])

  return (
    <div className="screen select-screen" data-testid="track-select">
      <MenuAtmosphere />
      <div className="menu-core">
        <header className="brand-block">
          <GlitchText as="h1" className="brand" text="ASTRAL RESONANCE" />
          <p className="tagline">THE WORLD LISTENS · FLICK · SNAP · DESCEND</p>
          <div className="rune-divider">
            {DIVIDER_RUNES.map(g => (
              <i key={g} className="atlas-rune" style={runeMaskStyle(g)} />
            ))}
          </div>
        </header>

        <div className="chip-row">
          {progress.bestDepth > 0 && (
            <div className="best-depth-chip">DEEPEST DESCENT — {progress.bestDepth}</div>
          )}
          <button className="btn sanctum-btn" onClick={enterHub} data-testid="sanctum">
            THE SANCTUM
            <span className="sanctum-sub">
              LV {levelForXp(rpgLevel)} · ᛝ {shards.toLocaleString()}
            </span>
          </button>
        </div>

        {error && <div className="error-banner glitch-flicker">SIGNAL LOST — {error}</div>}

        {tracksLoaded && tracks.length === 0 ? (
          <div className="empty-state panel">
            <h2>THE VOID IS SILENT</h2>
            <p>
              Drop <b>.mp3</b> files (or .ogg / .wav) into
            </p>
            <code>public\tracks\</code>
            <p>next to this project, then rescan. Your files stay local and gitignored.</p>
            <button className="btn" onClick={() => void refreshTracks()}>
              RESCAN THE VOID
            </button>
          </div>
        ) : (
          <>
            <div className="list-head">
              <span>CHOOSE AN OFFERING</span>
              <span>
                {tracks.length} SIGNAL{tracks.length === 1 ? '' : 'S'}
              </span>
            </div>
            <div className="track-list" data-testid="track-list">
              {tracks.map((t: TrackManifestEntry) => (
                <button key={t.file} className="track-row" onClick={() => void selectTrack(t)}>
                  <i className="atlas-rune row-rune" style={runeMaskStyle(runeForString(t.file))} />
                  <span className="track-name">{t.name}</span>
                  {progress.bestByTrack[t.file] ? (
                    <span className="track-best">D{progress.bestByTrack[t.file]}</span>
                  ) : null}
                  <span className="track-size">{formatSize(t.sizeBytes)}</span>
                </button>
              ))}
            </div>
            <button className="btn btn-ghost" onClick={() => void refreshTracks()}>
              RESCAN THE VOID
            </button>
          </>
        )}

        <div className="settings-row">
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
        </div>
      </div>
    </div>
  )
}
