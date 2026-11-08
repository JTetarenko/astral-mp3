import { useMemo, useState } from 'react'
import { sfxComplete } from '../../audio/sfx'
import { contractDef, contractGates, normalizeContracts } from '../../game/contracts'
import { describeItem } from '../../game/describe'
import { getItem } from '../../game/items'
import { npcLine, NPCS_BY_ID } from '../../game/npcs'
import { levelForXp } from '../../game/rpg'
import {
  bountyComplete,
  bountyForDay,
  normalizeBounty,
  questAvailability,
  QUESTS,
  type QuestDef,
} from '../../game/quests'
import { localDayString } from '../../game/rpgRun'
import { useGameStore } from '../../game/state'
import { NpcPortrait } from './NpcPortrait'

function rewardLabel(def: QuestDef): string {
  const parts = [`+${def.reward.xp} XP`]
  if (def.reward.shards > 0) parts.push(`+ᛝ${def.reward.shards}`)
  if (def.reward.itemId) {
    const item = getItem(def.reward.itemId)
    if (item) {
      parts.push(`${item.name}${(def.reward.itemCount ?? 1) > 1 ? ` ×${def.reward.itemCount}` : ''}`)
      // the item's first mechanical line, so a reward is never a mystery
      const line = describeItem(item).lines[0]
      if (line && line !== '—') parts.push(line)
    }
  }
  return parts.join(' · ')
}

