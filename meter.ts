import type { Meta } from './program.ts'

/**
 * How full a conversation's context is, and the rest of what Vibe's own `/status` says about a
 * session — read without anybody typing anything into it.
 *
 * ## Where the figures come from, and it is the whole list
 *
 * **The conversation's newest generation** (`<save_dir>/unified/<id>/CURRENT`, which names
 * `generations/<g>/projection-state.json`): Vibe 3.0.4 writes the public session there each time
 * it publishes the conversation, with
 *
 *     snapshot.session.context_usage  { input_tokens, output_tokens, total_tokens, cached_input_tokens }
 *     snapshot.session.model          the model alias the session runs on
 *
 * `context_usage` is what was in the window at the last request (`_projection.py`). Only these
 * numbers and the model's name are kept; the conversation's history is not in that file (Vibe keeps
 * it apart, in chunks) and is never read for this.
 *
 * ## What cannot be known from here, and it is said rather than guessed
 *
 *  - **The window.** Vibe takes it from the model's preset (`max_context_length`) or its catalogue,
 *    neither of which is in the conversation's record; this module reads no config of the person's.
 *    So the meter says the tokens in the context, not a share of a window.
 *  - **The cost.** Vibe prices a run from prices in the person's config, and says itself they may
 *    be missing or out of date. `cost` is always null.
 *  - **Compactions.** Not in the public session. Never counted.
 */

/** The window a session runs with: never known from the record (see above). */
export function windowFor(said: number | null): { window: number; sure: boolean } {
  if (said !== null && Number.isFinite(said) && said > 0) return { window: said, sure: true }
  return { window: 0, sure: false }
}

/** Where "compacts soon" would start, for a window that is known; none here. */
export function thresholds(window: number): { compactAt: number; warnAt: number; effective: number } {
  return { compactAt: window, warnAt: Math.max(0, window - Math.round(window * 0.1)), effective: window }
}

export const percentOf = (tokens: number, window: number): number => (window > 0 ? Math.min(100, Math.max(0, Math.round((tokens / window) * 100))) : 0)

/** One request's own numbers. `input` is what was sent new, `cacheRead` and `cacheWrite` what the prompt cache read and wrote. */
export interface Usage {
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
}

export interface Compaction {
  at: number | null
  trigger: string
  before: number | null
  after: number | null
}

/** What a conversation's record says. */
export interface Gauge {
  model: string | null
  usage: Usage | null
  /** The tokens in the context at the last request. */
  tokens: number | null
  window: number | null
  usageAt: number | null
  compactions: number
  last: Compaction | null
  compactedSince: boolean
  personTurn: boolean
  cost: number | null
  costSince: boolean
}

export const emptyGauge = (): Gauge => ({ model: null, usage: null, tokens: null, window: null, usageAt: null, compactions: 0, last: null, compactedSince: false, personTurn: false, cost: null, costSince: false })

/** The gauge a conversation's meta says (program.ts `metaOf`). */
export function gaugeOf(meta: Meta | null): Gauge | null {
  if (!meta) return null
  const gauge = emptyGauge()
  if (meta.model) gauge.model = meta.model
  if (meta.context) {
    const cached = Math.min(meta.context.input, meta.context.cached)
    gauge.tokens = meta.context.total
    gauge.usage = { input: meta.context.input - cached, cacheRead: cached, cacheWrite: 0, output: meta.context.output }
    gauge.usageAt = meta.updatedAt
  }
  return gauge
}

