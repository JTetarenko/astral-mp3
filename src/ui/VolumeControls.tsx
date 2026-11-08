import { useGameStore } from '../game/state'

/** MUSIC + SFX sliders. Rendered on the track select screen AND the pause
 * overlay. The mix default is music-first: sfx sits low so the track — and
 * the realm reacting to it — stays the focus. */
export function VolumeControls() {
  const settings = useGameStore(s => s.settings)
  const setSettings = useGameStore(s => s.setSettings)
  return (
    <>
      <label className="slider-label">
        <span className="sl-head">
          <span className="sl-name">MUSIC</span>
          <span className="sl-value">{Math.round(settings.musicVolume * 100)}%</span>
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={settings.musicVolume}
          onChange={e => setSettings({ musicVolume: Number(e.target.value) })}
        />
      </label>
      <label className="slider-label">
        <span className="sl-head">
          <span className="sl-name">SFX</span>
          <span className="sl-value">{Math.round(settings.sfxVolume * 100)}%</span>
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={settings.sfxVolume}
          onChange={e => setSettings({ sfxVolume: Number(e.target.value) })}
        />
      </label>
    </>
  )
}
