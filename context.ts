import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { researchLine, sessionNotes, type NotesPlace, type NotesTold } from 'kehikot-module-protocol'

import type { DoorsAsked, HostPlace } from './doorConfig.ts'
import { ID } from './manifest.ts'
import { placeKey, readPlaceKey } from './place.ts'
import type { Program } from './program.ts'
import { kitSkills, skillsText, writeNotes } from './skills.ts'
import { PLACE_TOKEN, born, byToken, homeOf, projectRoot, readPlaces, readSettings, type NamedPlace, type Places } from './record.ts'

/**
 * What a session this module started is told of where it is, without anybody typing anything:
 * its place, and the modules on its kehikko. And the session filed under that place, as
 * `/kehikot-here` would file it.
 *
 * ## How it is told
 *
 *  - **At its start** — a new conversation, or one `/clear` makes in the same process — the whole
 *    of it: the place, one line per module on the kehikko, with its MCP server's name in this
 *    session and its skills, and the skills given to it, as `/name` entries (`skillsText`). This
 *    module writes it into the `AGENTS.md` of the session's own folder before the session starts
 *    (`startText`, called by live.ts), and Vibe puts an added directory's `AGENTS.md` into the
 *    session's instructions (its harness's `load_project_docs` over `--add-dir` roots). A resumed
 *    conversation keeps the instructions it was made with (Vibe stores them with it), so it hears
 *    of a change only as below.
 *  - **After a tool call**, only what changed since the session was last told: modules put on the
 *    kehikko or taken off it, or the conversation moved to another place by the person. Vibe has
 *    no hook at a prompt; its `post_tool` hook runs `context.sh` from the session's folder, which
 *    posts the session's id and its place token to `POST /api/context` and prints what comes
 *    back, and Vibe appends that (`hook_specific_output.additional_context`) to the tool's result.
 *    Nothing when nothing changed. A conversation never told anything (resumed from before Kehikot)
 *    is told the whole of it the first time. What it was told is kept beside its doors
 *    (`toldFile`), so a restart of this module does not tell it twice; and the folder's
 *    `AGENTS.md` is written again, so a `/clear` starts from what is true now.
 *
 * The modules are the host's to say (`modules` in its answer to `POST /host/place`, asked again
 * with the session's own token each time). A host too old to list them, or one that does not
 * answer, gets the place said and the modules left to `read_canvas`. What a module calls itself
 * and its one line are its own words: quoted, one line each, and said to be text.
 *
 * ## The filing
 *
 * A conversation this module started is filed under the place it was started at as soon as it is
 * a conversation — Vibe holds a record of it — exactly as `/kehikot-here` files one: it
 * belongs there, and is that kehikko's own when the kehikko had none (`born`). `settle` in
 * live.ts does this while this process holds the run; the hook does it whatever happened to the
 * run in between (this module restarted, the view closed, the conversation cleared into a new
 * one). Never for a conversation the record already files somewhere — it stays where the person
 * put it — nor one a person took off its place (`detached`) or said is not a Kehikot one
 * (`ignored`).
 */

/** Where a token's conversation was started, as this module gave it out. */
export interface Started {
  projectPath: string
  projectId: string | null
  place: NamedPlace
}

export interface ContextNeeds {
  program: Pick<Program, 'isId' | 'settled'>
  /** Where the conversation behind a token was started: from the runs, what was issued, or its kept folder. Null for a token this module did not give out. */
  startedOf(token: string): Started | null
  /** The host's answer for this token now (`hostPlace`): its doors and the modules on its kehikko. */
  host(asked: DoorsAsked): Promise<HostPlace | null>
  /** The names of the doors the conversation was started with, when known. */
  doorsOf(token: string): string[] | null
  /** Where what the conversation was last told is kept. */
  toldFile(token: string): string
  /** The record changed under this project: what `/kehikot-here` calls after it files one. */
  told(projectPath: string, assigned?: { key: string; session: string }): void
  log(line: string): void
  /** The session's own folder, which holds the skills it was given (skills.ts), while it runs. */
  kitOf?(token: string): string | null
  /** Run something a moment later: the filing is tried again while Vibe writes its record. Absent: not again. */
  later?(run: () => void, ms: number): void
}

