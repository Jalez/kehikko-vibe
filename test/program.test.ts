import { afterAll, describe, expect, test } from 'bun:test'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { spawnSync } from 'node:child_process'

import { PROGRAM, TELLS, deniedWrite, firstPrompt, folderOfRecord, hasUv, headOf, home, installFor, labelOf, learnSession, metaOf, recordFile, sessionName, sessionsRoot, vibeHome } from '../program.ts'
import { CONFIG, HOME } from './setup.ts'
import { removeRollout, typed, writeRollout } from './transcripts.ts'

/**
 * The adapter, against a stand-in `vibe` and a scratch `VIBE_HOME`.
 *
 * Nothing here runs the real program or reads a real record: `test/setup.ts` has already pointed
 * the home folder, `VIBE_HOME` and PATH at scratch.
 */

const STAND_IN = join(import.meta.dir, 'stand-in', 'vibe')
const made: string[] = []
const scratch = (name: string) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `kehikko-vibe-${name}-`)))
  made.push(dir)
  return dir
}
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true })
  rmSync(join(HOME, '.local'), { recursive: true, force: true })
  rmSync(join(CONFIG, 'logs'), { recursive: true, force: true })
})

const A = '0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9'
const B = '1a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9'
const C = '2a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9'

const tool = (dir: string, name: string, body: string) => {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`)
  chmodSync(join(dir, name), 0o755)
}
const executable = (file: string) => {
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, '#!/bin/sh\n')
  chmodSync(file, 0o755)
}

describe('finding the binary', () => {
  test('the test’s machine is scratch: a home of its own and Vibe’s folder beside it', () => {
    expect(home()).toBe(HOME)
    expect(vibeHome()).toBe(CONFIG)
    expect(sessionsRoot()).toBe(join(CONFIG, 'logs', 'session'))
    expect(sessionsRoot({ VIBE_SESSION_LOGGING__SAVE_DIR: '/s' })).toBe('/s')
  })

  test('on PATH first, then the usual places a thin PATH leaves out', () => {
    const bin = scratch('bin')
    copyFileSync(STAND_IN, join(bin, 'vibe'))
    chmodSync(join(bin, 'vibe'), 0o755)
    const found = PROGRAM.find({ HOME, PATH: `/nowhere:${bin}` })
    expect(found.file).toBe(join(bin, 'vibe'))
    expect(found.looked).toEqual(['/nowhere', bin])
    const none = PROGRAM.find({ HOME, PATH: '/usr/bin:/bin' })
    expect(none.file).toBeNull()
    expect(none.looked).toContain(join(HOME, '.local', 'bin'))
    expect(none.looked).toContain('/opt/homebrew/bin')
  })

  test('in ~/.local/bin, where `uv tool` puts it, and found by the next look once it appears', () => {
    const at = scratch('home')
    const env = { HOME: at, PATH: '/usr/bin:/bin' }
    expect(PROGRAM.find(env).file).toBeNull()
    executable(join(at, '.local', 'bin', 'vibe'))
    expect(PROGRAM.find(env).file).toBe(join(at, '.local', 'bin', 'vibe'))
    expect(PROGRAM.find(env).usual[0]).toBe(join(at, '.local', 'bin'))
  })
})

describe('whether a copy can do what is asked of it', () => {
  test('one with `--resume` and `--add-dir` can, and takes hooks, skills and doors for one process', async () => {
    expect(await PROGRAM.supports(STAND_IN)).toMatchObject({ ok: true, missing: null, tells: true, lists: true, configures: true, plugins: true, backgrounds: false, names: false })
  })

  test('one with no `--resume` is too old, and says what it lacks', async () => {
    const bin = scratch('old')
    writeFileSync(join(bin, 'vibe'), `#!/bin/sh\nSTANDIN_OLD=1 exec ${JSON.stringify(STAND_IN)} "$@"\n`)
    chmodSync(join(bin, 'vibe'), 0o755)
    expect(await PROGRAM.supports(join(bin, 'vibe'))).toMatchObject({ ok: false, missing: '--resume' })
  })

  test('one with no `--add-dir` gets no folder: no hooks, no skills, no doors', async () => {
    const bin = scratch('noadd')
    writeFileSync(join(bin, 'vibe'), `#!/bin/sh\nSTANDIN_NOHOOKS=1 exec ${JSON.stringify(STAND_IN)} "$@"\n`)
    chmodSync(join(bin, 'vibe'), 0o755)
    expect(await PROGRAM.supports(join(bin, 'vibe'))).toMatchObject({ ok: false, missing: '--add-dir', tells: false, configures: false, plugins: false })
  })

  test('one whose help cannot be read is not called too old: nothing was learned, and nothing extra is passed', async () => {
    const bin = scratch('mute')
    writeFileSync(join(bin, 'vibe'), '#!/bin/sh\nexit 3\n')
    chmodSync(join(bin, 'vibe'), 0o755)
    expect(await PROGRAM.supports(join(bin, 'vibe'))).toMatchObject({ ok: true, tells: false, configures: false })
  })
})