/** Korr's hunt board: fixed chains + the rotating daily bounty. */
export function QuestsPanel() {
  const rpg = useGameStore(s => s.rpg)
  const acceptQuest = useGameStore(s => s.acceptQuest)
  const turnInQuest = useGameStore(s => s.turnInQuest)
  const claimBounty = useGameStore(s => s.claimBounty)
  const turnInContract = useGameStore(s => s.turnInContract)
  const korr = NPCS_BY_ID.korr
  const [lineKey, setLineKey] = useState<{ key: Parameters<typeof npcLine>[1]; salt: number }>({
    key: rpg.npcMet.korr ? 'questOffer' : 'greetingFirst',
    salt: 0,
  })

  const today = localDayString()
  const bounty = useMemo(() => normalizeBounty(rpg.bounty, today), [rpg.bounty, today])
  const bountyDef = bountyForDay(today)
  const bountyReady = bountyComplete(rpg.bounty, today)

  // display view: fill any empty unlocked slots (idempotent; the store
  // persists the same fill on enterHub / settlement)
  const contractView = useMemo(() => {
    const filled = normalizeContracts(
      rpg.contracts,
      levelForXp(rpg.xp),
      contractGates(rpg.quests),
    )
    return filled.slots.map((save, slot) => (save ? { save, slot, def: contractDef(save, slot) } : null))
  }, [rpg.contracts, rpg.xp, rpg.quests])
  const anyContracts = contractView.some(c => c !== null)

  const grouped = useMemo(() => {
    const offered: QuestDef[] = []
    const active: QuestDef[] = []
    const complete: QuestDef[] = []
    const archive: QuestDef[] = []
    for (const def of QUESTS) {
      const a = questAvailability(def, rpg.quests)
      if (a === 'offered') offered.push(def)
      else if (a === 'active') active.push(def)
      else if (a === 'complete') complete.push(def)
      else if (a === 'turnedIn') archive.push(def)
    }
    return { offered, active, complete, archive }
  }, [rpg.quests])

  return (
    <div className="hub-split" data-testid="hub-quests">
      <NpcPortrait npc={korr} line={npcLine(korr, lineKey.key, lineKey.salt)} />
      <div className="hub-panel-scroll">
        <div className="bounty-card">
          <div className="bounty-head">
            <span>TODAY&apos;S BOUNTY</span>
            <span className="bounty-reward">{rewardLabel(bountyDef)}</span>
          </div>
          <div className="quest-row-title">{bountyDef.title}</div>
          <div className="quest-row-brief">{bountyDef.brief}</div>
          <div className="quest-bar-row">
            <div className="quest-bar">
              <div
                className="quest-bar-fill"
                style={{
                  transform: `scaleX(${Math.min(1, bounty.progress / bountyDef.objective.target)})`,
                }}
              />
            </div>
            <span className="quest-nums">
              {bounty.claimed
                ? 'CLAIMED'
                : `${bounty.progress} / ${bountyDef.objective.target}`}
            </span>
            {bountyReady && (
              <button
                className="btn quest-turnin"
                data-testid="bounty-claim"
                onClick={() => {
                  claimBounty()
                  sfxComplete()
                  setLineKey(s => ({ key: 'turnIn', salt: s.salt + 1 }))
                }}
              >
                CLAIM
              </button>
            )}
          </div>
        </div>

        {anyContracts && <div className="hub-section-head">STANDING CONTRACTS</div>}
        {contractView.map(entry => {
          if (!entry) return null
          const { save, slot, def } = entry
          const done = save.state === 'complete'
          return (
            <div
              key={def.id}
              className={`quest-row${done ? ' quest-complete' : ''}`}
              data-testid={`contract-${slot}`}
            >
              <div className="quest-row-main">
                <span className="quest-row-title">
                  {def.title}
                  <em className="contract-giver"> — {def.giver.toUpperCase()}</em>
                </span>
                <span className="quest-row-brief">{def.brief}</span>
                <span className="quest-row-reward">{rewardLabel(def)}</span>
                {!done && (
                  <div className="quest-bar-row">
                    <div className="quest-bar">
                      <div
                        className="quest-bar-fill"
                        style={{
                          transform: `scaleX(${Math.min(1, save.progress / def.objective.target)})`,
                        }}
                      />
                    </div>
                    <span className="quest-nums">
                      {save.progress} / {def.objective.target}
                    </span>
                  </div>
                )}
              </div>
              {done && (
                <button
                  className="btn quest-turnin"
                  data-testid={`contract-turnin-${slot}`}
                  onClick={() => {
                    turnInContract(slot as 0 | 1 | 2)
                    sfxComplete()
                    setLineKey(s => ({ key: 'contract', salt: s.salt + 1 }))
                  }}
                >
                  TURN IN
                </button>
              )}
            </div>
          )
        })}

        {grouped.complete.length > 0 && <div className="hub-section-head">SETTLE THE DEBT</div>}
        {grouped.complete.map(def => (
          <div key={def.id} className="quest-row quest-complete" data-testid={`quest-${def.id}`}>
            <div className="quest-row-main">
              <span className="quest-row-title">{def.title}</span>
              <span className="quest-row-brief">{rewardLabel(def)}</span>
            </div>
            <button
              className="btn quest-turnin"
              data-testid={`quest-turnin-${def.id}`}
              onClick={() => {
                turnInQuest(def.id)
                sfxComplete()
                setLineKey(s => ({ key: 'turnIn', salt: s.salt + 1 }))
              }}
            >
              TURN IN
            </button>
          </div>
        ))}

        {grouped.active.length > 0 && <div className="hub-section-head">THE HUNT</div>}
        {grouped.active.map(def => {
          const save = rpg.quests[def.id]
          return (
            <div key={def.id} className="quest-row" data-testid={`quest-${def.id}`}>
              <div className="quest-row-main">
                <span className="quest-row-title">{def.title}</span>
                <span className="quest-row-brief">{def.brief}</span>
                <div className="quest-bar-row">
                  <div className="quest-bar">
                    <div
                      className="quest-bar-fill"
                      style={{
                        transform: `scaleX(${Math.min(1, (save?.progress ?? 0) / def.objective.target)})`,
                      }}
                    />
                  </div>
                  <span className="quest-nums">
                    {save?.progress ?? 0} / {def.objective.target}
                  </span>
                </div>
              </div>
            </div>
          )
        })}

        {grouped.offered.length > 0 && <div className="hub-section-head">OFFERED</div>}
        {grouped.offered.map(def => (
          <div key={def.id} className="quest-row" data-testid={`quest-${def.id}`}>
            <div className="quest-row-main">
              <span className="quest-row-title">{def.title}</span>
              <span className="quest-row-brief">{def.brief}</span>
              <span className="quest-row-reward">{rewardLabel(def)}</span>
            </div>
            <button
              className="btn btn-ghost"
              data-testid={`quest-accept-${def.id}`}
              onClick={() => {
                acceptQuest(def.id)
                setLineKey(s => ({ key: 'questOffer', salt: s.salt + 1 }))
              }}
            >
              ACCEPT
            </button>
          </div>
        ))}

        {grouped.archive.length > 0 && (
          <div className="hub-footnote">
            SETTLED — {grouped.archive.map(d => d.title).join(' · ')}
          </div>
        )}
      </div>
    </div>
  )
}
