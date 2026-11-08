/**
 * The bow's rendered state this frame — written at the END of AstralBow's
 * useFrame (the avatarFrame contract). AstralBolts reads `manifest` to fade
 * its muzzle ember out as the real weapon takes over; BoltTrails seeds a
 * fresh tracer from the visible arrowhead when a loose just happened, so the
 * trail begins where the arrow was. Mount order guarantees same-frame reads:
 * AstralBow sits between PlayerAvatar and AstralBolts in PlayScene.
 */
export const bowFrame = {
  /** 0..1 materialize level of the bow rig (0 = dissolved/hidden). */
  manifest: 0,
  /** World position of the nocked arrow's head. */
  arrowTipX: 0,
  arrowTipY: 0,
  arrowTipZ: 0,
  /** Clock stamp of the newest loose (tracer handoff window). */
  lastLooseAt: -999,
}
