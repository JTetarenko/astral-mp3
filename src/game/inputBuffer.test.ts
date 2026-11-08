import { describe, expect, it } from 'vitest'
import { INPUT_BUF_SEC, makePressBuffer, press, tickBuffer, tryConsume, clearBuffer } from './inputBuffer'

describe('inputBuffer', () => {
  it('press then consume within the window', () => {
    const b = makePressBuffer()
    press(b)
    tickBuffer(b, 0.1)
    expect(tryConsume(b)).toBe(true)
    expect(tryConsume(b)).toBe(false) // consumed clears
  })

  it('expires after INPUT_BUF_SEC of ticks', () => {
    const b = makePressBuffer()
    press(b)
    for (let i = 0; i < 10; i++) tickBuffer(b, INPUT_BUF_SEC / 8)
    expect(tryConsume(b)).toBe(false)
  })

  it('re-press refreshes, never stacks', () => {
    const b = makePressBuffer()
    press(b)
    tickBuffer(b, INPUT_BUF_SEC * 0.9)
    press(b)
    expect(b.t).toBe(INPUT_BUF_SEC)
    tickBuffer(b, INPUT_BUF_SEC * 0.9)
    expect(tryConsume(b)).toBe(true)
    // consuming once must not leave a second press behind
    expect(tryConsume(b)).toBe(false)
  })

  it('clearBuffer empties a pending press', () => {
    const b = makePressBuffer()
    press(b)
    clearBuffer(b)
    expect(tryConsume(b)).toBe(false)
  })
})
