import { useMemo, useState } from 'react'
import { getItem, type ItemDef } from '../../game/items'
import { useGameStore } from '../../game/state'
import { ItemTile } from './ItemTile'
import { UnclaimedSpoils } from './UnclaimedSpoils'

/**
 * The reliquary: three relic sockets, the two rite slots (keys 1/2 in-run),
 * everything owned, and the warden trophy shelf. Click an owned tile to
 * socket it into the first fitting slot; click a socket to empty it.
 */
export function InventoryPanel() {
  const rpg = useGameStore(s => s.rpg)
  const equipRelicSlot = useGameStore(s => s.equipRelicSlot)
  const unequipRelicSlot = useGameStore(s => s.unequipRelicSlot)
  const setRiteSlot = useGameStore(s => s.setRiteSlot)
  const [note, setNote] = useState('The sockets hunger.')

  // iterate the SAVE's keys (not the static catalog) so procedural gen:*
  // relics appear beside the named ones
  const owned = useMemo(
    () =>
      Object.keys(rpg.items)
        .map(id => getItem(id))
        .filter((i): i is ItemDef => i !== null && (rpg.items[i.id] ?? 0) > 0)
        .sort((a, b) =>
          a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind.localeCompare(b.kind),
        ),
    [rpg.items],
  )
  const trophies = owned.filter(i => i.kind === 'trophy')
  // socketed relics feed every tooltip's compare line
  const socketedRelics = useMemo(
    () =>
      rpg.relics
        .map(id => (id ? getItem(id) : null))
        .filter((i): i is ItemDef => i !== null),
    [rpg.relics],
  )

  const socketItem = (item: ItemDef) => {
    if (item.kind === 'relic') {
      const already = rpg.relics.indexOf(item.id)
      if (already >= 0) {
        unequipRelicSlot(already)
        setNote(`${item.name} unsocketed.`)
        return
      }
      const free = rpg.relics.indexOf(null)
      equipRelicSlot(item.id, free >= 0 ? free : 0)
      setNote(`${item.name} socketed.`)
    } else if (item.kind === 'consumable') {
      const already = rpg.loadout.indexOf(item.id)
      if (already >= 0) {
        setRiteSlot(already, null)
        setNote(`${item.name} unslotted.`)
        return
      }
      const free = rpg.loadout.indexOf(null)
      setRiteSlot(free >= 0 ? free : 0, item.id)
      setNote(`${item.name} readied — key ${(free >= 0 ? free : 0) + 1} in the deep.`)
    } else {
      setNote(`${item.name}: proof, not power. Korr remembers.`)
    }
  }

  return (
    <div className="hub-single" data-testid="hub-inventory">
      <UnclaimedSpoils />
      <div className="socket-rows">
        <div className="socket-group">
          <span className="hub-section-head">RELIC SOCKETS</span>
          <div className="socket-list">
            {rpg.relics.map((id, slot) => {
              const item = id ? getItem(id) : null
              return item ? (
                <ItemTile
                  key={`r${slot}`}
                  item={item}
                  socketed
                  onClick={() => unequipRelicSlot(slot)}
                  testId={`relic-slot-${slot}`}
                />
              ) : (
                <div key={`r${slot}`} className="socket-empty" data-testid={`relic-slot-${slot}`}>
                  ◇
                </div>
              )
            })}
          </div>
        </div>
        <div className="socket-group">
          <span className="hub-section-head">RITE LOADOUT — KEYS 1 / 2</span>
          <div className="socket-list">
            {rpg.loadout.map((id, slot) => {
              const item = id ? getItem(id) : null
              return item ? (
                <div key={`l${slot}`} className="rite-slot">
                  <span className="rite-key">{slot + 1}</span>
                  <ItemTile
                    item={item}
                    count={rpg.items[item.id] ?? 0}
                    socketed
                    onClick={() => setRiteSlot(slot, null)}
                    testId={`loadout-slot-${slot}`}
                  />
                </div>
              ) : (
                <div key={`l${slot}`} className="rite-slot">
                  <span className="rite-key">{slot + 1}</span>
                  <div className="socket-empty" data-testid={`loadout-slot-${slot}`}>
                    ◇
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="hub-section-head">THE RELIQUARY</div>
      <div className="inv-note">{note}</div>
      {owned.length === 0 ? (
        <div className="hub-footnote">Nothing yet. The deep pays in shards and relics — descend.</div>
      ) : (
        <div className="item-grid" data-testid="inv-grid">
          {owned
            .filter(i => i.kind !== 'trophy')
            .map(item => (
              <ItemTile
                key={item.id}
                item={item}
                count={rpg.items[item.id] ?? 0}
                socketed={rpg.relics.includes(item.id) || rpg.loadout.includes(item.id)}
                onClick={() => socketItem(item)}
                testId={`inv-item-${item.id}`}
                compare={socketedRelics}
              />
            ))}
        </div>
      )}
      {trophies.length > 0 && (
        <>
          <div className="hub-section-head">WARDEN TROPHIES</div>
          <div className="item-grid trophy-shelf">
            {trophies.map(item => (
              <ItemTile key={item.id} item={item} onClick={() => socketItem(item)} testId={`inv-item-${item.id}`} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
