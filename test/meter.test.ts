import { afterAll, describe, expect, test } from 'bun:test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'

import { Gauges } from '../gauges.ts'
import { contextOf, contextWords, gaugeOf, modelName, tokensSaid } from '../meter.ts'
import { metaOf } from '../program.ts'
import { CONFIG } from './setup.ts'
import { counted, writeRollout } from './transcripts.ts'

/** The context meter, from a conversation's record (`context_usage` of its newest generation). */

afterAll(() => rmSync(join(CONFIG, 'logs'), { recursive: true, force: true }))

const ID = '0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9'
const meta = (usage: Record<string, number> | null, model: string | null = 'mistral-medium-3.5') => metaOf({ snapshot: { session: { id: ID, cwd: '/p', model, updated_at: 7, ...(usage ? { context_usage: usage } : {}) } } })

describe('what a record says', () => {
  test('the tokens in the context at the last request, with the split of that request, and the model', () => {
    const context = contextOf(gaugeOf(meta({ input_tokens: 9_950, output_tokens: 50, total_tokens: 10_000, cached_input_tokens: 4_000 })))!
    expect(context).toMatchObject({ tokens: 10_000, window: 0, windowSure: false, percent: null, soon: false, cost: null, compacted: null, from: 'record', at: 7 })
    expect(context.split).toEqual({ input: 5_950, cacheRead: 4_000, cacheWrite: 0, output: 50 })
    expect(context.model).toEqual({ id: 'mistral-medium-3.5', name: 'Mistral Medium 3.5' })
  })

  test('a record with nothing sent says nothing yet; one with no model and no usage is nothing', () => {
    expect(contextOf(gaugeOf(meta(null)))?.tokens).toBeNull()
    expect(contextOf(gaugeOf(meta(null, null)))).toBeNull()
    expect(contextOf(gaugeOf(null))).toBeNull()
  })
})

describe('the words', () => {
  test('the figure without a window, and never a warning made up from one', () => {
    const words = contextWords(contextOf(gaugeOf(meta({ input_tokens: 81_980, output_tokens: 20, total_tokens: 82_000, cached_input_tokens: 0 })))!)
    expect(words.line).toBe('82k in context')
    expect(words.warning).toBeNull()
    expect(words.title).toContain('82,000 tokens at the last request')
  })

  test('model names as a person reads them, and token counts', () => {
    expect(modelName('mistral-medium-3.5')).toBe('Mistral Medium 3.5')
    expect(modelName('devstral-small-latest')).toBe('Devstral Small Latest')
    expect(modelName('codestral-openrouter')).toBe('Codestral Openrouter')
    expect(modelName('zai-glm-5-3')).toBe('zai-glm-5-3')
    expect(tokensSaid(823)).toBe('823')
    expect(tokensSaid(182_400)).toBe('182k')
    expect(tokensSaid(1_000_000)).toBe('1.0M')
  })
})

describe('reading a record as it changes', () => {
  test('read again when the conversation is published again; nothing for a record that is not there', async () => {
    const gauges = new Gauges()
    const file = writeRollout(ID, '/p', [counted(1, 3_000)])
    expect((await gauges.read(file))?.tokens).toBe(3_000)
    writeRollout(ID, '/p', [counted(2, 5_000)], Date.now() + 1000)
    expect((await gauges.read(file))?.tokens).toBe(5_000)
    expect(await gauges.read(join(CONFIG, 'nothing', 'CURRENT'))).toBeNull()
    expect(await gauges.read(null)).toBeNull()
  })
})
