/**
 * Toast selection over the runState.feedback ring: which kinds surface, how
 * long they live, how spam is throttled. Pure — the Hud renderer feeds it
 * the ring + wall clock and stamps the returned slots into fixed DOM nodes.
 * Snap grades (perfect/good/ok/beat) and kills are SUPPRESSED here: the
 * reticle band-flash and damage bubbles carry those with less noise.
 */
import type { FeedbackKind, FeedbackMsg } from '../../game/runState'

export const TOAST = {
  /** Visible slots. */
  slots: 2,
  /** Seconds a toast lives. */
  ttlSec: 2.2,
  /** Min seconds between admissions (queue spikes drain gently). */
  admitGapSec: 0.25,
  /** Repeated identical titles inside this window dedupe. */
  dedupeSec: 1.5,
  /** Events older than this at drain time are mount backlog — skip. */
  staleSec: 4,
} as const

const TOASTED: ReadonlySet<FeedbackKind> = new Set([
  'complete',
  'descent',
  'realm',
  'warden',
  'downed',
  'warn',
  'latch',
  'nova',
] as FeedbackKind[])

export interface ToastSlot {
  /** Feedback id occupying the slot; -1 empty. */
  id: number
  title: string
  sub: string
  kind: FeedbackKind
  /** Wall-clock seconds the toast was admitted. */
  shownAt: number
}

export interface ToastState {
  slots: ToastSlot[]
  lastSeenId: number
  lastAdmitAt: number
  lastTitle: string
  lastTitleAt: number
}

export function makeToastState(lastSeenId = -1): ToastState {
  return {
    slots: Array.from({ length: TOAST.slots }, () => ({
      id: -1,
      title: '',
      sub: '',
      kind: 'warn' as FeedbackKind,
      shownAt: -999,
    })),
    lastSeenId,
    lastAdmitAt: -999,
    lastTitle: '',
    lastTitleAt: -999,
  }
}

/**
 * Drain new feedback into the slots and expire old toasts. Returns true when
 * any slot changed (the renderer diffs to skip DOM writes). Zero allocation.
 */
export function updateToasts(state: ToastState, feedback: FeedbackMsg[], now: number): boolean {
  let changed = false
  // expire
  for (const slot of state.slots) {
    if (slot.id >= 0 && now - slot.shownAt > TOAST.ttlSec) {
      slot.id = -1
      changed = true
    }
  }
  // admit (oldest first; the ring is already push-ordered). Suppressed /
  // stale / duplicate messages are consumed-and-dropped; a message blocked
  // ONLY by the admit gap is DEFERRED — the next drain retries it.
  for (const msg of feedback) {
    if (msg.id <= state.lastSeenId) continue
    if (
      !TOASTED.has(msg.kind) ||
      now - msg.at > TOAST.staleSec ||
      (msg.title === state.lastTitle && now - state.lastTitleAt < TOAST.dedupeSec)
    ) {
      state.lastSeenId = msg.id
      continue
    }
    if (now - state.lastAdmitAt < TOAST.admitGapSec) break
    state.lastSeenId = msg.id
    // take the empty slot, else evict the oldest
    let pick = -1
    let oldest = Infinity
    for (let i = 0; i < state.slots.length; i++) {
      const s = state.slots[i]
      if (s.id < 0) {
        pick = i
        break
      }
      if (s.shownAt < oldest) {
        oldest = s.shownAt
        pick = i
      }
    }
    const slot = state.slots[pick]
    slot.id = msg.id
    slot.title = msg.title
    slot.sub = msg.sub
    slot.kind = msg.kind
    slot.shownAt = now
    state.lastAdmitAt = now
    state.lastTitle = msg.title
    state.lastTitleAt = now
    changed = true
  }
  return changed
}