describe('starting and resuming', () => {
  test('a new session has no arguments of its own — Vibe chooses the id; a resumed one is `--resume <id>`', () => {
    expect(PROGRAM.fresh(A)).toEqual([])
    expect(PROGRAM.resume(A)).toEqual(['--resume', A])
    expect(PROGRAM.resume(A, undefined, 'carry on')).toEqual(['--resume', A, 'carry on'])
    /* A line that reads as a flag is never passed. */
    expect(PROGRAM.resume(A, undefined, '--yolo')).toEqual(['--resume', A])
    expect(() => PROGRAM.resume('--yolo')).toThrow()
  })

  test('an id it mints is one it accepts, and what is not an id is refused', () => {
    expect(PROGRAM.isId(PROGRAM.newId())).toBe(true)
    expect(PROGRAM.isId(A)).toBe(true)
    expect(PROGRAM.isId('not-an-id')).toBe(false)
  })

  test('the session’s environment does not move its folder or its back end', () => {
    const env = PROGRAM.environment({ PATH: '/bin', VIBE_CWD: '/elsewhere', VIBE_APP_SERVER_CMD: 'x', VIBE_HOME: '/h', MISTRAL_API_KEY: 'k' })
    expect(env).toEqual({ PATH: '/bin', VIBE_HOME: '/h', MISTRAL_API_KEY: 'k' })
  })

  test('a session runs the person’s bun and node, never the ones the host put first on this module’s PATH', () => {
    const dir = scratch('person-env')
    const hostShim = join(dir, 'kehikot-bun-1')
    const bunNode = join(dir, 'bun-node-502-x')
    for (const one of [hostShim, bunNode]) {
      mkdirSync(one)
      symlinkSync(process.execPath, join(one, 'bun'))
    }
    symlinkSync(process.execPath, join(bunNode, 'node'))
    const person = join(dir, 'person')
    tool(person, 'bun', 'echo person-bun')
    const env = PROGRAM.environment({ PATH: [bunNode, hostShim, person, '/usr/bin', '/bin'].join(delimiter), KEHIKOT_HOST_PATH: hostShim, BUN_BE_BUN: '1' })
    expect(env.BUN_BE_BUN).toBeUndefined()
    expect(env.KEHIKOT_HOST_PATH).toBeUndefined()
    expect(env.PATH).toBe([person, '/usr/bin', '/bin'].join(delimiter))
    const ran = spawnSync('/bin/sh', ['-c', 'command -v bun; bun --version'], { env, encoding: 'utf8' })
    expect(ran.stdout).toBe(`${join(person, 'bun')}\nperson-bun\n`)
  })
})

