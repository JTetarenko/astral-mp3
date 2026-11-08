import { useMemo, useState } from 'react'
import { sfxChime } from '../audio/sfx'
import { describeItem } from '../game/describe'
import { getItem, type ItemDef } from '../game/items'
import { useGameStore } from '../game/state'
import { runeMaskStyle } from './fx/menuGlyphs'

/**
 * The choice-of-3 signal-clear reward: three seeded offers with FULL stat
 * text (gear clarity is the point), pick one, the others dissolve. Reads
 * rpg.pendingDrops directly — the record persists in the save until claimed,
 * so the end screen, a refresh, and the hub banner all show the same truth.
 * Owned-relic duplicates are flagged (claiming one pays shards instead).
 */
export function DropChoice({ label }: { label: string }) {
  const rpg = useGameStore(s => s.rpg)
  const claimDrop = useGameStore(s => s.claimDrop)
  const [claimedAt, setClaimedAt] = useState<number | null>(null)
  const pending = rpg.pendingDrops

  const socketedRelics = useMemo(
    () =>
      rpg.relics.map(id => (id ? getItem(id) : null)).filter((i): i is ItemDef => i !== null),
    [rpg.relics],
  )

  if (!pending) return null

  const onPick = (i: 0 | 1 | 2) => {
    if (claimedAt !== null) return
    setClaimedAt(i)
    sfxChime()
    // let the dissolve animation read before the record clears
    window.setTimeout(() => claimDrop(i), 420)
  }

  return (
    <div className="drop-choice" data-testid="drop-choice">
      <div className="end-drops-label">{label}</div>
      <div className="drop-choice-row">
        {pending.offers.map((id, i) => {
          const item = getItem(id)
          if (!item) return null
          const d = describeItem(item)
          const owned = (rpg.items[id] ?? 0) > 0
          const state =
            claimedAt === null ? '' : claimedAt === i ? ' chosen' : ' dissolving'
          // per-stat socketed comparison, rendered under the stat lines
          const compareLines: string[] = []
          if (item.mods) {
            for (const other of socketedRelics) {
              if (!other.mods) continue
              for (const k of Object.keys(item.mods)) {
                const key = k as keyof typeof item.mods
                if (other.mods[key]) {
                  compareLines.push(`${other.name} HOLDS THIS VEIN`)
                  break
                }
              }
            }
          }
          return (
            <button
              key={id}
              type="button"
              className={`drop-card rarity-${item.rarity}${state}`}
              onClick={() => onPick(i as 0 | 1 | 2)}
              disabled={claimedAt !== null}
              data-testid={`drop-card-${i}`}
            >
              <i className="atlas-rune drop-card-rune" style={runeMaskStyle(item.glyph)} />
              <span className="drop-card-name">{item.name}</span>
              <span className="drop-card-rarity">{d.rarityLabel}</span>
              <span className="drop-card-lines">
                {d.lines.map(line => (
                  <span key={line}>{line}</span>
                ))}
              </span>
              {compareLines.length > 0 && (
                <span className="drop-card-compare">{compareLines[0]}</span>
              )}
              {owned && <span className="drop-card-owned">KEPT — DISSOLVES TO ᛝ</span>}
              <span className="drop-card-flavor">{item.flavor}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
