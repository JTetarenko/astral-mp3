import type { ReactNode } from 'react'
import { describeItem, describeMods } from '../../game/describe'
import type { CombatStats } from '../../game/stats'
import type { ItemDef } from '../../game/items'

/**
 * The one real item tooltip: a styled hover/focus card replacing the old
 * native `title` attr — name, rarity, the MECHANICAL stat/effect lines
 * (gear clarity is the whole point), dimmed flavor, provenance. Pure CSS
 * positioning (absolute over the wrapped tile); `compare` lists the currently
 * socketed relics so a stat line can show what it's up against.
 */
export function ItemTooltip({
  item,
  compare,
  children,
}: {
  item: ItemDef
  /** Socketed relics to compare against (same-stat lines annotated). */
  compare?: ItemDef[]
  children: ReactNode
}) {
  const d = describeItem(item)
  // per-stat comparison: what the socketed gear already gives on that stat
  const compareFor = (line: string): string | null => {
    if (!compare || item.kind !== 'relic' || !item.mods) return null
    const stat = statOfLine(line, item.mods)
    if (!stat) return null
    let total = 0
    let found = false
    for (const other of compare) {
      if (other.id === item.id) continue
      const v = other.mods?.[stat]
      if (v) {
        total += v
        found = true
      }
    }
    if (!found) return null
    const eq = describeMods({ [stat]: total })[0]
    return eq ? `socketed ${eq.split(' ')[0]}` : null
  }
  return (
    <span className="tooltip-wrap">
      {children}
      <span className={`item-tooltip rarity-${item.rarity}`} role="tooltip">
        <span className="tt-name">{item.name}</span>
        <span className="tt-rarity">{d.rarityLabel}</span>
        <span className="tt-lines">
          {d.lines.map(line => {
            const cmp = compareFor(line)
            return (
              <span className="tt-line" key={line}>
                {line}
                {cmp && <em className="tt-compare"> · {cmp}</em>}
              </span>
            )
          })}
        </span>
        <span className="tt-flavor">{d.flavor}</span>
        <span className="tt-source">{d.source}</span>
      </span>
    </span>
  )
}

/** Recover which stat a rendered line came from (label match). */
function statOfLine(line: string, mods: Partial<CombatStats>): keyof CombatStats | null {
  for (const key of Object.keys(mods) as (keyof CombatStats)[]) {
    const only = describeMods({ [key]: mods[key] })
    if (only[0] === line) return key
  }
  return null
}
