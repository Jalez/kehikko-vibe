import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SERVICES, candidatesIn, conversationsBringResult, conversationsFindResult } from 'kehikot-module-protocol'

import { Runs, headless, type Pty } from '../live.ts'
import { MANIFEST } from '../manifest.ts'
import { placeKey } from '../place.ts'
import { PROGRAM, type Program, type Recorded } from '../program.ts'
import { assign, homeOf, isDetached, readPlaces } from '../record.ts'
import { BRING_PATH, FIND_PATH, START_PATH, bringConversation, findConversations, serviceDoor, type ServiceNeeds } from '../services.ts'
import { soloSession } from '../src/app.tsx'
import { writeRollout } from './transcripts.ts'

/**
 * The services Kehikot itself calls (protocol 2.88.0, services.ts): `find` from Vibe's records in a
 * scratch VIBE_HOME (test/setup.ts), `bring` as a compare-and-set on the project's record, `start`
 * through a stand-in pty, and every route refused to anything the host does not vouch for.
 */

const made: string[] = []
const project = () => {
  const one = realpathSync(mkdtempSync(join(tmpdir(), 'kehikko-vibe-services-')))
  made.push(one)
  return one
}
afterAll(() => {
  for (const one of made) rmSync(one, { recursive: true, force: true })
})

const A = 'a1111111-1111-4111-8111-111111111111'
const B = 'b2222222-2222-4222-8222-222222222222'
const C = 'c3333333-3333-4333-8333-333333333333'
const D = 'd4444444-4444-4444-8444-444444444444'
const typed = (text: string) => JSON.stringify({ timestamp: '2026-11-01T10:00:00.000Z', type: 'event_msg', payload: { type: 'item_completed', item: { type: 'UserMessage', content: [{ type: 'text', text }] } } })

const WRITING = { epic: 'thesis', parts: ['methods'], kehikko: 'k1a2b3c4' }
const REVIEW = { epic: 'thesis', parts: [], kehikko: 'r9z8y7x6' }
const named = (place: { epic: string | null; parts: string[]; kehikko: string | null }) => ({ epic: place.epic, parts: place.parts, kehikko: place.kehikko ? { key: place.kehikko } : null })

const record = (dir: string) => {
  const got = readPlaces(dir)
  if (!got.ok) throw new Error(got.error)
  return got.value
}

/** Needs over the real program (its records in the scratch VIBE_HOME) and no run held. */
const needs = (more: Partial<ServiceNeeds['runs']> = {}): ServiceNeeds => ({
  program: PROGRAM,
  runs: { find: () => null, running: async () => ({ known: true, active: [] }), told: () => {}, startTask: async () => ({ ok: false, why: 'not here' }), ...more },
  vouch: async () => ({ ok: true }),
})

describe('the manifest', () => {
  test('provides both services, each descriptor as the protocol reads it', () => {
    const services = MANIFEST.services as Record<string, unknown>
    expect(SERVICES['conversations.finder'].schema.safeParse(services['conversations.finder']).success).toBe(true)
    expect(SERVICES['agent.tasks'].schema.safeParse(services['agent.tasks']).success).toBe(true)
    expect(services['conversations.finder']).toMatchObject({ find: FIND_PATH, bring: BRING_PATH })
    expect(services['agent.tasks']).toMatchObject({ start: START_PATH, view: '/app?session={session}' })
  })
})

