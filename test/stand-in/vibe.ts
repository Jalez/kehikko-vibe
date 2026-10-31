/**
 * A stand-in for the Mistral Vibe CLI, for tests: it takes the arguments this module passes, keeps
 * a record where Vibe 3.0.4 keeps one, holds its lease while it runs, says its state on its terminal
 * the way Vibe's TUI does (OSC 7501, once the terminal answers its query), and runs the hooks of
 * every `--add-dir` folder's `.vibe/hooks.toml` at the moments Vibe's docs say (program.ts). It
 * never talks to any model.
 *
 *   --help                 what `supports` reads. STANDIN_OLD=1: no `--resume`; STANDIN_NOHOOKS=1: no `--add-dir`.
 *   [--resume <id> [line]] [--add-dir <dir>]… [--agent <a>]   a session.
 *
 * Doors come from `VIBE_MCP_SERVERS`; an added folder's `AGENTS.md` is printed (`notes:`) as what
 * the session was told. Typed lines:
 *
 *   a line                 working, the record, post_agent (Stop), done, the echo
 *   /tool                  working, post_tool (context printed when a hook answers), post_agent, done
 *   /ask                   working, blocked:kind=permission; the next line answers: post_tool, post_agent, done
 *   /question              working, blocked:kind=question; the next line answers
 *   /work                  working, dots until /interrupt (idle)
 *   /subagent <name> <task>   a subagent's session, and post_agent with its parent
 *   /compact               fewer tokens in the record
 *   /clear                 a new conversation (a new id), its AGENTS.md read again
 *   /mcp <server> <tool>   calls that door's tool, as Vibe would
 *   /exit                  ends
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const out = (text: string) => process.stdout.write(text.replace(/\n/g, '\r\n'))

if (argv[0] === '--help') {
  out('Run the Mistral Vibe interactive CLI\n\nUsage: vibe [OPTIONS] [INITIAL_PROMPT]\n\nOptions:\n')
  if (!process.env.STANDIN_OLD) out('      --resume [<RESUME>]  Resume a session. Without SESSION_ID, shows an interactive picker.\n')
  if (!process.env.STANDIN_NOHOOKS) out('      --add-dir <ADD_DIR>  Additional working directory for file access. Repeat the flag.\n')
  out('      --agent <NAME>       Agent to use\n  -v, --version            Show version and exit.\n')
  process.exit(0)
}

const home = process.env.VIBE_HOME || join(process.env.HOME ?? '/tmp', '.vibe')
const save = process.env.VIBE_SESSION_LOGGING__SAVE_DIR || join(home, 'logs', 'session')
const adds: string[] = []
let resume: string | null = null
let agent: string | null = null
let line: string | undefined
for (let i = 0; i < argv.length; i++) {
  const one = argv[i]!
  if (one === '--add-dir') adds.push(argv[++i] ?? '')
  else if (one === '--agent') agent = argv[++i] ?? null
  else if (one === '--resume') resume = argv[++i] ?? null
  else if (!one.startsWith('-')) line = one
}

/* Hooks: the `[[hooks]]` tables of each added folder's `.vibe/hooks.toml`, in the shape this module writes. */
type Hook = { name: string; type: string; match?: string; command: string }
const hooks: Hook[] = []
for (const dir of adds) {
  const file = join(dir, '.vibe', 'hooks.toml')
  if (!existsSync(file)) continue
  for (const table of readFileSync(file, 'utf8').split('[[hooks]]').slice(1)) {
    const field = (key: string) => {
      const said = new RegExp(`^${key} = ("(?:[^"\\\\]|\\\\.)*")`, 'm').exec(table)?.[1]
      return said ? (JSON.parse(said) as string) : undefined
    }
    const name = field('name')
    const type = field('type')
    const command = field('command')
    if (name && type && command && !hooks.some((one) => one.name === name)) hooks.push({ name, type, command, ...(field('match') ? { match: field('match') } : {}) })
  }
}
const notesOf = (): string => adds.map((dir) => join(dir, 'AGENTS.md')).filter(existsSync).map((file) => readFileSync(file, 'utf8')).join('\n')
let doors = new Map<string, string>()
try {
  for (const one of JSON.parse(process.env.VIBE_MCP_SERVERS ?? '[]') as { name: string; url: string }[]) doors.set(one.name, one.url)
} catch {
  doors = new Map()
}

