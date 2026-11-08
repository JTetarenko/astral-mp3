/**
 * The avatar's rendered attitude this frame — written at the END of
 * PlayerAvatar's useFrame (root position incl. hover bob + smoothed yaw,
 * body pitch/roll). Latched horrors compose their cling matrices from this
 * so they ride the exact rendered body with zero frame lag. HorrorSwarm
 * mounts after PlayerAvatar to read same-frame values.
 */
export const avatarFrame = {
  x: 0,
  y: 0,
  z: 0,
  yaw: 0,
  pitch: 0,
  roll: 0,
  /** False while first-person/occluded (the avatar early-outs its pose). */
  visible: false,
}
