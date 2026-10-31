import { describe, expect, test } from 'bun:test'

import { cutOffWords, cutOffs, midTurn, movedOn } from '../cutoff.ts'

/** How a Vibe conversation's record says it ended: it is not read for that (cutoff.ts). */

const ev = (type: string, at = '2026-10-26T01:00:00.000Z', more: Record<string, unknown> = {}) => JSON.stringify({ timestamp: at, type: 'event_msg', payload: { type, ...more } })

describe('a turn cut off', () => {
  test('Vibe’s record is not read for turns or prompts: never mid-turn, never moved on', () => {
    expect(midTurn([ev('task_started')].join('\n'))).toBe(false)
    expect(midTurn('')).toBe(false)
    expect(movedOn(ev('item_completed'), 0)).toBe(false)
  })

  test('Vibe writes nothing about background work a session’s end cut off, so none is found', () => {
    expect(cutOffs(ev('task_started'))).toEqual([])
  })

  test('a cut-off turn is said in words, with what opening it does', () => {
    const words = cutOffWords([{ at: 1, kind: 'turn', summary: 'Its turn was cut off when Kehikot restarted', tasks: 1 }])
    expect(words.said).toBe('its turn was cut off when Kehikot restarted')
    expect(words.detail).toContain('Open it to carry on')
  })
})
