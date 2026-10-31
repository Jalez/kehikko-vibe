import { afterEach, describe, expect, test } from 'bun:test'
import { act, cleanup, fireEvent, render } from '@testing-library/react'

import { contextOf, gaugeOf } from '../meter.ts'
import { metaOf } from '../program.ts'
import { CLEAR_ARMED, ContextLine, NO_SPLIT, type Command } from '../src/view/meter.tsx'

/** The line under the session on screen: what it says, its breakdown, and Compact and Clear. */

afterEach(cleanup)

const ID = '0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9'
const near = contextOf(gaugeOf(metaOf({ snapshot: { session: { id: ID, cwd: '/p', model: 'mistral-medium-3.5', updated_at: 1, context_usage: { input_tokens: 224_980, output_tokens: 20, total_tokens: 225_000, cached_input_tokens: 224_000 } } } })))!

function line(props: { ready?: string | null; context?: typeof near | null; armedMs?: number } = {}) {
  const sent: Command[] = []
  const view = render(
    <ContextLine context={props.context === undefined ? near : props.context} ready={props.ready ?? null} armedMs={props.armedMs} onCommand={(which) => (sent.push(which), true)} />,
  )
  const q = (selector: string) => view.container.querySelector(selector) as HTMLElement | null
  return { view, sent, q }
}

describe('the context line', () => {
  test('says the tokens in the context in words; with no window known, no share and no bar are made up', () => {
    const { q, view } = line()
    expect(q('[data-context-percent]')?.textContent).toBe('225k tokens')
    expect(q('[data-meter-bar]')).toBeNull()
    expect(view.container.textContent).not.toContain('%')
    expect(q('[data-context-trigger]')?.getAttribute('title')).toContain('225,000 tokens at the last request')
  })

  test('nothing sent yet is said as such', () => {
    const { q } = line({ context: null })
    expect(q('[data-context-percent]')?.textContent).toBe('nothing sent yet')
  })

  test('pressed, it opens a breakdown with the figures it has, and says what Vibe’s record does not; Escape closes it', () => {
    const { q } = line()
    fireEvent.click(q('[data-context-trigger]')!)
    const panel = q('[data-breakdown]')!
    expect(panel.textContent).toContain('225,000 tokens at the last request')
    expect(panel.textContent).toContain('Mistral Medium 3.5 (mistral-medium-3.5)')
    expect(panel.textContent).toContain('not in Vibe’s record of the conversation')
    expect(panel.textContent).toContain(NO_SPLIT)
    expect(q('[data-context-trigger]')?.getAttribute('aria-expanded')).toBe('true')
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(q('[data-breakdown]')).toBeNull()
  })

  test('Compact goes at once; Clear asks first, saying the session starts over and the old one is kept', () => {
    const { q, sent } = line()
    fireEvent.click(q('[data-command="compact"]')!)
    expect(sent).toEqual(['compact'])
    fireEvent.click(q('[data-command="clear"]')!)
    expect(sent).toEqual(['compact'])
    expect(q('[data-context-said]')?.textContent).toBe(CLEAR_ARMED)
    expect(CLEAR_ARMED).toContain('new conversation')
    expect(CLEAR_ARMED).toContain('This one is kept')
    expect(q('[data-command="clear"]')?.textContent).toBe('Clear: sure?')
    fireEvent.click(q('[data-command="clear"]')!)
    expect(sent).toEqual(['compact', 'clear'])
  })

  test('an armed Clear lets go by itself, and on Escape', async () => {
    const { q, sent } = line({ armedMs: 30 })
    fireEvent.click(q('[data-command="clear"]')!)
    await act(() => new Promise((done) => setTimeout(done, 60)))
    expect(q('[data-command="clear"]')?.textContent).toBe('Clear')
    fireEvent.click(q('[data-command="clear"]')!)
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    fireEvent.click(q('[data-command="clear"]')!)
    expect(sent).toEqual([])
  })

  test('while Vibe is working both wait, and a press says why in words', () => {
    const why = 'Vibe is working. Compact and Clear wait until it is back at its prompt.'
    const { q, sent, view } = line({ ready: why })
    expect(q('[data-command="compact"]')?.getAttribute('aria-disabled')).toBe('true')
    expect(q('[data-command="clear"]')?.getAttribute('title')).toBe(`Clear waits: ${why}`)
    fireEvent.click(q('[data-command="clear"]')!)
    fireEvent.click(q('[data-command="clear"]')!)
    fireEvent.click(q('[data-command="compact"]')!)
    expect(sent).toEqual([])
    expect(q('[data-context-said]')?.textContent).toBe(`Compact waits: ${why}`)
    expect(view.container.querySelector('[data-context-line]')?.getAttribute('data-ready')).toBe('no')
  })
})
