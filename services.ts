import {
  CONVERSATION_MATCHES,
  agentTaskStartParams,
  conversationsBringParams,
  conversationsFindParams,
  type AgentTaskStartResult,
  type ConversationCandidate,
  type ConversationMatch,
  type ConversationPlace,
  type ConversationsBringResult,
} from 'kehikot-module-protocol'
import { vouchHost, type Before } from 'kehikot-module-protocol/serve'

import { freshToken } from './doorConfig.ts'
import { placeOf, theRuns, type Runs } from './live.ts'
import { placeKey } from './place.ts'
import { PROGRAM, type Program } from './program.ts'
import { assign, disconnect, homeOf, projectRoot, readPlaces, recordedIds, tokenFor, type NamedPlace, type Places } from './record.ts'

/**
 * The two services Kehikot itself calls on this module (protocol 2.88.0), when a person adopts a
 * tracker item that belongs to no epic:
 *
 * - `conversations.finder`: which Vibe conversations of the project worked on it (`find`), and filing
 *   one of them under a place (`bring`) — the record write `/kehikot-here` and "Assign here" do
 *   (`assign` in record.ts), and its undo the one "Disconnect" does (`disconnect`).
 * - `agent.tasks`: a NEW conversation fed a brief (`start`, `Runs.startTask` in live.ts), shown on its
 *   own at `/app?session=…`.
 *
 * Every route answers only the host's own server (`vouchHost`): no page, agent or other module.
 *
 * ## What `find` can know, and what it cannot
 *
 * Only what this module already reads of a Vibe conversation: its record's projection (`describe` in
 * program.ts) — the folder it ran in, its title and its preview (the first thing said in it). Vibe's
 * history chunks and journal are never read (CLAUDE.md), and nothing there names a git branch or a
 * command it ran. So of the protocol's kinds this module can say only two, honestly:
 *
 * - `mentioned`: its title or preview names the change (a ref's spelling, its URL or its branch);
 * - `folder`: it ran in the project's folder.
 *
 * Never `created`, `pushed` or `branch`, which a host brings along by itself: nothing here shows them.
 * Titles and reasons are all that leave; never the preview's words.
 */

export const FIND_PATH = '/api/conversations/find'
export const BRING_PATH = '/api/conversations/bring'
export const START_PATH = '/api/tasks/start'

/** What the services need, so a test can stand each in. */
export interface ServiceNeeds {
  program: Program
  runs: Pick<Runs, 'find' | 'running' | 'told' | 'startTask'>
  vouch: (headers: Headers) => Promise<{ ok: true } | { ok: false; why: string }>
}


/** A protocol place as this module's record names one: the kehikko by its key, the parts sorted. */
export function namedPlace(place: ConversationPlace): NamedPlace {
  return { epic: place.epic, parts: [...place.parts], kehikko: place.kehikko ? { key: place.kehikko } : null }
}