const newId = () => {
  const head = randomBytes(10).toString('hex')
  return `${head.slice(0, 8)}-${head.slice(8, 12)}-${head.slice(12, 16)}-${head.slice(16, 20)}-${randomBytes(6).toString('hex')}`
}
const dirOf = (id: string) => join(save, 'unified', id)
let session: string = resume ?? newId()
if (resume && !existsSync(join(dirOf(resume), 'CURRENT'))) {
  out(`Session not found: ${resume}\n`)
  process.exit(1)
}
let generation = 0
let tokens = 9000
let preview = ''
let recorded = Boolean(resume)
const write = (id: string, fields: { preview?: string; parent?: string | null; tokens?: number } = {}) => {
  generation += 1
  const g = String(generation).padStart(16, '0')
  mkdirSync(join(dirOf(id), 'generations', g), { recursive: true })
  const total = fields.tokens ?? tokens
  const projection = { projection_state_version: 1, session_id: id, snapshot_sequence: generation, watermark: 0, snapshot: { format: 'vibe.public-session-state/v1', event_id: 0, session: { id, parent_session_id: fields.parent ?? null, title: null, preview: fields.preview ?? preview, status: { type: 'idle' }, created_at: Date.now(), updated_at: Date.now(), cwd: process.cwd(), model: 'mistral-medium-3.5', context_usage: { input_tokens: total - 50, output_tokens: 50, total_tokens: total, cached_input_tokens: 4000 } }, history: null } }
  writeFileSync(join(dirOf(id), 'generations', g, 'projection-state.json'), JSON.stringify(projection))
  writeFileSync(join(dirOf(id), 'CURRENT'), JSON.stringify({ store_format: 'mistral.vibe.unified-session-store/v1', session_id: id, generation: g, snapshot_sequence: generation, manifest_sha256: '0'.repeat(64) }))
}
const lease = (id: string, on: boolean) => {
  const dir = join(save, 'active')
  mkdirSync(dir, { recursive: true })
  if (on) {
    writeFileSync(join(dir, `${id}.lock`), '')
    writeFileSync(join(dir, `${id}.lock.json`), JSON.stringify({ lease_version: 1, session_id: id, process_id: process.pid, acquired_at: new Date().toISOString() }))
  } else {
    rmSync(join(dir, `${id}.lock`), { force: true })
    rmSync(join(dir, `${id}.lock.json`), { force: true })
  }
}

/* Its state on its terminal: asked once at start; reported only if the terminal answered. */
let reports = false
const report = (state: string) => {
  if (reports) process.stdout.write(`\u001b]7501;state=${state}:app=vibe\u001b\\`)
}

async function fire(type: string, more: Record<string, unknown> = {}, tool?: string): Promise<void> {
  const glob = (pattern: string, name: string) => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i').test(name)
  for (const hook of hooks.filter((one) => one.type === type && (type !== 'post_tool' || !one.match || (tool !== undefined && glob(one.match, tool))))) {
    const input = JSON.stringify({ session_id: session, parent_session_id: null, transcript_path: join(dirOf(session), 'CURRENT'), cwd: process.cwd(), hook_event_name: type, ...more })
    const child = Bun.spawn(['/bin/sh', '-c', hook.command], { stdin: new Blob([input]), stdout: 'pipe', stderr: 'ignore', env: process.env, cwd: process.cwd() })
    const said = await new Response(child.stdout).text()
    await child.exited
    try {
      const context = (JSON.parse(said) as { hook_specific_output?: { additional_context?: string } }).hook_specific_output?.additional_context
      if (context) out(`context(${type}): ${context.split('\n')[0]}\n`)
    } catch {
      /* Plain output, or nothing. */
    }
  }
}

const turn = async (said: string, open = false) => {
  report('working')
  if (!preview) preview = said
  tokens += 1500
  write(session)
  recorded = true
  if (open) return
  await fire('post_agent', { agent_name: agent ?? 'main' })
  report('done')
}

out(`stand-in vibe: ${resume ? `RESUMED session ${session}` : 'NEW session'}\n`)
out(`args: ${JSON.stringify(argv.filter((one) => !adds.includes(one)))} hooks=${hooks.length} doors=${[...doors.keys()].join(',')} model=${process.env.VIBE_ACTIVE_MODEL ?? ''}\n`)
out(`cwd: ${process.cwd()}\n`)
const notes = notesOf()
if (notes) out(`notes: ${notes.split('\n').find((one) => one.trim() && !one.startsWith('#'))?.slice(0, 120) ?? ''}\n`)
lease(session, true)
process.stdout.write('\u001b]7501;?\u001b\\')

