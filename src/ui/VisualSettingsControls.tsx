import { useGameStore } from '../game/state'
import { immersionTier } from '../game/immersion'

/** Visual-intensity slider (labeled as the immersion/difficulty dial) +
 * photosensitivity toggle. Rendered on the track select screen AND the pause
 * overlay — an overwhelmed player must be able to reach the reduced-motion
 * switch mid-song. */
export function VisualSettingsControls() {
  const settings = useGameStore(s => s.settings)
  const setSettings = useGameStore(s => s.setSettings)
  const tier = immersionTier(settings.visualIntensity)
  return (
    <>
      <label className="slider-label">
        <span className="sl-head">
          <span className="sl-name">VISUALS</span>
          <span className="sl-value">
            {Math.round(settings.visualIntensity * 100)}% ·{' '}
            <span className="sl-tier" style={{ color: `hsl(${tier.hue} 90% 62%)` }}>
              {tier.label}
            </span>
          </span>
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={settings.visualIntensity}
          onChange={e => setSettings({ visualIntensity: Number(e.target.value) })}
        />
        <span className="sl-hint">immersion · enemy pressure</span>
      </label>
      <label className="slider-label toggle-label">
        <span className="sl-name">REDUCED MOTION</span>
        <input
          type="checkbox"
          checked={settings.reducedMotion}
          onChange={e => setSettings({ reducedMotion: e.target.checked })}
        />
      </label>
    </>
  )
}