/** Where a conversation is filed in a record, as the protocol says a place: null for none, or for a place filed under an old row number the protocol cannot name. */
function filedAt(places: Places, id: string): { key: string | null; place: ConversationPlace | null } {
  const key = homeOf(places, id)
  if (!key || !Object.hasOwn(places.places, key)) return { key: null, place: null }
  const named = placeOf(places.places[key]!)
  const kehikko = named.kehikko && 'key' in named.kehikko ? named.kehikko.key : null
  if (named.kehikko && !kehikko) return { key, place: null }
  return { key, place: { epic: named.epic, parts: named.parts, kehikko } }
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Whether `text` names `word` as a word of its own: not inside a longer ref, branch or number. */
function names(text: string, word: string): boolean {
  const said = word.trim()
  if (said.length < 2) return false
  return new RegExp(`(?:^|[^\\w/.#!-])${escape(said)}(?![\\w/-])`, 'i').test(text)
}

/** The first of what the host knows of the change that the text names, in the words of a reason; null for none. */
function mention(text: string, asked: { refs: string[]; url?: string; branch?: string }): string | null {
  for (const ref of asked.refs) if (names(text, ref)) return `mentioned ${ref}`
  if (asked.url && asked.url.length > 8 && text.includes(asked.url)) return `mentioned ${asked.url}`
  if (asked.branch && names(text, asked.branch)) return `mentioned branch ${asked.branch}`
  return null
}

const rank = (match: ConversationMatch) => CONVERSATION_MATCHES.indexOf(match)

/** `find`: the project's Vibe conversations that worked on the change, strongest first, at most 20. */
export async function findConversations(raw: unknown, needs: ServiceNeeds): Promise<{ status: number; body: unknown }> {
  const parsed = conversationsFindParams.safeParse(raw)
  if (!parsed.success) return { status: 400, body: { ok: false, error: 'That is not a find: { project, refs, url?, branch?, repo? }.' } }
  const asked = parsed.data
  const root = projectRoot(asked.project)
  if (!root.ok) return { status: 400, body: { ok: false, error: root.error } }
  const read = readPlaces(root.value)
  const places = read.ok ? read.value : { version: 1 as const, places: {}, sessions: {} }
  /* Vibe's own list for the folder, and whatever this project's record names (a renamed folder). */
  const recorded = await needs.program.sessions(root.value, recordedIds(places))
  const running = await needs.runs.running().catch(() => ({ known: false as const, why: 'failed' as const }))
  const leased = new Set(running.known ? running.active.map((one) => one.session) : [])
  const out: ConversationCandidate[] = []
  for (const one of recorded) {
    if (places.sessions[one.id]?.ignored) continue
    const said = mention([one.label, one.firstPrompt ?? '', one.lastPrompt ?? ''].join('\n'), asked)
    const match: ConversationMatch = said ? 'mentioned' : 'folder'
    const run = needs.runs.find(one.id)
    out.push({
      session: one.id,
      title: one.label || places.sessions[one.id]?.label || '',
      folder: root.value,
      lastActive: Math.max(0, Math.floor(one.lastActive || 0)),
      match,
      reason: said ?? 'worked in this repository',
      place: filedAt(places, one.id).place,
      running: Boolean(run && !run.ended) || leased.has(one.id),
    })
  }
  out.sort((a, b) => rank(a.match) - rank(b.match) || b.lastActive - a.lastActive)
  return { status: 200, body: { conversations: out.slice(0, 20) } }
}

/**
 * `bring`: a compare-and-set of one conversation's place. Taken only when it is filed under `from`
 * now (null: under none); otherwise `elsewhere`, with where it is, and nothing is written. Under `to`
 * is what `/kehikot-here` writes (`assign`, and its token); under no place what "Disconnect" writes
 * (`disconnect`). A run this process holds reads its place from the record, so it has the new place
 * at once (`resumed`); any other is told it when this module next resumes it. Nothing is restarted.
 */
export async function bringConversation(raw: unknown, needs: ServiceNeeds): Promise<{ status: number; body: ConversationsBringResult | { ok: false; error: string } }> {
  const parsed = conversationsBringParams.safeParse(raw)
  if (!parsed.success) return { status: 400, body: { ok: false, error: 'That is not a bring: { project, session, to, from }.' } }
  const asked = parsed.data
  const root = projectRoot(asked.project)
  if (!root.ok) return { status: 400, body: { ok: false, error: root.error } }
  const project = root.value
  const held = needs.runs.find(asked.session)
  const id = held && !held.ended ? (held.settled ?? null) : asked.session
  const answer = (outcome: ConversationsBringResult['outcome'], place: ConversationPlace | null, why = '', resumed = false): { status: number; body: ConversationsBringResult } => ({ status: 200, body: { outcome, place, resumed, why } })
  if (!id || !needs.program.isId(id)) return answer('no-such-session', null, 'Vibe has not recorded that conversation.')
  const read = readPlaces(project)
  if (!read.ok) return answer('declined', null, read.error)
  const known = Object.hasOwn(read.value.sessions, id) || (await needs.program.sessions(project, [id])).some((one) => one.id === id)
  if (!known) return answer('no-such-session', null, 'No Vibe conversation by that id is known in this project.')
  const now = filedAt(read.value, id)
  const fromKey = asked.from ? placeKey(namedPlace(asked.from)) : null
  if (now.key !== fromKey) return answer('elsewhere', now.place, now.key ? 'It is filed under another place.' : 'It is filed under no place.')
  const toKey = asked.to ? placeKey(namedPlace(asked.to)) : null
  if (toKey === now.key) return answer('brought', now.place)
  const written = asked.to ? assign(project, namedPlace(asked.to), id) : disconnect(project, id)
  if (!written.ok) return answer('declined', now.place, written.error)
  /* Its token, so the doors of a session this module gives them to know its place now (as here.ts). */
  if (asked.to) tokenFor(project, id, freshToken)
  needs.runs.told(project, asked.to ? { key: toKey!, session: id } : undefined)
  const resumed = Boolean(held && !held.ended && held.token)
  return answer('brought', asked.to ? filedAt(written.value, id).place : null, '', resumed)
}

/** `start`: a new Vibe conversation in the project, fed the brief, filed under the place (null: the project's own level). */
export async function startTask(raw: unknown, needs: ServiceNeeds): Promise<{ status: number; body: AgentTaskStartResult | { ok: false; error: string } }> {
  const parsed = agentTaskStartParams.safeParse(raw)
  if (!parsed.success) return { status: 400, body: { ok: false, error: 'That is not a start: { project, brief, place, title }.' } }
  const asked = parsed.data
  const root = projectRoot(asked.project)
  if (!root.ok) return { status: 200, body: { outcome: 'declined', session: null, why: root.error } }
  const place = asked.place ? namedPlace(asked.place) : { epic: null, parts: [], kehikko: null }
  const started = await needs.runs.startTask(root.value, place, asked.brief)
  return started.ok
    ? { status: 200, body: { outcome: 'started', session: started.session, why: '' } }
    : { status: 200, body: { outcome: 'declined', session: null, why: started.why.slice(0, 400) } }
}

/** The largest body read: a brief is up to 32,000 characters, escaped in JSON. */
const BODY_MOST = 256 * 1024

const json = (status: number, body: unknown) => Response.json(body, { status })

/**
 * The three routes, before the protocol's doors (`run({ before })`, Vite's `beforeDoors`): they need
 * the request's headers, which the doors do not hand `answer`. Anything else is handed on unread.
 */
export function serviceDoor(given: Partial<ServiceNeeds> = {}): Before {
  return async (request, { url }) => {
    const path = url.pathname
    if (path !== FIND_PATH && path !== BRING_PATH && path !== START_PATH) return undefined
    if (request.method !== 'POST') return json(405, { ok: false, error: 'this door takes POST' })
    const needs: ServiceNeeds = { program: given.program ?? PROGRAM, runs: given.runs ?? theRuns(), vouch: given.vouch ?? ((headers) => vouchHost(headers)) }
    const vouched = await needs.vouch(request.headers)
    if (!vouched.ok) return json(403, { ok: false, error: vouched.why })
    let body: unknown
    try {
      const text = await request.text()
      if (text.length > BODY_MOST) return json(413, { ok: false, error: 'That is too large.' })
      body = JSON.parse(text)
    } catch {
      return json(400, { ok: false, error: 'The body must be JSON.' })
    }
    const said = path === FIND_PATH ? await findConversations(body, needs) : path === BRING_PATH ? await bringConversation(body, needs) : await startTask(body, needs)
    return json(said.status, said.body)
  }
}
