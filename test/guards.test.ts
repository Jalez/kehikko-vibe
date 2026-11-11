import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { PlacedGuard } from 'kehikot-module-protocol'

import { GUARD_MATCH, GUARDS_FRESH_MS, HANDED_OFF, SPAWN_SAID, UNKNOWN, guard, guardAnswer, handedOff, spawnAnswer, type GuardNeeds } from '../context.ts'
import { hostPlace, type DoorsAsked, type HostPlace } from '../doorConfig.ts'
import { PROGRAM } from '../program.ts'
import { hooksFileIn, sessionKit } from '../skills.ts'

/**
 * Guards (protocol 2.61.0) in a Vibe session: its `pre_tool` hook (`guard.sh` → `/api/guard` →
 * `guard` in context.ts) rewrites a guarded shell command, refuses a denied one, lets everything else
 * through, and gives a subagent's brief the notes a subagent is told.
 */

const SESSION = '11111111-1111-4111-8111-111111111111'
const PARENT = '22222222-2222-4222-8222-222222222222'
const TOKEN = 'T0kenT0kenT0kenT0kenT0kenT0kenT0ken_-x'

const QUEUE: PlacedGuard = {
  module: 'kehikot.queue',
  name: 'Queue',
  guard: { id: 'heavy', tool: 'shell', match: { commands: ['bun test'] }, action: 'rewrite', rewrite: 'kehikot-queue run -- sh -c {command}', why: 'Heavy runs wait their turn.' },
}
const NO_PLAYWRIGHT: PlacedGuard = {
  module: 'kehikot.browser',
  name: 'Browser',
  guard: { id: 'no-playwright', tool: 'shell', match: { commands: ['playwright'] }, action: 'deny', why: 'Use the Browser module.' },
}

const bash = (command: string, extra: Record<string, unknown> = {}) => ({
  session_id: SESSION,
  parent_session_id: null,
  transcript_path: '/x',
  cwd: '/p',
  hook_event_name: 'pre_tool',
  tool_name: 'file_system.bash',
  tool_call_id: 'call-1',
  tool_input: { command, timeout: 60, ...extra },
})

