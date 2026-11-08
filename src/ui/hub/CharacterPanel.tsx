import { useState } from 'react'
import { npcLine, NPCS_BY_ID } from '../../game/npcs'
import {
  ATTR_CAP,
  ATTRIBUTE_IDS,
  computeStats,
  levelForXp,
  unspentPoints,
  xpIntoLevel,
  type AttributeId,
} from '../../game/rpg'
import { BASE_STATS } from '../../game/stats'
import { useGameStore } from '../../game/state'
import { NpcPortrait } from './NpcPortrait'

const ATTR_META: Record<AttributeId, { label: string; hint: string }> = {
  vigor: { label: 'VIGOR', hint: 'latch ward — how many riders before the fall' },
  force: { label: 'FORCE', hint: 'snap-strike & bolt damage' },
  grace: { label: 'GRACE', hint: 'nova reach & flight' },
  attunement: { label: 'ATTUNEMENT', hint: 'gate charge & shard tithe' },
}

function pct(v: number): string {
  const d = Math.round((v - 1) * 100)
  return `${d >= 0 ? '+' : ''}${d}%`
}

/** Vess's mirror: level, attributes, and the derived combat readout. */
export function CharacterPanel() {
  const rpg = useGameStore(s => s.rpg)
  const spendAttributePoint = useGameStore(s => s.spendAttributePoint)
  const vess = NPCS_BY_ID.vess
  const [lineKey, setLineKey] = useState<{ key: Parameters<typeof npcLine>[1]; salt: number }>({
    key: rpg.npcMet.vess ? 'greeting' : 'greetingFirst',
    salt: 0,
  })

  const level = levelForXp(rpg.xp)
  const { into, span } = xpIntoLevel(rpg.xp)
  const unspent = unspentPoints(rpg)
  const stats = computeStats(rpg)

  const derived: Array<[string, string]> = [
    ['LATCH WARD', `${BASE_STATS.maxLatch} → ${stats.maxLatch}`],
    ['SNAP FORCE', pct(stats.snapDamageMult)],
    ['BOLT FORCE', pct(stats.boltDamageMult)],
    ['NOVA REACH', pct(stats.novaRadiusMult)],
    ['FLIGHT', pct(stats.moveMult)],
    ['GATE CHARGE', pct(stats.chargeGainMult)],
  ]

  return (
    <div className="hub-split" data-testid="hub-character">
      <NpcPortrait npc={vess} line={npcLine(vess, lineKey.key, lineKey.salt)} />
      <div className="hub-panel-scroll">
        <div className="char-level-row" data-testid="char-xp">
          <span className="char-level">LEVEL {level}</span>
          <div className="xp-bar">
            <div className="xp-bar-fill" style={{ transform: `scaleX(${into / Math.max(1, span)})` }} />
          </div>
          <span className="char-xp-nums">
            {into} / {span}
          </span>
        </div>
        {unspent > 0 && <div className="unspent-chip">UNSPENT — {unspent}</div>}

        {ATTRIBUTE_IDS.map(attr => {
          const v = rpg.attributes[attr]
          const meta = ATTR_META[attr]
          const atCap = v >= ATTR_CAP
          return (
            <div className="attr-row" key={attr} data-testid={`attr-${attr}`}>
              <div className="attr-head">
                <span className="attr-name">{meta.label}</span>
                <span className="attr-hint">{meta.hint}</span>
              </div>
              <div className="attr-pips">
                {Array.from({ length: ATTR_CAP }, (_, i) => (
                  <span key={i} className={`attr-pip${i < v ? ' lit' : ''}`}>
                    ◆
                  </span>
                ))}
              </div>
              <span className="attr-value">{v}</span>
              {unspent > 0 && !atCap && (
                <button
                  className="attr-plus"
                  data-testid={`attr-plus-${attr}`}
                  onClick={() => {
                    spendAttributePoint(attr)
                    setLineKey(s => ({ key: 'spend', salt: s.salt + 1 }))
                  }}
                >
                  +
                </button>
              )}
              {atCap && unspent > 0 && (
                <span
                  className="attr-cap"
                  onClick={() => setLineKey(s => ({ key: 'atCap', salt: s.salt + 1 }))}
                >
                  TAUT
                </span>
              )}
            </div>
          )
        })}

        <div className="hub-section-head">DERIVED ATTUNEMENTS</div>
        <div className="derived-grid">
          {derived.map(([label, value]) => (
            <div className="stat-row" key={label}>
              <span>{label}</span>
              <b>{value}</b>
            </div>
          ))}
        </div>
        <div className="hub-footnote">Socketed relics are folded into the readout.</div>
      </div>
    </div>
  )
}