describe('find', () => {
  test('mentioned before folder, newest first; another folder and a subagent are not listed; where each is filed', async () => {
    const dir = project()
    const other = project()
    writeRollout(A, dir, [typed('Fix the review comments on !4721 please')], '2026-11-01T10:00:00.000Z')
    writeRollout(B, dir, [typed('Tidy the README')], '2026-11-02T10:00:00.000Z')
    writeRollout(C, other, [typed('Fix !4721 elsewhere')], '2026-11-03T10:00:00.000Z')
    writeRollout(D, dir, [typed('a subagent on !4721')], '2026-11-03T10:00:00.000Z', { parent_session_id: A })
    assign(dir, named(WRITING), B)
    const said = await findConversations({ project: dir, refs: ['!4721', 'group/repo!4721'], branch: 'feat/x' }, needs())
    expect(said.status).toBe(200)
    const body = conversationsFindResult.parse(said.body)
    expect(body.conversations.map((one) => one.session)).toEqual([A, B])
    expect(body.conversations[0]).toMatchObject({ match: 'mentioned', reason: 'mentioned !4721', folder: dir, place: null, running: false })
    expect(body.conversations[1]).toMatchObject({ match: 'folder', reason: 'worked in this repository', place: WRITING })
    /* Titles and reasons only: the label every list shows, and nothing else of the conversation. */
    expect(Object.keys(said.body as { conversations: object[] }).length).toBe(1)
    expect(Object.keys((said.body as { conversations: object[] }).conversations[0]!).sort()).toEqual(['folder', 'lastActive', 'match', 'place', 'reason', 'running', 'session', 'title'])
    expect(candidatesIn(body).map((one) => one.session)).toEqual([A, B])
  })

  test('a branch or the URL in its title is a mention, and a longer ref is not this one', async () => {
    const dir = project()
    writeRollout(A, dir, [typed('Carry on with feat/x-more')])
    writeRollout(B, dir, [typed('Work on feat/x until it passes')])
    writeRollout(C, dir, [typed('Look at !47210')])
    const body = conversationsFindResult.parse((await findConversations({ project: dir, refs: ['!4721'], branch: 'feat/x' }, needs())).body)
    const by = new Map(body.conversations.map((one) => [one.session, one]))
    expect(by.get(B)).toMatchObject({ match: 'mentioned', reason: 'mentioned branch feat/x' })
    expect(by.get(A)!.match).toBe('folder')
    expect(by.get(C)!.match).toBe('folder')
  })

  test('never a created, pushed or branch match: nothing this module reads shows one', async () => {
    const dir = project()
    writeRollout(A, dir, [typed('gh pr create for !4721 on feat/x')])
    const body = conversationsFindResult.parse((await findConversations({ project: dir, refs: ['!4721'], branch: 'feat/x' }, needs())).body)
    expect(body.conversations.every((one) => one.match === 'mentioned' || one.match === 'folder')).toBe(true)
  })

  test('a find that is not one is a 400', async () => {
    expect((await findConversations({ project: '/nowhere', refs: [] }, needs())).status).toBe(400)
  })
})

describe('bring', () => {
  test('an unplaced conversation is filed under `to`, and taken back with to: null, from: that place', async () => {
    const dir = project()
    writeRollout(A, dir, [typed('Fix !4721')])
    const told: string[] = []
    const n = needs({ told: (project) => void told.push(project) })
    const brought = await bringConversation({ project: dir, session: A, to: WRITING, from: null }, n)
    expect(conversationsBringResult.parse(brought.body)).toMatchObject({ outcome: 'brought', place: WRITING, resumed: false })
    expect(homeOf(record(dir), A)).toBe(placeKey(named(WRITING)))
    expect(record(dir).sessions[A]!.token).toBeTruthy()
    expect(told).toEqual([dir])

    const undone = await bringConversation({ project: dir, session: A, to: null, from: WRITING }, n)
    expect(conversationsBringResult.parse(undone.body)).toMatchObject({ outcome: 'brought', place: null })
    expect(homeOf(record(dir), A)).toBeNull()
    expect(isDetached(record(dir), A)).toBe(true)
  })

  test('one filed under another place is never moved: elsewhere, with where it is', async () => {
    const dir = project()
    writeRollout(A, dir, [typed('Fix !4721')])
    assign(dir, named(REVIEW), A)
    const before = JSON.stringify(record(dir))
    const said = await bringConversation({ project: dir, session: A, to: WRITING, from: null }, needs())
    expect(conversationsBringResult.parse(said.body)).toMatchObject({ outcome: 'elsewhere', place: REVIEW })
    expect(JSON.stringify(record(dir))).toBe(before)
    /* An undo after somebody moved it since takes nothing back. */
    const undo = await bringConversation({ project: dir, session: A, to: null, from: WRITING }, needs())
    expect(conversationsBringResult.parse(undo.body)).toMatchObject({ outcome: 'elsewhere', place: REVIEW })
    expect(homeOf(record(dir), A)).toBe(placeKey(named(REVIEW)))
  })

  test('a conversation this module holds the terminal of gains the place at once', async () => {
    const dir = project()
    writeRollout(A, dir, [typed('Fix !4721')])
    const held = { settled: A, ended: false, token: 'tok_abcdefghijklmnopqrstuv' } as never
    const said = await bringConversation({ project: dir, session: A, to: WRITING, from: null }, needs({ find: () => held }))
    expect(conversationsBringResult.parse(said.body)).toMatchObject({ outcome: 'brought', resumed: true })
  })

  test('a conversation Vibe has no record of is no such session', async () => {
    const dir = project()
    const said = await bringConversation({ project: dir, session: 'e5555555-5555-4555-8555-555555555555', to: WRITING, from: null }, needs())
    expect(conversationsBringResult.parse(said.body).outcome).toBe('no-such-session')
  })
})

