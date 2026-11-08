/**
 * Sticky press intents: a click that lands mid-animation survives until the
 * first frame the action becomes legal, instead of being dropped (the old
 * snapQueued/novaQueued booleans were cleared unconditionally — clicking
 * 30ms before a pull ended ate the input). Ticked with REAL dt: a buffered
 * press must not live longer through a hit-stop. Pure — node-tested.
 */

export const INPUT_BUF_SEC = 0.25

export interface PressBuffer {
  /** Seconds remaining; 0 = empty. */
  t: number
}

export function makePressBuffer(): PressBuffer {
  return { t: 0 }
}

/** Register a press. Re-pressing refreshes the window, never stacks. */
export function press(b: PressBuffer): void {
  b.t = INPUT_BUF_SEC
}

/** Age the buffer with REAL dt. */
export function tickBuffer(b: PressBuffer, dt: number): void {
  if (b.t > 0) b.t = Math.max(0, b.t - dt)
}

/** Consume the press if one is pending. */
export function tryConsume(b: PressBuffer): boolean {
  if (b.t > 0) {
    b.t = 0
    return true
  }
  return false
}

export function clearBuffer(b: PressBuffer): void {
  b.t = 0
}
