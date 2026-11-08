import { useEffect, useMemo, useState } from 'react'
import { NPCS } from '../../game/npcs'
import { bountyComplete } from '../../game/quests'
import { localDayString } from '../../game/rpgRun'
import { useGameStore } from '../../game/state'
import { GlitchText } from '../fx/GlitchText'
import { MenuAtmosphere } from '../fx/MenuAtmosphere'
import { runeMaskStyle } from '../fx/menuGlyphs'
import { CharacterPanel } from './CharacterPanel'
import { InventoryPanel } from './InventoryPanel'
import { QuestsPanel } from './QuestsPanel'
import { ShopPanel } from './ShopPanel'

type HubTab = 'shop' | 'quests' | 'character' | 'inventory'

const TABS: Array<[HubTab, string]> = [
  ['shop', 'LEDGER'],
  ['quests', 'THE HUNT'],
  ['character', 'MIRROR'],
  ['inventory', 'RELIQUARY'],
]

/**
 * THE SANCTUM — the between-run hub where the keepers wait: Elara's shop,
 * Korr's hunt board, Vess's attunement mirror, and the reliquary. Pure DOM
 * in the menu house style (gilded ashGold theme, applied by App).
 */
export function HubScreen() {
  const rpg = useGameStore(s => s.rpg)
  const leaveHub = useGameStore(s => s.leaveHub)
  const markNpcMet = useGameStore(s => s.markNpcMet)

  // land on the hunt when a debt is claimable, else the ledger
  const initialTab = useMemo<HubTab>(() => {
    const anyComplete = Object.values(rpg.quests).some(q => q.state === 'complete')
    if (anyComplete || bountyComplete(rpg.bounty, localDayString())) return 'quests'
    return 'shop'
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [tab, setTab] = useState<HubTab>(initialTab)

  // first meetings are marked as their keeper's tab is opened
  useEffect(() => {
    const npcId = tab === 'shop' ? 'elara' : tab === 'quests' ? 'korr' : tab === 'character' ? 'vess' : null
    if (npcId && !rpg.npcMet[npcId]) markNpcMet(npcId)
  }, [tab, rpg.npcMet, markNpcMet])

  return (
    <div className="screen hub-screen" data-testid="hub">
      <MenuAtmosphere />
      <div className="hub-core">
        <header className="hub-head">
          <GlitchText as="h1" className="brand hub-brand" text="THE SANCTUM" />
          <div className="hub-keepers">
            {NPCS.map(n => (
              <i key={n.id} className="atlas-rune keeper-rune" style={runeMaskStyle(n.glyph)} />
            ))}
          </div>
        </header>

        <div className="hub-bar">
          <nav className="hub-tabs">
            {TABS.map(([id, label]) => (
              <button
                key={id}
                className={`hub-tab${tab === id ? ' active' : ''}`}
                onClick={() => setTab(id)}
                data-testid={`hub-tab-${id}`}
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="shard-chip" data-testid="shard-count">
            <i className="atlas-rune shard-rune" style={runeMaskStyle(4)} />
            {rpg.shards.toLocaleString()} SHARDS
          </div>
        </div>

        <div className="hub-panel panel">
          {tab === 'shop' && <ShopPanel />}
          {tab === 'quests' && <QuestsPanel />}
          {tab === 'character' && <CharacterPanel />}
          {tab === 'inventory' && <InventoryPanel />}
        </div>

        <button className="btn hub-depart" onClick={leaveHub} data-testid="hub-depart">
          DEPART — CHOOSE AN OFFERING
        </button>
      </div>
    </div>
  )
}
