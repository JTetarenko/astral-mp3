import type { ItemDef } from '../../game/items'
import { runeMaskStyle } from '../fx/menuGlyphs'
import { ItemTooltip } from './ItemTooltip'

/**
 * Shared item glyph tile: rune-atlas icon inside a rarity-tinted notched
 * frame. Rarity drives the border color via the --rarity custom property;
 * kind drives the frame silhouette class. Hover/focus opens the real
 * ItemTooltip (stat lines, not just flavor) — the native title is gone.
 */
export function ItemTile({
  item,
  count = 0,
  socketed = false,
  disabled = false,
  onClick,
  testId,
  compare,
}: {
  item: ItemDef
  count?: number
  socketed?: boolean
  disabled?: boolean
  onClick?: () => void
  testId?: string
  /** Socketed relics for the tooltip's compare lines. */
  compare?: ItemDef[]
}) {
  const cls = [
    'item-tile',
    `rarity-${item.rarity}`,
    `kind-${item.kind}`,
    socketed ? 'socketed' : '',
    disabled ? 'tile-disabled' : '',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <ItemTooltip item={item} compare={compare}>
      <button
        type="button"
        className={cls}
        onClick={onClick}
        disabled={disabled || !onClick}
        data-testid={testId}
      >
        <i className="atlas-rune tile-rune" style={runeMaskStyle(item.glyph)} />
        {count > 1 && <span className="tile-count">{count}</span>}
        {socketed && <span className="tile-socket-mark">◆</span>}
      </button>
    </ItemTooltip>
  )
}
