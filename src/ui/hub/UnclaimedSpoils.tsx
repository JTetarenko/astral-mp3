import { useGameStore } from '../../game/state'
import { DropChoice } from '../DropChoice'

/** Hub banner: a run's unclaimed choice-of-3 follows the player back to the
 * Sanctum until claimed (or dissolved by the next settlement). */
export function UnclaimedSpoils() {
  const pending = useGameStore(s => s.rpg.pendingDrops)
  if (!pending) return null
  return (
    <div className="unclaimed-spoils" data-testid="unclaimed-spoils">
      <DropChoice label="UNCLAIMED SPOILS — CHOOSE ONE" />
    </div>
  )
}