export type ContextEvent = 'SessionStart' | 'PostToolUse'
const EVENTS: readonly ContextEvent[] = ['PostToolUse']

/** What a `post_tool` hook prints for Vibe to append to the tool's result. */
export interface HookAnswer {
  hook_specific_output: { additional_context: string }
}

/**
 * What a conversation was last told (the protocol's `NotesTold`: its place by key, the modules on it
 * and the installed ones absent from it), and the words themselves: the last full notes and what
 * was added at prompts since, which the page shows the person ("What this conversation was told").
 */
export interface Told extends NotesTold {
  said?: Said
}

/** The words a conversation was told: the last full notes, and each change told at a prompt after them. */
export interface Said {
  start: { at: number; text: string }
  changes: { at: number; text: string }[]
}

/** How many changes after the last full notes are kept to show. */
const SAID_CHANGES = 20

/** How often, and how far apart, a filing waits for Vibe's record of a prompt just sent. */
const FILE_TRIES = 10
const FILE_EVERY = 500

/**
 * This module, as the notes name it: it is not listed among the modules around its own session, and
 * its door is where "Research complete" is said. The words themselves are the protocol's
 * (`sessionNotes`), the same for every module that runs agent sessions.
 */
export const SELF = { module: ID, name: 'Vibe', door: 'kehikko-vibe' } as const

/**
 * What a session is told about "Research complete" (research.ts): how it says that a finished turn,
 * or a subagent's, was research. An explorer subagent, or one whose task reads as research, is
 * noticed anyway.
 */
export const RESEARCH_LINE = researchLine(SELF)

export function readTold(file: string): Told | null {
  try {
    const said = JSON.parse(readFileSync(file, 'utf8')) as { key?: unknown; version?: unknown; modules?: unknown; absent?: unknown; names?: unknown; said?: unknown }
    const ids = (list: unknown): string[] | null => (Array.isArray(list) ? list.filter((one): one is string => typeof one === 'string') : null)
    const names = said.names && typeof said.names === 'object' && !Array.isArray(said.names) ? Object.fromEntries(Object.entries(said.names).filter((pair): pair is [string, string] => typeof pair[1] === 'string')) : undefined
    return {
      key: typeof said.key === 'string' ? said.key : null,
      /* A record kept before the notes had a version has none: the protocol reads that as the old wording, so the full new notes are said once. */
      ...(typeof said.version === 'number' && Number.isFinite(said.version) ? { version: said.version } : {}),
      modules: ids(said.modules),
      ...(said.absent !== undefined ? { absent: ids(said.absent) } : {}),
      ...(names ? { names } : {}),
      ...(saidOf(said.said) ? { said: saidOf(said.said)! } : {}),
    }
  } catch {
    return null
  }
}

const text = (one: unknown): { at: number; text: string } | null => {
  const it = one as { at?: unknown; text?: unknown } | null
  return it && typeof it.at === 'number' && typeof it.text === 'string' ? { at: it.at, text: it.text } : null
}

function saidOf(raw: unknown): Said | null {
  const it = raw as { start?: unknown; changes?: unknown } | null
  const start = it ? text(it.start) : null
  if (!start) return null
  return { start, changes: Array.isArray(it!.changes) ? it!.changes.flatMap((one) => text(one) ?? []).slice(-SAID_CHANGES) : [] }
}

/** What the conversation behind a token was last told, in words, to show the person; null when nothing is kept. */
export function toldWords(file: string): Said | null {
  return readTold(file)?.said ?? null
}

function writeTold(file: string, told: Told): void {
  try {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
    chmodSync(dirname(file), 0o700)
    const temporary = `${file}.${process.pid}.tmp`
    writeFileSync(temporary, JSON.stringify(told), { mode: 0o600 })
    renameSync(temporary, file)
  } catch {
    /* Not kept: the next prompt says it again, which is the most that costs. */
  }
}

/** A place filed under a key, with the names the record and the place it was started at know it by. */
function named(key: string, places: Places, started: NamedPlace): NamedPlace | null {
  const place = readPlaceKey(key)
  if (!place) return null
  const entry = Object.hasOwn(places.places, key) ? places.places[key] : undefined
  const same = placeKey(started) === key
  return {
    ...place,
    ...(entry?.kehikko?.name || (same && started.kehikkoName) ? { kehikkoName: entry?.kehikko?.name || started.kehikkoName } : {}),
    ...(same && started.partNames ? { partNames: started.partNames } : {}),
  }
}

