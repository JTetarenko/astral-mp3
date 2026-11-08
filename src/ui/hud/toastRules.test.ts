import { describe, expect, it } from 'vitest'
import type { FeedbackMsg } from '../../game/runState'
import { makeToastState, TOAST, updateToasts } from './toastRules'

let nextId = 0
function msg(kind: FeedbackMsg['kind'], at: number, title = `T${nextId}`): FeedbackMsg {
  return { id: nextId++, title, sub: '', kind, at }
}

describe('updateToasts', () => {
  it('admits toasted kinds and suppresses snap grades + kills', () => {
    const st = makeToastState()
    const feed = [msg('warden', 10), msg('perfect', 10), msg('kill', 10), msg('warn', 10.5)]
    updateToasts(st, feed, 10.6)
    // the admit gap staggers a same-drain burst: one now...
    expect(st.slots.filter(s => s.id >= 0).length).toBe(1)
    // ...the next on a later drain — grades/kills never admit at all
    updateToasts(st, feed, 10.9)
    const live = st.slots.filter(s => s.id >= 0)
    expect(live.length).toBe(2)
    expect(live.map(s => s.kind).sort()).toEqual(['warden', 'warn'])
  })

  it('expires after ttl and frees the slot', () => {
    const st = makeToastState()
    updateToasts(st, [msg('realm', 5)], 5)
    expect(st.slots.some(s => s.id >= 0)).toBe(true)
    updateToasts(st, [], 5 + TOAST.ttlSec + 0.01)
    expect(st.slots.every(s => s.id < 0)).toBe(true)
  })

  it('dedupes identical titles inside the window', () => {
    const st = makeToastState()
    const a = msg('warn', 20, 'SWARM SURGES')
    const b = msg('warn', 20.6, 'SWARM SURGES')
    updateToasts(st, [a], 20)
    updateToasts(st, [a, b], 20.6)
    expect(st.slots.filter(s => s.id >= 0).length).toBe(1)
  })

  it('rate-limits admissions and skips mount backlog', () => {
    const st = makeToastState()
    // two fresh events in the same drain: only the first admits this tick
    const feed = [msg('warn', 30, 'A'), msg('realm', 30, 'B')]
    updateToasts(st, feed, 30.05)
    expect(st.slots.filter(s => s.id >= 0).length).toBe(1)
    // stale event (pushed long before mount) never shows
    const st2 = makeToastState()
    updateToasts(st2, [msg('warden', 1, 'OLD')], 30)
    expect(st2.slots.every(s => s.id < 0)).toBe(true)
  })

  it('evicts the oldest slot when full', () => {
    const st = makeToastState()
    updateToasts(st, [msg('warn', 40, 'A')], 40)
    updateToasts(st, [msg('realm', 40.3, 'B')], 40.3)
    updateToasts(st, [msg('warden', 40.6, 'C')], 40.6)
    const titles = st.slots.filter(s => s.id >= 0).map(s => s.title)
    expect(titles).toContain('C')
    expect(titles).not.toContain('A')
  })
})