describe('the hooks, in the session’s own folder', () => {
  test('one `[[hooks]]` table per command, named this module’s own, with a match for every tool hook', () => {
    const text = PROGRAM.hooksFile([
      { event: 'post_tool', matcher: '*', commands: [{ command: "/bin/sh '/x/tell.sh' Tool", timeout: 5 }, { command: '/bin/sh /k/context.sh PostToolUse', timeout: 10 }] },
      { event: 'post_agent', commands: [{ command: "/bin/sh '/x/tell.sh' Stop", timeout: 5 }] },
    ])
    expect(text).toContain('[[hooks]]\nname = "kehikot-vibe-post-tool-1"\ntype = "post_tool"\nmatch = "*"\ncommand = "/bin/sh \'/x/tell.sh\' Tool"\ntimeout = 5.0')
    expect(text).toContain('name = "kehikot-vibe-post-tool-2"')
    expect(text).toContain('name = "kehikot-vibe-post-agent-3"\ntype = "post_agent"\ncommand')
    expect(text).not.toContain('strict')
  })

  test('tell.sh runs after a tool and after an agent’s turn; nothing else is hooked', () => {
    expect(TELLS.map((one) => `${one.event}:${one.says}`)).toEqual(['post_tool:Tool', 'post_agent:Stop'])
  })

  test('what each status word means: working, needs you, finished; idle is decided by the run', () => {
    expect(PROGRAM.signal('working')).toBe('working')
    expect(PROGRAM.signal('blocked')).toBe('needs-you')
    expect(PROGRAM.signal('done')).toBe('finished')
    expect(PROGRAM.signal('error')).toBe('finished')
    expect(PROGRAM.signal('idle')).toBeNull()
    expect(PROGRAM.signal('Stop')).toBeNull()
  })
})

describe('reading a project’s sessions', () => {
  test('a generation’s public session says the folder, whether it is a person’s, its words and its context', () => {
    const meta = metaOf({ snapshot: { session: { id: A, cwd: '/p', title: 'Fix the login', preview: 'fix the login bug\nplease', updated_at: 5, model: 'mistral-medium-3.5', context_usage: { input_tokens: 900, output_tokens: 100, total_tokens: 1000, cached_input_tokens: 400 } } } })
    expect(meta).toEqual({ id: A, cwd: '/p', person: true, title: 'Fix the login', preview: 'fix the login bug\nplease', updatedAt: 5, model: 'mistral-medium-3.5', context: { input: 900, cached: 400, output: 100, total: 1000 } })
    expect(labelOf(meta)).toBe('Fix the login')
    expect(firstPrompt(meta)).toBe('fix the login bug')
    expect(metaOf({ snapshot: { session: { id: B, parent_session_id: A } } })?.person).toBe(false)
    expect(metaOf({ snapshot: { session: { id: 'nope' } } })).toBeNull()
    expect(metaOf(null)).toBeNull()
  })

  test('a folder’s sessions, most recently active first; a subagent’s session is not a conversation', async () => {
    const project = scratch('project')
    writeRollout(A, project, [typed(1, 'first one')], 1_000)
    writeRollout(B, project, [typed(2, 'second one')], 2_000)
    writeRollout(C, project, [typed(3, 'a subagent’s task')], 3_000, { parent_session_id: A })
    const listed = await PROGRAM.sessions(project)
    expect(listed.map((one) => [one.id, one.label])).toEqual([[B, 'second one'], [A, 'first one']])
    /* Asked for by id, a subagent's is listed. */
    expect((await PROGRAM.sessions(project, [C])).map((one) => one.id)).toContain(C)
    expect(await folderOfRecord(A)).toBe(project)
    for (const id of [A, B, C]) removeRollout(id)
  })

  test('a session exists once Vibe has a record of it; a new one is named by its own hooks', async () => {
    const project = scratch('settle')
    const opened = PROGRAM.newId()
    expect(await PROGRAM.settled(project, opened, 0)).toBeNull()
    learnSession(opened, A)
    expect(await PROGRAM.settled(project, opened, 0)).toBeNull()
    writeRollout(A, project)
    expect(await PROGRAM.settled(project, opened, 0)).toBe(A)
    expect(await recordFile(project, A)).toBe(join(CONFIG, 'logs', 'session', 'unified', A, 'CURRENT'))
    removeRollout(A)
  })

  test('a conversation keeps one id: where it is now is that id', () => {
    expect(headOf(A)).toBe(A)
  })

  test('a place’s name is one line, never a flag', () => {
    expect(sessionName(['--yolo', 'x\ny'])).toBe('--yolo · x y'.replace(/^-+\s*/, ''))
    expect(sessionName(['a', null, 'b'])).toBe('a · b')
  })
})