describe('what a shell command becomes', () => {
  test('a guarded command is rewritten: the whole input back with only the command changed, the words shown to the person', () => {
    const said = guardAnswer(bash('bun test --watch'), [QUEUE])
    expect(said).toEqual({
      /* Handed off: the bash tool waits for its command, so the queue returns at once and tells this session. */
      hook_specific_output: { tool_input: { command: "KEHIKOT_DETACH=1 kehikot-queue run -- sh -c 'bun test --watch'", timeout: 60 } },
      system_message: expect.stringContaining('Queue (a module on this kehikko) ran this command through its own instead (guard heavy)'),
    })
    expect(JSON.stringify(said).startsWith('{"hook_specific_output":{"tool_input":')).toBe(true)
    expect((said as { system_message: string }).system_message).toEndWith(HANDED_OFF)
    expect(HANDED_OFF).toContain("you'll be notified here when it finishes")
    /* With the session's place token, the queue knows whom to tell. */
    expect(guardAnswer(bash('bun test'), [QUEUE], false, TOKEN)).toMatchObject({ hook_specific_output: { tool_input: { command: `KEHIKOT_DETACH=1 KEHIKOT_PLACE=${TOKEN} kehikot-queue run -- sh -c 'bun test'` } } })
  })

  test('a handed-off command runs in a shell with the hand-off and the place said to the command it runs, and nothing else changed', () => {
    const run = Bun.spawnSync(['sh', '-c', handedOff(`sh -c 'echo "$KEHIKOT_DETACH:$KEHIKOT_PLACE:$1"' - 'it'\\''s'`, TOKEN)])
    expect(run.stdout.toString()).toBe(`1:${TOKEN}:it's\n`)
    /* A token that is not one is left out; the hand-off is still asked. */
    expect(handedOff('x', 'no; rm -rf /')).toBe('KEHIKOT_DETACH=1 x')
    expect(handedOff('x', null)).toBe('KEHIKOT_DETACH=1 x')
  })

  test('a denied command is refused with the module’s words, which Vibe hands the model as the tool’s error', () => {
    const said = guardAnswer(bash('npx playwright test'), [QUEUE, NO_PLAYWRIGHT])
    expect(said).toEqual({ decision: 'deny', reason: expect.stringContaining('Refused by Browser (a module on this kehikko), guard no-playwright') })
    expect(JSON.stringify(said).startsWith('{"decision":"deny",')).toBe(true)
    expect((said as { reason: string }).reason).toContain('KEHIKOT_DIRECT=1')
  })

  test('a command started in the background is held the same, and its own env can escape', () => {
    const start = { ...bash(''), tool_name: 'process.start', tool_input: { command: 'bun test', cwd: '/p' } }
    expect(guardAnswer(start, [QUEUE])).toMatchObject({ hook_specific_output: { tool_input: { command: "kehikot-queue run -- sh -c 'bun test'", cwd: '/p' } } })
    expect(guardAnswer({ ...start, tool_input: { command: 'bun test', env: { KEHIKOT_DIRECT: '1' } } }, [QUEUE])).toBeNull()
  })

  test('passes: the escape, another command, another tool, no guards, no command', () => {
    expect(guardAnswer(bash('KEHIKOT_DIRECT=1 bun test'), [QUEUE])).toBeNull()
    expect(guardAnswer(bash('bun test'), [QUEUE], true)).toBeNull()
    expect(guardAnswer(bash('git status'), [QUEUE, NO_PLAYWRIGHT])).toBeNull()
    expect(guardAnswer(bash('bun test'), [])).toBeNull()
    expect(guardAnswer({ ...bash('bun test'), tool_name: 'mcp_shell.bash' }, [QUEUE])).toBeNull()
    expect(guardAnswer({ ...bash('bun test'), tool_input: { cmd: 'bun test' } }, [QUEUE])).toBeNull()
    expect(guardAnswer(null, [QUEUE])).toBeNull()
  })

  test('a subagent’s brief keeps its first line and gets the notes after it', () => {
    const spawnInput = { ...bash(''), tool_name: 'agents.spawn', tool_input: { name: 'scout', message: 'Find the flaky test.', config_name: 'explore' } }
    expect(spawnAnswer(spawnInput, 'Kehikot: you are a subagent.')).toEqual({
      hook_specific_output: { tool_input: { name: 'scout', message: 'Find the flaky test.\n\nKehikot: you are a subagent.', config_name: 'explore' } },
      system_message: SPAWN_SAID,
    })
    expect(spawnAnswer(spawnInput, null)).toBeNull()
    expect(spawnAnswer(bash('ls'), 'notes')).toBeNull()
  })
})