/**
 * File a conversation this module started under the place it was started at, when the record
 * files it nowhere and nobody said otherwise (see "The filing"). True when it was filed now.
 */
export async function autoFile(projectPath: string, place: NamedPlace, session: string, token: string, needs: ContextNeeds): Promise<boolean> {
  const read = readPlaces(projectPath)
  if (!read.ok) return false
  const entry = Object.hasOwn(read.value.sessions, session) ? read.value.sessions[session] : undefined
  if (homeOf(read.value, session) || entry?.ignored || entry?.detached) return false
  if (!(await needs.program.settled(projectPath, session, 0))) return false
  /* One token, one conversation: a conversation cleared into a new one in the same process is filed without it. */
  const free = !byToken(read.value, token)
  const before = ownOfKey(read.value, placeKey(place))
  const written = born(projectPath, place, session, free ? token : null)
  if (!written.ok) {
    needs.log(`vibe: ${session} could not be filed under the place it was started at — ${written.error}`)
    return false
  }
  needs.log(`vibe: ${session} filed under the place it was started at${before ? '' : ', as its kehikko’s own (it had none)'} — no /kehikot-here needed`)
  needs.told(projectPath, { key: placeKey(place), session })
  return true
}

/** A place as the notes say it: the folder, the epic, the parts by id and name, the kehikko by key and name. */
function notesPlace(projectPath: string, place: NamedPlace): NotesPlace {
  const kehikko = place.kehikko ? ('key' in place.kehikko ? place.kehikko.key : String(place.kehikko.id)) : null
  return {
    project: projectPath,
    epic: place.epic,
    parts: place.parts.map((id, i) => ({ id, ...(place.partNames?.[i] ? { name: place.partNames[i] } : {}) })),
    kehikko: kehikko ? { key: kehikko, ...(place.kehikkoName ? { name: place.kehikkoName } : {}) } : null,
  }
}

const ownOfKey = (places: Places, key: string): string | null => (Object.hasOwn(places.places, key) ? (places.places[key]?.own ?? places.places[key]?.current ?? null) : null)

/** File it now, or a moment later while Vibe writes its record of the prompt just sent. */
async function fileSoon(projectPath: string, place: NamedPlace, session: string, token: string, needs: ContextNeeds, left = FILE_TRIES): Promise<void> {
  if (await autoFile(projectPath, place, session, token, needs)) return
  const read = readPlaces(projectPath)
  const entry = read.ok && Object.hasOwn(read.value.sessions, session) ? read.value.sessions[session] : undefined
  if (left <= 1 || !needs.later || (read.ok && homeOf(read.value, session)) || entry?.ignored || entry?.detached) return
  needs.later(() => void fileSoon(projectPath, place, session, token, needs, left - 1).catch(() => {}), FILE_EVERY)
}

/** Where a conversation belongs now, and what the host says of that place: what both kinds of notes are made of. */
async function placed(projectPath: string, started: Started, session: string | null, token: string, needs: ContextNeeds, messages = true): Promise<{ input: Parameters<typeof sessionNotes>[0] } > {
  /* Where it belongs now: the record's say, else where it was started (it is filed there once it is a conversation). */
  const read = readPlaces(projectPath)
  const places = read.ok ? read.value : null
  const home = places && session ? homeOf(places, session) : null
  const entry = places && session && Object.hasOwn(places.sessions, session) ? places.sessions[session] : undefined
  const place = home && places ? named(home, places, started.place) : entry?.detached || entry?.ignored ? null : started.place
  const key = place ? placeKey(place) : null
  const kehikko = place?.kehikko && 'key' in place.kehikko ? place.kehikko.key : null
  const answer = place ? await needs.host({ projectPath, projectId: started.projectId, token, kehikko, messages }).catch(() => null) : null
  const hostDoor = answer?.doors.find((door) => door.module === 'kehikko')?.name ?? null
  return {
    input: {
      place: place ? notesPlace(projectPath, place) : null,
      /* A kehikko this record names only by its old row number was not asked about: its modules are read_canvas's to say. */
      modules: place?.kehikko && !kehikko ? null : (answer?.modules ?? null),
      absent: answer?.absent ?? null,
      hostDoor,
      self: SELF,
      connected: needs.doorsOf(token),
      key,
      /* Unread messages from other agent sessions, handed by the host and now delivered (protocol 2.41.0). */
      messages: answer?.messages ?? null,
      messagesMore: answer?.messagesMore ?? 0,
      messaging: answer?.messages ? { session: session } : null,
      /* The person's standing permission to act on messages (protocol 2.43.0), this project's setting. */
      actOnMessages: readSettings(projectPath).actOnMessages,
    },
  }
}