describe('which process holds which conversation', () => {
  const lease = (id: string, pid: number, lock = true) => {
    const dir = join(sessionsRoot(), 'active')
    mkdirSync(dir, { recursive: true })
    if (lock) writeFileSync(join(dir, `${id}.lock`), '')
    writeFileSync(join(dir, `${id}.lock.json`), JSON.stringify({ lease_version: 1, session_id: id, process_id: pid, acquired_at: '2026-10-31T10:00:00Z' }))
  }

  test('a lease whose process is running is a conversation running there; one left behind is not', async () => {
    const project = scratch('active')
    writeRollout(A, project)
    lease(A, process.pid)
    lease(B, 999_999)
    lease(C, process.pid, false)
    const running = await PROGRAM.active(STAND_IN)
    expect(running.known).toBe(true)
    if (!running.known) return
    expect(running.active.map((one) => [one.session, one.pid, one.cwd])).toEqual([[A, process.pid, project]])
    rmSync(join(sessionsRoot(), 'active'), { recursive: true, force: true })
    removeRollout(A)
  })

  test('no leases folder is nothing running', async () => {
    expect(await PROGRAM.active(STAND_IN)).toEqual({ known: true, active: [] })
  })
})

describe('installing', () => {
  test('with uv here, uv’s own command; otherwise the vendor’s installer — neither asks for admin rights', () => {
    const root = scratch('nouv')
    const bare = { HOME: root, PATH: '/usr/bin:/bin', KEHIKOT_VIBE_TOOL_DIRS: '' }
    expect(hasUv(bare)).toBe(false)
    expect(PROGRAM.install(bare)).toMatchObject({ line: 'curl -LsSf https://mistral.ai/vibe/install.sh | bash', lands: '~/.local/bin', source: 'https://docs.mistral.ai/vibe/code/cli/install-setup' })
    tool(join(root, 'bin'), 'uv', 'exit 0')
    expect(installFor({ ...bare, PATH: join(root, 'bin') }).line).toBe('uv tool install mistral-vibe')
    for (const env of [bare, { ...bare, PATH: join(root, 'bin') }]) expect(PROGRAM.install(env).line).not.toMatch(/sudo/)
  })

  test('is run with the places uv lives on its PATH', () => {
    const env = PROGRAM.installEnvironment({ PATH: '/usr/bin', HOME: '/h' })
    expect(env.PATH).toContain('/h/.local/bin')
    expect(env.PATH!.startsWith('/usr/bin')).toBe(true)
  })

  test('a stand-in can be named by whoever started the server', () => {
    expect(PROGRAM.install({ KEHIKOT_VIBE_INSTALL_LINE: 'sh stand-in.sh' }).line).toBe('sh stand-in.sh')
  })
})

describe('when the install did not finish', () => {
  test('a refusal to write is known by its words, through the terminal’s colours', () => {
    expect(deniedWrite('\u001b[31merror\u001b[0m EACCES')).toBe(true)
    expect(deniedWrite('Error: permission denied, open')).toBe(true)
    expect(deniedWrite('404 Not Found')).toBe(false)
  })

  test('is said in a sentence with the next step, never a trace', () => {
    expect(PROGRAM.explain('', 0, 'x')).toContain('~/.local/bin')
    expect(PROGRAM.explain('sh: uv: command not found', 127, 'uv tool install mistral-vibe')).toContain('install.sh')
    expect(PROGRAM.explain('permission denied', 1, 'uv tool install mistral-vibe')).toContain("can't write")
    expect(PROGRAM.explain('boom', 7, 'uv tool install mistral-vibe')).toBe('The installer exited with 7. See the log, or run uv tool install mistral-vibe in a terminal.')
  })
})
