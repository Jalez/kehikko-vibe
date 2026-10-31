import { existsSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { unifiedRoot } from '../program.ts'

/**
 * Vibe records, written where Vibe 3.0.4 writes them — `<save_dir>/unified/<id>/CURRENT`, naming
 * `generations/<g>/projection-state.json`, under the scratch `VIBE_HOME` of test/setup.ts — in the
 * shape it writes (see program.ts), with everything but the shape taken out.
 *
 * The helpers below (`typed`, `counted`, …) are rows as other tests describe a conversation; a
 * record is made of what they say: the first thing typed is its preview, the last count its tokens.
 */
export const T0 = Date.parse('2026-10-21T17:30:00.000Z')
const iso = (at: number) => new Date(at).toISOString()

let written = 0

/** Where a session's record (its `CURRENT`) is. */
export function rolloutPath(id: string): string {
  return join(unifiedRoot(), id, 'CURRENT')
}

/** A session's record: its folder (`cwd`), then what `rows` say. `when` sets its time. `more` goes into the public session. */
export function writeRollout(id: string, cwd: string, rows: string[] = [], when?: string | number, more: Record<string, unknown> = {}): string {
  removeRollout(id)
  written += 1
  const generation = String(written).padStart(16, '0')
  const dir = join(unifiedRoot(), id)
  mkdirSync(join(dir, 'generations', generation), { recursive: true })
  let preview = ''
  let tokens: number | null = null
  for (const raw of rows) {
    try {
      const row = JSON.parse(raw) as { payload?: { type?: string; item?: { content?: { text?: string }[] }; info?: { last_token_usage?: { total_tokens?: number } } } }
      if (row.payload?.type === 'item_completed' && !preview) preview = row.payload.item?.content?.[0]?.text ?? ''
      if (row.payload?.type === 'token_count') tokens = row.payload.info?.last_token_usage?.total_tokens ?? tokens
    } catch {
      /* Not a row. */
    }
  }
  const at = when === undefined ? T0 : typeof when === 'number' ? when : Date.parse(when)
  const session = { id, parent_session_id: null, title: null, preview, status: { type: 'idle' }, created_at: T0, updated_at: at, cwd, model: 'mistral-medium-3.5', ...(tokens !== null ? { context_usage: { input_tokens: tokens - 20, output_tokens: 20, total_tokens: tokens, cached_input_tokens: 0 } } : {}), ...more }
  writeFileSync(join(dir, 'generations', generation, 'projection-state.json'), JSON.stringify({ projection_state_version: 1, session_id: id, snapshot_sequence: written, watermark: 0, snapshot: { format: 'vibe.public-session-state/v1', event_id: 0, session, history: null } }))
  const file = rolloutPath(id)
  writeFileSync(file, JSON.stringify({ store_format: 'mistral.vibe.unified-session-store/v1', session_id: id, generation, snapshot_sequence: written, manifest_sha256: '0'.repeat(64) }))
  if (when !== undefined) utimesSync(file, new Date(at), new Date(at))
  return file
}

export function removeRollout(id: string): void {
  const dir = join(unifiedRoot(), id)
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
}

/** A prompt the person typed. */
export const typed = (at: number, text = 'carry on') => JSON.stringify({ timestamp: iso(at), type: 'event_msg', payload: { type: 'item_completed', item: { type: 'UserMessage', content: [{ type: 'text', text }] } } })
export const started = (at: number) => JSON.stringify({ timestamp: iso(at), type: 'event_msg', payload: { type: 'task_started' } })
export const completed = (at: number) => JSON.stringify({ timestamp: iso(at), type: 'event_msg', payload: { type: 'task_complete' } })
/** The tokens in the context at the last request. */
export const counted = (at: number, total: number) => JSON.stringify({ timestamp: iso(at), type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { total_tokens: total } } } })