class FakePty implements Pty {
  pid = 0
  typed: string[] = []
  killed = false
  private heard: (chunk: string) => void = () => {}
  private exited: (exit: { exitCode: number }) => void = () => {}
  constructor(readonly file: string, readonly args: string[]) {}
  onData(heard: (chunk: string) => void) {
    this.heard = heard
  }
  onExit(heard: (exit: { exitCode: number }) => void) {
    this.exited = heard
  }
  write(data: string) {
    this.typed.push(data)
  }
  resize() {}
  kill() {
    if (this.killed) return
    this.killed = true
    this.exited({ exitCode: 129 })
  }
  says(text: string) {
    this.heard(text)
  }
}

/** Runs over a stand-in pty: what Vibe 3.0.4 reports at its prompt (OSC 7501), and the record it writes once spoken to. */
function taskWorld() {
  const ptys: FakePty[] = []
  const held = new Map<string, Recorded[]>()
  const program: Program = {
    ...PROGRAM,
    find: () => ({ file: '/fake/bin/vibe', looked: ['/fake/bin'], usual: [] }),
    supports: async () => ({ ok: true, missing: null, tells: false, lists: true, names: false, configures: false, plugins: false }),
    active: async () => ({ known: true, active: [] }),
    newId: () => A,
    settled: async (projectPath, id) => (held.get(projectPath)?.some((one) => one.id === id) ? id : null),
    sessions: async (projectPath) => held.get(projectPath) ?? [],
    environment: () => ({ PATH: '/bin' }),
  }
  const runs = new Runs({
    program,
    screen: headless,
    every: null,
    watchEvery: null,
    port: () => null,
    spawn: (file, args) => {
      const pty = new FakePty(file, args)
      ptys.push(pty)
      return pty
    },
  })
  return { runs, ptys, held }
}

const IDLE = '\u001b]7501;state=idle:app=vibe\u001b\\'
const tick = (ms = 20) => new Promise((done) => setTimeout(done, ms))

