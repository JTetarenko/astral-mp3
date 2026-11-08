import { useMemo, useState } from 'react'
import { sfxChime } from '../../audio/sfx'
import { describeItem } from '../../game/describe'
import { ITEMS, type ItemDef } from '../../game/items'
import { npcLine, NPCS_BY_ID } from '../../game/npcs'
import { useGameStore } from '../../game/state'
import { ItemTile } from './ItemTile'
import { NpcPortrait } from './NpcPortrait'

function ShopRow({
  item,
  owned,
  shards,
  onBuy,
}: {
  item: ItemDef
  owned: number
  shards: number
  onBuy: (id: string) => void
}) {
  const keepsake = item.kind !== 'consumable' && owned > 0
  const poor = shards < item.price
  return (
    <div className="shop-row" data-testid={`shop-item-${item.id}`}>
      <ItemTile item={item} count={owned} />
      <div className="shop-row-main">
        <span className="shop-row-name">{item.name}</span>
        <span className="shop-row-stats">{describeItem(item).lines.join(' · ')}</span>
        <span className="shop-row-flavor">{item.flavor}</span>
      </div>
      {owned > 0 && <span className="shop-owned">{item.kind === 'consumable' ? `×${owned}` : 'KEPT'}</span>}
      <button
        className={`btn shop-buy${poor && !keepsake ? ' btn-poor' : ''}`}
        disabled={keepsake}
        onClick={() => onBuy(item.id)}
        data-testid={`buy-${item.id}`}
      >
        ᛝ {item.price}
      </button>
    </div>
  )
}

/** Elara's ledger: relics and rites for Resonance Shards. */
export function ShopPanel() {
  const rpg = useGameStore(s => s.rpg)
  const buyItem = useGameStore(s => s.buyItem)
  const elara = NPCS_BY_ID.elara
  const [lineKey, setLineKey] = useState<{ key: Parameters<typeof npcLine>[1]; salt: number }>({
    key: rpg.npcMet.elara ? 'browse' : 'greetingFirst',
    salt: 0,
  })

  const relics = useMemo(() => ITEMS.filter(i => i.kind === 'relic' && i.price > 0), [])
  const rites = useMemo(() => ITEMS.filter(i => i.kind === 'consumable' && i.price > 0), [])

  const onBuy = (id: string) => {
    const item = ITEMS.find(i => i.id === id)
    if (!item) return
    if (rpg.shards < item.price) {
      setLineKey(s => ({ key: 'poor', salt: s.salt + 1 }))
      return
    }
    buyItem(id)
    sfxChime()
    setLineKey(s => ({ key: 'buy', salt: s.salt + 1 }))
  }

  return (
    <div className="hub-split" data-testid="hub-shop">
      <NpcPortrait npc={elara} line={npcLine(elara, lineKey.key, lineKey.salt)} />
      <div className="hub-panel-scroll">
        <div className="hub-section-head">RELICS — SOCKET UP TO THREE</div>
        {relics.map(item => (
          <ShopRow
            key={item.id}
            item={item}
            owned={rpg.items[item.id] ?? 0}
            shards={rpg.shards}
            onBuy={onBuy}
          />
        ))}
        <div className="hub-section-head">RITES — CONSUMED IN THE DEEP (KEYS 1 / 2)</div>
        {rites.map(item => (
          <ShopRow
            key={item.id}
            item={item}
            owned={rpg.items[item.id] ?? 0}
            shards={rpg.shards}
            onBuy={onBuy}
          />
        ))}
        <div className="hub-footnote">
          Drop-only relics are taken from wardens, not bought. The ledger remembers.
        </div>
      </div>
    </div>
  )
}
