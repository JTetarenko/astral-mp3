import { useEffect, useMemo, useState } from 'react'
import { useGameStore } from '../game/state'
import { sfxRunEnd } from '../audio/sfx'
import { getItem } from '../game/items'
import { levelForXp, xpIntoLevel } from '../game/rpg'
import { DropChoice } from './DropChoice'
import { GlitchText } from './fx/GlitchText'
import { MenuAtmosphere } from './fx/MenuAtmosphere'
import { runeMaskStyle } from './fx/menuGlyphs'

export function EndScreen() {
  const result = useGameStore(s => s.result)
  const replay = useGameStore(s => s.replay)
  const backToSelect = useGameStore(s => s.backToSelect)
  const enterHub = useGameStore(s => s.enterHub)
  const rpg = useGameStore(s => s.rpg)
  const reducedMotion = useGameStore(s => s.settings.reducedMotion)

  // XP bar animates from the pre-run fill to the settled fill after mount
  const [xpArmed, setXpArmed] = useState(false)
  useEffect(() => {
    sfxRunEnd()
    const id = window.setTimeout(() => setXpArmed(true), reducedMotion ? 0 : 350)
    return () => window.clearTimeout(id)
  }, [reducedMotion])

  const xpView = useMemo(() => {
    if (!result) return null
    const after = xpIntoLevel(rpg.xp)
    const beforeXp = Math.max(0, rpg.xp - result.xpGained)
    const before = xpIntoLevel(beforeXp)
    const leveled = result.levelAfter > result.levelBefore
    return {
      level: levelForXp(rpg.xp),
      fillBefore: leveled ? 0 : before.into / Math.max(1, before.span),
      fillAfter: after.into / Math.max(1, after.span),
      into: after.into,
      span: after.span,
      leveled,
    }
  }, [result, rpg.xp])

  if (!result) return null

  const downed = result.outcome === 'downed'
  const stats: Array<[string, string]> = [
    ['POINTS COLLECTED', String(result.collected)],
    ['REALMS VISITED', String(result.realmsVisited)],
    ['SNAPS', String(result.snaps)],
    ['PERFECT / GOOD', `${result.perfects} / ${result.goods}`],
    ['ON BEAT', String(result.onBeats)],
    ['BEST CHAIN', String(result.bestChain)],
  ]
  if (result.kills > 0 || result.latchesSuffered > 0 || downed) {
    stats.push(['HORRORS BANISHED', String(result.kills)])
    stats.push(['TIMES LATCHED', String(result.latchesSuffered)])
  }
  if (result.damageTaken > 0) stats.push(['BLOOD PAID', String(Math.round(result.damageTaken))])
  if (result.wardenKills > 0) stats.push(['WARDENS FELLED', String(result.wardenKills)])

  return (
    <div className="screen end-screen" data-testid="end-screen">
      <MenuAtmosphere ring={false} />
      <div className="panel end-panel">
        <GlitchText
          as="h2"
          className={downed ? 'end-title end-title-downed' : 'end-title'}
          text={downed ? 'TAKEN BY THE SWARM' : 'SIGNAL FADED'}
        />
        <div className="end-track">{result.trackName}</div>
        <div className="end-depth">
          <i className="atlas-rune depth-rune" style={runeMaskStyle(result.depth)} />
          <span>
            DEPTH {result.depth}
            <span className="end-realm">{result.realmName}</span>
          </span>
          <i className="atlas-rune depth-rune" style={runeMaskStyle(result.depth + 5)} />
        </div>
        {result.newBest && <div className="best-badge">NEW DEEPEST</div>}
        <div className="end-score">{result.score.toLocaleString()}</div>
        {xpView && (
          <div className="end-xp" data-testid="end-xp">
            {xpView.leveled && (
              <GlitchText
                as="div"
                className="levelup-flare"
                text={`ATTUNEMENT DEEPENS — LEVEL ${result.levelAfter}`}
              />
            )}
            <div className="end-xp-row">
              <span className="end-xp-level">LEVEL {xpView.level}</span>
              <div className="xp-bar">
                <div
                  className="xp-bar-fill"
                  style={{
                    transform: `scaleX(${xpArmed ? xpView.fillAfter : xpView.fillBefore})`,
                  }}
                />
              </div>
              <span className="end-xp-nums">
                +{result.xpGained} XP · ᛝ {result.shardsGained}
              </span>
            </div>
          </div>
        )}
        {result.drops.length > 0 && (
          <div className="end-drops" data-testid="end-drops">
            <div className="end-drops-label">TAKEN FROM THE DEEP</div>
            <div className="end-drops-row">
              {result.drops.map((id, i) => {
                const item = getItem(id)
                if (!item) return null
                return (
                  <div key={`${id}-${i}`} className={`drop-tile rarity-${item.rarity}`} title={item.flavor}>
                    <i className="atlas-rune drop-rune" style={runeMaskStyle(item.glyph)} />
                    <span>{item.name}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
        <DropChoice label="THE DEEP OFFERS — CHOOSE ONE" />
        {result.questTicks.length > 0 && (
          <div className="quest-ticks" data-testid="quest-ticks">
            {result.questTicks.map((tick, i) => (
              <div
                key={tick.questId}
                className="stat-row quest-tick"
                style={{ animationDelay: `${400 + i * 110}ms` }}
              >
                <span>◆ {tick.title}</span>
                <b>
                  {tick.before} → {tick.after} / {tick.target}
                  {tick.completed && <em className="tick-done"> · RETURN TO THE SANCTUM</em>}
                </b>
              </div>
            ))}
          </div>
        )}
        <div className="end-stats">
          {stats.map(([label, value], i) => (
            <div key={label} className="stat-row" style={{ animationDelay: `${200 + i * 110}ms` }}>
              <span>{label}</span>
              <b>{value}</b>
            </div>
          ))}
        </div>
        <div className="end-buttons">
          <button className="btn" onClick={replay} data-testid="replay">
            DIVE AGAIN
          </button>
          <button className="btn btn-ghost" onClick={enterHub} data-testid="to-hub">
            RETURN TO SANCTUM
          </button>
          <button className="btn btn-ghost" onClick={backToSelect} data-testid="back">
            SELECT TRACK
          </button>
        </div>
      </div>
    </div>
  )
}