describe('start', () => {
  test('a new Vibe conversation in the project, the brief typed in at its prompt, filed under the place', async () => {
    const dir = project()
    const w = taskWorld()
    const started = w.runs.startTask(dir, named(WRITING), 'Review !4721 and say what is left.', { ready: 5_000, settle: 5_000 })
    await tick()
    expect(w.ptys).toHaveLength(1)
    /* A new conversation: no --resume, and the brief is not on its command line. */
    expect(w.ptys[0]!.args).not.toContain('--resume')
    expect(w.ptys[0]!.args.join(' ')).not.toContain('Review')
    w.ptys[0]!.says(IDLE)
    await tick(150)
    expect(w.ptys[0]!.typed.join('')).toContain('Review !4721 and say what is left.')
    /* Vibe records it once spoken to. */
    w.held.set(dir, [{ id: A, label: 'Review !4721', lastActive: Date.now() }])
    const answer = await started
    expect(answer).toEqual({ ok: true, session: A })
    expect(homeOf(record(dir), A)).toBe(placeKey(named(WRITING)))
    /* Its view on its own (`/app?session=…`) knows where it is without a host's greeting. */
    expect(await w.runs.standaloneOf(A)).toMatchObject({ projectPath: dir, session: A, place: { epic: 'thesis', parts: ['methods'], kehikko: { key: 'k1a2b3c4' } } })
    w.runs.endAll()
  })

  test('a Vibe that never comes to its prompt is ended, and no task runs', async () => {
    const dir = project()
    const w = taskWorld()
    const answer = await w.runs.startTask(dir, named(WRITING), 'Review !4721.', { ready: 300, settle: 300 })
    expect(answer.ok).toBe(false)
    expect(w.ptys[0]!.killed).toBe(true)
    expect(w.ptys[0]!.typed.join('')).not.toContain('Review')
  })

  test('the route accepts at once, then starts it, the project level for a null place (protocol 2.99.0)', async () => {
    const dir = project()
    const asked: unknown[] = []
    let reported: (params: unknown) => void = () => {}
    const report = new Promise((done) => (reported = done))
    const fetch = (async (_url: string, init?: RequestInit) => {
      reported(JSON.parse(String(init?.body)).params)
      return Response.json({ ok: true, data: { outcome: 'told', why: '' } })
    }) as unknown as typeof globalThis.fetch
    const door = serviceDoor({
      ...needs({ startTask: async (...args) => (asked.push(args.slice(0, 3)), { ok: true, session: A }) }),
      program: { ...PROGRAM, find: () => ({ file: '/fake/bin/vibe', looked: [], usual: [] }), newId: () => B },
      report: { env: { KEHIKOT_HOST: 'http://127.0.0.1:4170' }, fetch, log: () => {} },
    })
    const response = await door(new Request(`http://127.0.0.1${START_PATH}`, { method: 'POST', body: JSON.stringify({ project: dir, brief: 'Do it.', place: null, title: 'Adopt !4721' }) }), { url: new URL(`http://127.0.0.1${START_PATH}`), asker: 'program', ticket: null })
    expect(response!.status).toBe(200)
    expect(await response!.json()).toEqual({ outcome: 'started', session: B, why: '', pending: true })
    expect(await report).toEqual({ session: B, conversation: A, outcome: 'started', why: '' })
    expect(asked).toEqual([[dir, { epic: null, parts: [], kehikko: null }, 'Do it.']])
  })

  test('the route declines at once when Vibe is not installed', async () => {
    const door = serviceDoor({ ...needs(), program: { ...PROGRAM, find: () => ({ file: null, looked: [], usual: [] }) } })
    const response = await door(new Request(`http://127.0.0.1${START_PATH}`, { method: 'POST', body: JSON.stringify({ project: project(), brief: 'Do it.', place: null, title: 't' }) }), { url: new URL(`http://127.0.0.1${START_PATH}`), asker: 'program', ticket: null })
    expect(await response!.json()).toMatchObject({ outcome: 'declined', session: null, pending: false })
  })
})

describe('the view', () => {
  test('/app?session=<id> is one conversation on its own; anything else is the framed page', () => {
    expect(soloSession(`?session=${A}`)).toBe(A)
    expect(soloSession('?session=nope')).toBeNull()
    expect(soloSession('')).toBeNull()
  })
})

describe('only the host', () => {
  const ask = (path: string, headers: Record<string, string> = {}) =>
    new Request(`http://127.0.0.1${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ project: '/tmp', refs: ['!1'] }) })

  test.each([FIND_PATH, BRING_PATH, START_PATH])('%s refuses a request the host does not vouch for', async (path) => {
    /* The real vouching: the scratch host at KEHIKOT_ORIGINS (port 9) answers nothing. */
    const door = serviceDoor({ ...needs(), vouch: undefined } as Partial<ServiceNeeds>)
    const bare = await door(ask(path), { url: new URL(`http://127.0.0.1${path}`), asker: 'program', ticket: null })
    expect(bare!.status).toBe(403)
    const posing = await door(ask(path, { 'x-kehikot-caller': 'kehikko', 'x-kehikot-pass': 'p'.repeat(43) }), { url: new URL(`http://127.0.0.1${path}`), asker: 'program', ticket: null })
    expect(posing!.status).toBe(403)
  })

  test('anything else is handed on unread', async () => {
    const door = serviceDoor(needs())
    expect(await door(ask('/api/place'), { url: new URL('http://127.0.0.1/api/place'), asker: 'program', ticket: null })).toBeUndefined()
  })
})