describe('the session’s guards, as the host hands them', () => {
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'kehikko-vibe-guards-')))
  afterAll(() => rmSync(project, { recursive: true, force: true }))
  const PLACE = { epic: 'thesis', parts: [], kehikko: { key: 'k1a2b3c4' }, kehikkoName: 'writing' }

  function world(answers: (HostPlace | null)[]) {
    const asked: DoorsAsked[] = []
    let kept: { at: number; guards: PlacedGuard[] } | null = null
    let now = 1_000_000
    const needs: GuardNeeds = {
      program: PROGRAM,
      startedOf: (one) => (one === TOKEN ? { projectPath: project, projectId: null, place: PLACE } : null),
      host: async (one) => {
        asked.push(one)
        return answers.length > 1 ? answers.shift()! : (answers[0] ?? null)
      },
      keptGuards: () => kept,
      keepGuards: (_one, guards) => (kept = { at: now, guards }),
      now: () => now,
    }
    return { needs, asked, later: (ms: number) => (now += ms) }
  }
  const answer = (guards: PlacedGuard[] | undefined): HostPlace => ({
    doors: [{ module: 'kehikko', name: 'kehikko', url: 'http://127.0.0.1:4180/mcp', transport: 'http' }],
    modules: [{ module: 'kehikot.queue', name: 'Queue', summary: 'Heavy runs, one at a time.', door: null, skills: [] }],
    absent: [],
    everywhere: null,
    messages: null,
    messagesMore: 0,
    ...(guards === undefined ? {} : { guards }),
  })

  test('asked once without messages, then kept for 30 seconds', async () => {
    const w = world([answer([QUEUE])])
    expect(await guard({ session: SESSION, token: TOKEN, input: bash('bun test') }, w.needs)).toMatchObject({ hook_specific_output: {} })
    expect(w.asked).toEqual([{ projectPath: project, projectId: null, token: TOKEN, kehikko: 'k1a2b3c4', messages: false }])
    w.later(GUARDS_FRESH_MS - 1)
    expect(await guard({ session: SESSION, token: TOKEN, input: bash('bun test') }, w.needs)).not.toBeNull()
    expect(w.asked).toHaveLength(1)
  })

  test('the module taken off the kehikko: after the cache, the host hands no guard and the command runs as written', async () => {
    const w = world([answer([QUEUE]), answer([])])
    expect(await guard({ session: SESSION, token: TOKEN, input: bash('bun test') }, w.needs)).not.toBeNull()
    w.later(GUARDS_FRESH_MS)
    expect(await guard({ session: SESSION, token: TOKEN, input: bash('bun test') }, w.needs)).toBeNull()
    expect(w.asked).toHaveLength(2)
  })

  test('a host too old to say guards nothing; no host keeps the last guards heard; a token not given out is nothing', async () => {
    expect(await guard({ session: SESSION, token: TOKEN, input: bash('bun test') }, world([answer(undefined)]).needs)).toBeNull()
    const w = world([answer([QUEUE]), null])
    await guard({ session: SESSION, token: TOKEN, input: bash('bun test') }, w.needs)
    w.later(GUARDS_FRESH_MS)
    expect(await guard({ session: SESSION, token: TOKEN, input: bash('bun test') }, w.needs)).not.toBeNull()
    expect(await guard({ session: SESSION, token: 'someone-else', input: bash('bun test') }, world([answer([QUEUE])]).needs)).toBeNull()
    expect(await guard({ session: 'nope', token: TOKEN, input: bash('bun test') }, world([answer([QUEUE])]).needs)).toBeNull()
  })

  test('Kehikot away and nothing kept: not known, never "no guards" — for a command and a subagent alike; once kept, the kept ones stand', async () => {
    const away = world([null])
    expect(await guard({ session: SESSION, token: TOKEN, input: bash('bun test') }, away.needs)).toBe(UNKNOWN)
    expect(await guard({ session: SESSION, token: TOKEN, input: { ...bash(''), tool_name: 'agents.spawn', tool_input: { name: 'scout', message: 'Run the tests.' } } }, away.needs)).toBe(UNKNOWN)
    const back = world([answer([QUEUE]), null])
    await guard({ session: SESSION, token: TOKEN, input: bash('bun test') }, back.needs)
    back.later(GUARDS_FRESH_MS)
    expect(await guard({ session: SESSION, token: TOKEN, input: bash('bun test') }, back.needs)).toMatchObject({ hook_specific_output: {} })
  })

  test('another tool is never looked into: the host is not asked', async () => {
    const w = world([answer([QUEUE])])
    expect(await guard({ session: SESSION, token: TOKEN, input: { ...bash('bun test'), tool_name: 'file_system.read_file' } }, w.needs)).toBeNull()
    expect(w.asked).toHaveLength(0)
  })

  test('a subagent starts with its place, the modules there and their guards after its brief', async () => {
    const w = world([answer([QUEUE])])
    const said = await guard({ session: SESSION, token: TOKEN, input: { ...bash(''), tool_name: 'agents.spawn', tool_input: { name: 'scout', message: 'Run the tests.' } } }, w.needs)
    const message = (said as unknown as { hook_specific_output: { tool_input: { message: string } } }).hook_specific_output.tool_input.message
    expect(message.startsWith('Run the tests.\n\nKehikot: you are a subagent of a conversation that belongs to')).toBe(true)
    expect(message).toContain('Queue')
    expect(message).toContain('Heavy runs wait their turn.')
    expect(w.asked.at(-1)?.messages).toBe(false)
  })
})