/** The whole of what a session is told at its start, with the skills it was given. */
function withSkills(text: string, token: string, needs: ContextNeeds): string {
  /* The skills it was given, each a `/name` (skills.ts): Vibe lists them in its own menu too. */
  const kit = needs.kitOf?.(token) ?? null
  const catalog = kit ? skillsText(kitSkills(kit)) : null
  return catalog ? `${text}\n\n${catalog}` : text
}

/**
 * What a session is told at its start, for its folder's `AGENTS.md`: the protocol's notes, whole,
 * and its skills. Kept as what the conversation was told when `record` (a new conversation, which
 * will read it); a resumed one keeps the instructions it was made with, so nothing is kept for it.
 * Null for a token this module did not give out.
 */
export async function startText(asked: { session: string | null; token: string | null; record: boolean }, needs: ContextNeeds): Promise<string | null> {
  const { session, token } = asked
  if (!token || !PLACE_TOKEN.test(token)) return null
  const started = needs.startedOf(token)
  if (!started) return null
  const root = projectRoot(started.projectPath)
  if (!root.ok) return null
  /* Messages are handed (and counted delivered) only for a new conversation, which reads this; a resumed one does not. */
  const { input } = await placed(root.value, started, session && needs.program.isId(session) ? session : null, token, needs, asked.record)
  const notes = sessionNotes(input, 'start', null)
  if (notes.text === null) return null
  const text = withSkills(notes.text, token, needs)
  if (asked.record) writeTold(needs.toldFile(token), { ...notes.told, said: { start: { at: Date.now(), text }, changes: [] } })
  return text
}

/**
 * Answer one hook (`post_tool`): file the conversation where it was started if it belongs nowhere
 * yet, and say what changed since it was last told — or nothing (null). When something changed, the
 * session's `AGENTS.md` is written again with the whole of it, for a `/clear`.
 */
export async function context(asked: { event: string; session: string; token: string | null }, needs: ContextNeeds): Promise<HookAnswer | null> {
  const event = EVENTS.find((one) => one === asked.event)
  const { session, token } = asked
  if (!event || !needs.program.isId(session) || !token || !PLACE_TOKEN.test(token)) return null
  const started = needs.startedOf(token)
  if (!started) return null
  const root = projectRoot(started.projectPath)
  if (!root.ok) return null
  const projectPath = root.value
  /* A tool ran: the conversation exists, or is about to. */
  await fileSoon(projectPath, started.place, session, token, needs)
  const { input } = await placed(projectPath, started, session, token, needs)
  /* The words are the protocol's, the same for every agent module; this module only delivers them. */
  const file = needs.toldFile(token)
  const told = readTold(file)
  const notes = sessionNotes(input, 'prompt', told)
  if (notes.text === null) return null
  const text = notes.kind === 'start' ? withSkills(notes.text, token, needs) : notes.text
  const at = Date.now()
  const said: Said = notes.kind === 'start' || !told?.said ? { start: { at, text }, changes: [] } : { start: told.said.start, changes: [...told.said.changes, { at, text }].slice(-SAID_CHANGES) }
  writeTold(file, { ...notes.told, said })
  /* For a /clear: the session made next reads its folder's AGENTS.md again. */
  /* Without the messages: they were said once, at this prompt, and a /clear must not say them again. */
  const whole = sessionNotes({ ...input, messages: null, messagesMore: 0 }, 'start', null).text
  if (whole !== null) writeNotes(needs.kitOf?.(token) ?? null, withSkills(whole, token, needs))
  return { hook_specific_output: { additional_context: text } }
}