/** A model's name as a person reads it: `mistral-medium-3.5` is "Mistral Medium 3.5"; anything else as written. */
export function modelName(id: string): string {
  const said = /^(mistral|devstral|codestral|magistral|ministral)-(.+)$/i.exec(id.trim())
  if (!said) return id.trim().slice(0, 40)
  const family = said[1]!.charAt(0).toUpperCase() + said[1]!.slice(1).toLowerCase()
  const rest = said[2]!.split('-').filter(Boolean).map((word) => (/^\d/.test(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
  return [family, ...rest].join(' ').slice(0, 40)
}

/** A session's context, whole: what the page draws, the list's rows carry and the MCP tool says. */
export interface Context {
  /** The tokens in the window now, or null when nothing has been sent yet. */
  tokens: number | null
  window: number
  /** Whether the window is known. Never, for Vibe (see above). */
  windowSure: boolean
  percent: number | null
  compactAt: number
  warnAt: number
  effective: number
  soon: boolean
  model: { id: string; name: string } | null
  /** Always null: see above. Kept in the shape the page and the door share. */
  cost: { usd: number; live: boolean } | null
  compacted: { times: number; last: Compaction } | null
  /** A compaction is the last thing read: the figure is the one Vibe counted for what it compacted to. */
  afterCompact: boolean
  split: Usage | null
  from: 'record'
  at: number | null
}

/** What is shown for a session, from its record. Null when it says nothing yet. */
export function contextOf(gauge: Gauge | null): Context | null {
  if (!gauge) return null
  const { window, sure } = windowFor(gauge.window)
  if (gauge.tokens === null && !gauge.model && !gauge.compactions) return null
  const { compactAt, warnAt, effective } = thresholds(window)
  const tokens = gauge.tokens
  return {
    tokens,
    window,
    windowSure: sure,
    percent: tokens === null || window === 0 ? null : percentOf(tokens, window),
    compactAt,
    warnAt,
    effective,
    soon: tokens !== null && window > 0 && tokens >= warnAt,
    model: gauge.model ? { id: gauge.model, name: modelName(gauge.model) } : null,
    cost: null,
    compacted: gauge.compactions && gauge.last ? { times: gauge.compactions, last: gauge.last } : null,
    afterCompact: Boolean(gauge.last && gauge.last.after !== null && gauge.usageAt !== null && gauge.last.at !== null && gauge.usageAt - gauge.last.at < 1_000),
    split: gauge.usage,
    from: 'record',
    at: gauge.usageAt,
  }
}

/** A number of tokens as a person reads it: 823, 12k, 182k, 1.0M. */
export function tokensSaid(tokens: number): string {
  if (tokens < 1_000) return String(tokens)
  if (tokens < 999_500) return `${Math.round(tokens / 1_000)}k`
  return `${(tokens / 1_000_000).toFixed(1)}M`
}

/** Dollars as a person reads them. Never said for Vibe; kept for the page's shared code. */
export function costSaid(usd: number): string {
  return usd >= 100 ? `$${Math.round(usd)}` : `$${usd.toFixed(2)}`
}

/**
 * A context in words: the share (`41%`), the line beside a meter (`82k of 258k · 41%`), and the
 * warning, in words and never by colour alone (`82% — compacts soon`).
 */
export function contextWords(context: Context): { percent: string; line: string; warning: string | null; title: string } {
  const pct = context.percent === null ? '—' : `${context.percent}%`
  const about = context.afterCompact ? 'about ' : ''
  const line = context.tokens === null ? 'nothing sent yet' : context.window ? `${about}${tokensSaid(context.tokens)} of ${tokensSaid(context.window)} · ${pct}` : `${about}${tokensSaid(context.tokens)} in context`
  const warning = context.soon ? (context.tokens !== null && context.tokens >= context.compactAt ? `${pct} — compacting` : `${pct} — compacts soon`) : null
  const parts = [
    context.tokens === null ? 'Context: nothing sent yet in this conversation' : context.window ? `Context: ${about}${context.tokens.toLocaleString('en-US')} of ${context.window.toLocaleString('en-US')} tokens (${pct})` : `Context: ${about}${context.tokens.toLocaleString('en-US')} tokens at the last request`,
    context.window ? `compacts by itself at about ${percentOf(context.compactAt, context.window)}%` : '',
    context.model ? context.model.name : '',
    context.compacted ? `compacted ${context.compacted.times === 1 ? 'once' : `${context.compacted.times} times`}` : '',
  ]
  return { percent: pct, line, warning, title: parts.filter(Boolean).join(' · ') }
}
