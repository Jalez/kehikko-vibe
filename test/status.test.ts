import { describe, expect, test } from 'bun:test'

import { QUERY, REPLY, StatusReader, readReport } from '../status.ts'

/** Vibe's program status reports (OSC 7501), as its TUI writes them (`program_status.rs` in Vibe 3.0.4). */

const encode = (state: string, msg = '') => `\u001b]7501;state=${state}:app=vibe${msg ? `:msg=${Buffer.from(msg).toString('base64')}` : ''}\u001b\\`

describe('a report', () => {
  test('each state Vibe writes, and the kind of block', () => {
    expect(readReport('state=working:app=vibe')).toEqual({ state: 'working', kind: null })
    expect(readReport('state=blocked:kind=permission:app=vibe:msg=eA==')).toEqual({ state: 'blocked', kind: 'permission' })
    expect(readReport('state=blocked:kind=question:app=vibe')).toEqual({ state: 'blocked', kind: 'question' })
    expect(readReport('state=done:app=vibe')).toEqual({ state: 'done', kind: null })
    expect(readReport('state=error:app=vibe:msg=eA==')).toEqual({ state: 'error', kind: null })
    expect(readReport('state=idle:app=vibe')).toEqual({ state: 'idle', kind: null })
  })

  test('another program’s, or a word that is not a state, is nothing', () => {
    expect(readReport('state=working:app=other')).toBeNull()
    expect(readReport('state=sleeping:app=vibe')).toBeNull()
    expect(readReport('working')).toBeNull()
  })
})

describe('reading a terminal’s output', () => {
  test('the query, then reports in order, with the screen around them left alone', () => {
    const reader = new StatusReader()
    expect(QUERY).toBe(REPLY)
    const said = reader.feed(`\u001b[2J${QUERY}hello${encode('working', 'Fix the tests')}more${encode('done')}`)
    expect(said).toEqual({ asked: true, reports: [{ state: 'working', kind: null }, { state: 'done', kind: null }] })
  })

  test('a sequence split anywhere across reads is read once it ends', () => {
    const whole = encode('blocked:kind=question', 'Which colour?')
    for (let at = 1; at < whole.length; at++) {
      const reader = new StatusReader()
      const first = reader.feed(`x${whole.slice(0, at)}`)
      const second = reader.feed(`${whole.slice(at)}y`)
      expect([...first.reports, ...second.reports]).toEqual([{ state: 'blocked', kind: 'question' }])
    }
  })

  test('one ended by BEL is read too; one that never ends is not kept for ever', () => {
    const reader = new StatusReader()
    expect(reader.feed('\u001b]7501;state=done:app=vibe\u0007').reports).toEqual([{ state: 'done', kind: null }])
    reader.feed(`\u001b]7501;state=working:app=vibe:msg=${'A'.repeat(10_000)}`)
    expect(reader.feed('\u001b\\').reports).toEqual([])
  })
})