describe('the host’s answer', () => {
  test('guards are read when said, and null from a host too old to say', async () => {
    const host = (extra: Record<string, unknown>) =>
      (async () => ({ ok: true, status: 200, json: async () => ({ ok: true, token: TOKEN, doors: [], ...extra }) })) as unknown as typeof fetch
    const env = { KEHIKOT_ORIGINS: 'http://127.0.0.1:4999' }
    const asked = { projectPath: '/p', projectId: null, token: TOKEN, kehikko: null }
    expect((await hostPlace(asked, { env, fetch: host({ guards: [QUEUE, { module: 'x', guard: {} }] }) }))?.guards).toEqual([QUEUE])
    expect((await hostPlace(asked, { env, fetch: host({}) }))?.guards).toBeNull()
  })
})

describe('the session’s hooks file', () => {
  test('a pre_tool hook on exactly the shell, background, file and spawn tools, failing open', () => {
    const text = PROGRAM.hooksFile([{ event: 'pre_tool', matcher: GUARD_MATCH, commands: [{ command: '/bin/sh "/k/guard.sh" PreToolUse', timeout: 5 }] }])
    expect(text).toContain('type = "pre_tool"')
    expect(text).toContain('match = "re:file_system\\\\.bash|process\\\\.start|file_system\\\\.write_file|file_system\\\\.edit|file_system\\\\.search_replace|agents\\\\.spawn"')
    expect(text).not.toContain('strict')
    const pattern = new RegExp(`^(?:${GUARD_MATCH.slice(3)})$`, 'i')
    for (const name of ['file_system.bash', 'process.start', 'file_system.write_file', 'file_system.edit', 'file_system.search_replace', 'agents.spawn']) expect(pattern.test(name)).toBe(true)
    for (const name of ['bash', 'mcp_x.bash', 'file_system.read_file', 'agents.send_message']) expect(pattern.test(name)).toBe(false)
  })
})

/* ------------------------------------------------------------------------ *
 * guard.sh, run for real against a stand-in of this module
 * ------------------------------------------------------------------------ */