let dots: ReturnType<typeof setInterval> | null = null
let asking = false
const quiet = () => {
  if (dots) clearInterval(dots)
  dots = null
}
process.on('SIGHUP', () => {
  out('stand-in vibe: hung up\n')
  process.exit(0)
})
process.on('exit', () => lease(session, false))

let buffer = ''
let begun = false
const start = async () => {
  if (begun) return
  begun = true
  if (line) await turn(line)
  out('> ')
}
const waited = setTimeout(() => void start(), 500)
for await (const chunk of process.stdin) {
  buffer += String(chunk)
  /* The terminal's answer to the query: reports on. */
  if (buffer.includes('\u001b]7501;?\u001b\\')) {
    buffer = buffer.replace('\u001b]7501;?\u001b\\', '')
    reports = true
    clearTimeout(waited)
    report('idle')
    await start()
  }
  let at: number
  while ((at = buffer.search(/[\r\n]/)) >= 0) {
    const said = buffer.slice(0, at)
    buffer = buffer.slice(at + 1)
    if (!said) continue
    await start()
    if (asking) {
      asking = false
      out(`answered: ${said}\n`)
      report('working')
      await fire('post_tool', { tool_name: 'file_system.bash', tool_status: 'success' }, 'bash')
      await fire('post_agent', { agent_name: agent ?? 'main' })
      report('done')
    } else if (said === '/exit') {
      quiet()
      out('bye\n')
      process.exit(0)
    } else if (said === '/interrupt' || said === '\x1b') {
      quiet()
      report('idle')
      out('interrupted\n')
    } else if (said === '/work') {
      await turn(said, true)
      dots = setInterval(() => out('.'), 1000)
    } else if (said === '/tool') {
      await turn(said, true)
      await fire('post_tool', { tool_name: 'file_system.read_file', tool_status: 'success' }, 'read_file')
      await fire('post_agent', { agent_name: agent ?? 'main' })
      report('done')
    } else if (said === '/ask') {
      await turn(said, true)
      report('blocked:kind=permission')
      out('stand-in vibe: may I? (the next line is the answer)\n')
      asking = true
    } else if (said === '/question') {
      await turn(said, true)
      report('blocked:kind=question')
      out('stand-in vibe: a question (the next line is the answer)\n')
      asking = true
    } else if (said.startsWith('/subagent ')) {
      const [, name, ...task] = said.split(' ')
      await turn(said, true)
      const child = newId()
      write(child, { preview: task.join(' '), parent: session, tokens: 100 })
      const input = { session_id: child, parent_session_id: session, agent_name: name }
      for (const hook of hooks.filter((one) => one.type === 'post_agent')) {
        const run = Bun.spawn(['/bin/sh', '-c', hook.command], { stdin: new Blob([JSON.stringify({ ...input, transcript_path: '', cwd: process.cwd(), hook_event_name: 'post_agent' })]), stdout: 'ignore', stderr: 'ignore', env: process.env })
        await run.exited
      }
      await fire('post_agent', { agent_name: agent ?? 'main' })
      report('done')
      out(`subagent ${name} done\n`)
    } else if (said === '/compact') {
      tokens = 3000
      if (recorded) write(session)
      out('compacted\n')
    } else if (said === '/clear') {
      lease(session, false)
      session = newId()
      preview = ''
      recorded = false
      lease(session, true)
      const again = notesOf()
      out(`cleared${again ? `; notes: ${again.split('\n').find((one) => one.trim() && !one.startsWith('#'))?.slice(0, 120) ?? ''}` : ''}\n`)
    } else if (said.startsWith('/mcp ')) {
      const [, server, tool, ...args] = said.split(' ')
      const url = doors.get(server ?? '')
      if (!url) out(`no MCP server ${server}\n`)
      else {
        try {
          const call = (body: unknown, id?: string) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(id ? { 'mcp-session-id': id } : {}) }, body: JSON.stringify(body) })
          const init = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'stand-in vibe', version: '0' } } })
          const sid = init.headers.get('mcp-session-id') ?? undefined
          const answer = await call({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: tool, arguments: args.length ? JSON.parse(args.join(' ')) : {} } }, sid)
          out(`mcp ${server} ${tool}: ${(await answer.text()).slice(0, 2000)}\n`)
        } catch (error) {
          out(`mcp ${server} ${tool} failed: ${error instanceof Error ? error.message : String(error)}\n`)
        }
      }
    } else {
      await turn(said)
      out(`you said: ${said}\n`)
    }
    out('> ')
  }
}