describe('guard.sh, from a session’s own folder', () => {
  interface Heard {
    url: string
    ticket: string | undefined
    body: string
  }
  const heard: Heard[] = []
  let reply: { status: number; body: string } = { status: 204, body: '' }
  let server: Server
  let origin = ''
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'kehikko-vibe-guard-')))

  beforeAll(async () => {
    server = createServer((request, response) => {
      let body = ''
      request.on('data', (chunk) => (body += chunk))
      request.on('end', () => {
        heard.push({ url: request.url ?? '', ticket: request.headers['x-module-ticket'] as string | undefined, body })
        response.writeHead(reply.status, { 'content-type': 'application/json' }).end(reply.status === 204 ? undefined : reply.body)
      })
    })
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(() => {
    server.close()
    rmSync(scratch, { recursive: true, force: true })
  })

  async function kit(at = origin): Promise<string> {
    const base = mkdtempSync(join(scratch, 'base-'))
    const dir = (await sessionKit([], { base, personal: [], token: TOKEN, registration: join(scratch, 'none.json') })).dir
    writeFileSync(join(dir, 'kehikot', 'origin'), at)
    return dir
  }
  function ran(dir: string, input: string, env: Record<string, string> = {}): Promise<{ code: number | null; out: string }> {
    return new Promise((done) => {
      const child = spawn('/bin/sh', [join(dir, 'guard.sh'), 'PreToolUse'], { env: { PATH: '/usr/bin:/bin', ...env } })
      let out = ''
      child.stdout.on('data', (chunk) => (out += chunk))
      child.on('close', (code) => done({ code, out }))
      child.stdin.on('error', () => {})
      child.stdin.end(input)
    })
  }

  test('it is in the folder beside context.sh', async () => {
    const dir = await kit()
    expect(readFileSync(join(dir, 'guard.sh'), 'utf8')).toBe(readFileSync(join(import.meta.dir, '..', 'guard.sh'), 'utf8'))
    expect(hooksFileIn(dir)).toBe(join(dir, '.vibe', 'hooks.toml'))
  })

  test('posts the hook’s input with the token in a header, and prints a rewrite for Vibe', async () => {
    const dir = await kit()
    const rewrite = JSON.stringify(guardAnswer(bash('bun test'), [QUEUE]))
    reply = { status: 200, body: rewrite }
    heard.length = 0
    const input = JSON.stringify(bash('bun test'))
    expect(await ran(dir, input)).toEqual({ code: 0, out: `${rewrite}\n` })
    expect(heard).toEqual([{ url: `/api/guard?session=${SESSION}&direct=0`, ticket: TOKEN, body: input }])
  })

  test('prints a refusal; a subagent is asked for by its parent; KEHIKOT_DIRECT is said', async () => {
    const dir = await kit()
    const deny = JSON.stringify(guardAnswer(bash('npx playwright test'), [NO_PLAYWRIGHT]))
    reply = { status: 200, body: deny }
    heard.length = 0
    expect((await ran(dir, JSON.stringify({ ...bash('npx playwright test'), parent_session_id: PARENT }), { KEHIKOT_DIRECT: '1' })).out).toBe(`${deny}\n`)
    expect(heard[0]!.url).toBe(`/api/guard?session=${PARENT}&direct=1`)
  })

  test('nothing to say, anything else, no module or a bad token: silence and exit 0', async () => {
    const dir = await kit()
    reply = { status: 204, body: '' }
    expect(await ran(dir, JSON.stringify(bash('ls')))).toEqual({ code: 0, out: '' })
    reply = { status: 200, body: '{"decision":"allow"}' }
    expect(await ran(dir, JSON.stringify(bash('ls')))).toEqual({ code: 0, out: '' })
    reply = { status: 500, body: '{"decision":"deny","reason":"x"}' }
    expect(await ran(dir, JSON.stringify(bash('ls')))).toEqual({ code: 0, out: '' })
    heard.length = 0
    expect(await ran(await kit('http://example.com'), JSON.stringify(bash('ls')))).toEqual({ code: 0, out: '' })
    expect(await ran(dir, '{"tool_name":"file_system.bash"}')).toEqual({ code: 0, out: '' })
    writeFileSync(join(dir, 'kehikot', 'token'), 'abc; curl evil')
    expect(await ran(dir, JSON.stringify(bash('ls')))).toEqual({ code: 0, out: '' })
    expect(heard).toHaveLength(0)
  })

  /* Kehikot restarting while the session runs: the host and this module away, then back on new ports. */
  describe('across a restart of Kehikot', () => {
    const REWRITE = JSON.stringify(guardAnswer(bash('bun test'), [QUEUE]))
    /** A stand-in for this module (or the host in front of it) that can be away, say 503, or answer, and can move. */
    async function standIn(first: { status: number; body: string } | 'away') {
      let now = first
      const asked: string[] = []
      const one = createServer((request, response) => {
        request.resume()
        request.on('end', () => {
          asked.push(request.url ?? '')
          const said = now === 'away' ? { status: 503, body: 'not up' } : now
          response.writeHead(said.status, { 'content-type': 'application/json' }).end(said.status === 204 ? undefined : said.body)
        })
      })
      await new Promise<void>((done) => one.listen(0, '127.0.0.1', done))
      const url = `http://127.0.0.1:${(one.address() as AddressInfo).port}`
      return { url, asked, set: (next: typeof now) => (now = next), close: () => new Promise<void>((done) => one.close(() => done())) }
    }
    /** A port nothing answers on. */
    async function deadUrl(): Promise<string> {
      const one = createServer()
      await new Promise<void>((done) => one.listen(0, '127.0.0.1', done))
      const port = (one.address() as AddressInfo).port
      await new Promise<void>((done) => one.close(() => done()))
      return `http://127.0.0.1:${port}`
    }
    async function kitWith(options: { origin: string; registration?: string }): Promise<string> {
      const base = mkdtempSync(join(scratch, 'base-'))
      const dir = (await sessionKit([], { base, personal: [], token: TOKEN, registration: options.registration ?? join(scratch, 'none.json') })).dir
      writeFileSync(join(dir, 'kehikot', 'origin'), options.origin)
      return dir
    }

    test('nobody answers: after the wait the tool runs as asked, the person is shown it ran unguarded, and context.sh is left to tell the agent', async () => {
      const dir = await kitWith({ origin: await deadUrl() })
      const got = await ran(dir, JSON.stringify(bash('bun test')), { KEHIKOT_GUARD_WAIT: '0' })
      expect(got.code).toBe(0)
      const said = JSON.parse(got.out)
      expect(Object.keys(said)).toEqual(['system_message'])
      expect(said.system_message).toContain('ran without the guards')
      expect(existsSync(join(dir, 'kehikot', 'unguarded'))).toBe(true)
    })

    test('the module comes back on another port within the wait: its registration is followed and the guard applies', async () => {
      const registration = join(scratch, 'registration-moving.json')
      const old = await deadUrl()
      writeFileSync(registration, JSON.stringify({ id: 'kehikot.vibe', url: old }))
      const dir = await kitWith({ origin: old, registration })
      const running = ran(dir, JSON.stringify(bash('bun test')), { KEHIKOT_GUARD_WAIT: '10' })
      await Bun.sleep(1500)
      const back = await standIn({ status: 200, body: REWRITE })
      writeFileSync(registration, JSON.stringify({ id: 'kehikot.vibe', url: back.url }))
      const got = await running
      await back.close()
      expect(got).toEqual({ code: 0, out: `${REWRITE}\n` })
      expect(back.asked).toHaveLength(1)
      expect(existsSync(join(dir, 'kehikot', 'unguarded'))).toBe(false)
    }, 15_000)

    test('the stable address is asked first; the host saying the module is not up yet is waited out, and the guard applies', async () => {
      const host = await standIn('away')
      const dir = await kitWith({ origin: await deadUrl() })
      writeFileSync(join(dir, 'kehikot', 'stable'), host.url)
      const running = ran(dir, JSON.stringify(bash('bun test')), { KEHIKOT_GUARD_WAIT: '10' })
      await Bun.sleep(1500)
      host.set({ status: 200, body: REWRITE })
      const got = await running
      await host.close()
      expect(got).toEqual({ code: 0, out: `${REWRITE}\n` })
      expect(host.asked.length).toBeGreaterThan(1)
      expect(host.asked.every((one) => one === `/api/guard?session=${SESSION}&direct=0`)).toBe(true)
    }, 15_000)

    test('the module saying it cannot know the guards yet (503) is asked again, not taken for "no guards"', async () => {
      const module = await standIn({ status: 503, body: '{"ok":false}' })
      const dir = await kitWith({ origin: module.url })
      const running = ran(dir, JSON.stringify(bash('bun test')), { KEHIKOT_GUARD_WAIT: '10' })
      await Bun.sleep(1200)
      module.set({ status: 200, body: REWRITE })
      expect(await running).toEqual({ code: 0, out: `${REWRITE}\n` })
      await module.close()
    }, 15_000)

    test('while Kehikot stays away, the next calls do not wait again; once it answers, they wait again next time', async () => {
      const dir = await kitWith({ origin: await deadUrl() })
      await ran(dir, JSON.stringify(bash('bun test')), { KEHIKOT_GUARD_WAIT: '1' })
      const started = Date.now()
      const again = await ran(dir, JSON.stringify(bash('bun test')), { KEHIKOT_GUARD_WAIT: '10' })
      expect(Date.now() - started).toBeLessThan(5000)
      expect(again.out).toContain('ran without the guards')
      const module = await standIn({ status: 204, body: '' })
      writeFileSync(join(dir, 'kehikot', 'origin'), module.url)
      expect(await ran(dir, JSON.stringify(bash('bun test')))).toEqual({ code: 0, out: '' })
      await module.close()
      expect(existsSync(join(dir, 'kehikot', 'away'))).toBe(false)
    }, 15_000)
  })
})
