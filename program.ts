import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { accessSync, constants, realpathSync, statSync } from 'node:fs'
import { open, readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

import { personEnv } from 'kehikot-module-protocol/serve'

/**
 * The program this module opens, and everything that is specific to it.
 *
 * ## This is the only file that knows it is Mistral Vibe
 *
 * The rest of the module is a terminal that holds one session per place: a pty, a record of
 * which session belongs where, a list to choose from. Everything that knows the program is
 * Mistral's Vibe CLI is here, as one value of one interface — `Program`, the same interface the
 * Claude and Codex modules answer for their programs.
 *
 * What a program has to answer, and it is the whole list:
 *
 *  1. **Where is the binary?** (`find`) The desktop app starts modules with a thin PATH.
 *  2. **Can this copy do what is asked of it?** (`supports`)
 *  3. **How is a new session started, and how is one resumed?** (`fresh`, `resume`) As argv.
 *  4. **Does a session exist yet, and under which id?** (`settled`) Vibe chooses a new session's
 *     id itself; the session's own hooks name it (`learnSession`).
 *  5. **Which sessions does it hold for a folder?** (`sessions`)
 *  6. **How is it installed?** (`install`)
 *  7. **Can it say what it is doing?** (`signal`) Vibe's own terminal status reports (OSC 7501,
 *     status.ts), which the pty this module holds asks for, as a terminal that supports them does.
 *  8. **Is a session already open in another process?** (`active`) Vibe holds a lease per
 *     conversation while a process runs it, with the process's id beside it.
 *
 * ## What is never here
 *
 * A prompt of anybody's but the person's: the person types. The one sentence this module ever
 * sends is its own, fixed, to a conversation a restart cut off mid-turn, when the person opens it
 * again, behind a setting they can turn off (`RESUME_LINE` in live.ts). And no flag that widens
 * what the program may do: never `--auto-approve`/`--yolo`, never `--trust`. A session opened here
 * has exactly the permissions `vibe` would have in any terminal in that folder, with the agent the
 * person chose in Settings (`--agent`, never `auto-approve`).
 *
 * ## Every command line this module ever runs, and it is the whole list
 *
 *     vibe --help                                      once per binary: which flags it has
 *     vibe --add-dir <kit> [--agent <a>]               a new session
 *     vibe --resume <id> [<line>] --add-dir <kit> …    a session nothing else holds
 *
 * Everything per run rides on two of Vibe's own mechanisms, and `~/.vibe` is never written:
 *
 *  - `--add-dir <kit>`: the session's own folder (skills.ts). Vibe trusts an added directory for
 *    that session and reads its `.vibe/hooks.toml`, `.vibe/skills/` and `AGENTS.md` beside the
 *    project's own (read in Vibe 3.0.4's source: `HarnessFilesManager.project_roots`).
 *  - `VIBE_MCP_SERVERS` in the process's environment: Vibe's `VIBE_<KEY>` layer, which sits over
 *    the person's `config.toml` and is merged with it by server name (`WithUnionMerge`).
 *
 * Read in Vibe 3.0.4's source (github.com/mistralai/mistral-vibe at 338ad4b) and its docs at
 * docs.mistral.ai/vibe/code/cli, 2026-10-31. No copy was run against Mistral's API.
 */

export interface Found {
  /** The binary, absolute, or null when no candidate is an executable file. */
  file: string | null
  /** Every directory looked in, in the order it was looked in. */
  looked: string[]
  /** The ones among them that are not from PATH: the usual places an install lands. */
  usual: string[]
}

export interface Able {
  ok: boolean
  /** What this copy lacks, for the sentence on screen. Null when ok, or when nothing could be told. */
  missing: string | null
  /** Whether this copy runs hooks given for one process (`--add-dir` with `.vibe/hooks.toml`): how a session names its conversation. */
  tells: boolean
  /** Whether this copy can be asked which process holds a conversation (its leases). */
  lists: boolean
  /** Whether this copy takes a display name for a session. Vibe does not, at start. */
  names?: boolean
  /** Whether this copy takes MCP servers for one process (`VIBE_MCP_SERVERS`): how a session is given its place. */
  configures?: boolean
  /** Whether a session can be given this module's skills (`--add-dir` with `.vibe/skills/`). */
  plugins?: boolean
  /** Whether this copy runs a session in the background that outlives this process. Vibe does not. */
  backgrounds?: boolean
}

/** A session started or woken in the background, or why not. Vibe never is: the type stays for the interface. */
export type Backgrounded = { ok: true; handle: string; active: Active } | { ok: false; why: string }

/**
 * One conversation a process holds now, as its lease says.
 *
 * Vibe 3.0.4 keeps `<save_dir>/active/<session id>.lock` locked by the process running the
 * conversation, and writes `<id>.lock.json` beside it with that process's id (`SessionLease` in
 * its harness). Both go when the conversation is let go.
 */
export interface Active {
  session: string
  /** Always `interactive` for Vibe: nothing it runs can be attached to. */
  kind: 'background' | 'interactive' | 'other'
  called: string
  /** What `attach` would take. Null: Vibe has no attach. */
  handle: string | null
  pid: number | null
  cwd: string
  startedAt: number | null
  name: string
  state?: State | null
  status?: ActiveStatus | null
}

export type ActiveStatus = 'idle' | 'busy' | 'waiting' | 'shell'

export type Running = { known: true; active: Active[] } | { known: false; why: 'too-old' | 'failed' }

/** What a session is doing, as far as its program says. */
export type State = 'working' | 'needs-you' | 'finished'
export const STATES: readonly State[] = ['working', 'needs-you', 'finished']

/** One session as the program's own records describe it. */
export interface Recorded {
  id: string
  /** What the session is called: its title, else its first prompt, one line, cut short. `''` when nothing readable was found. */
  label: string
  firstPrompt?: string
  lastPrompt?: string
  prs?: { number: number; url: string }[]
  /** The sessions this conversation was carried on in. Vibe resumes a conversation under its own id, so none. */
  next?: string[]
  /** When the record last changed, in milliseconds. */
  lastActive: number
}

export interface Install {
  line: string
  lands: string
  source: string
  checked: string
}

/** Vibe's hook kinds (`HookType` in its source): before a tool, after a tool, after an agent's turn. */
export type HookEvent = 'pre_tool' | 'post_tool' | 'post_agent'

/** One group of hook handlers for one Vibe event: every command runs, in order. */
export interface HookGroup {
  event: HookEvent
  /** A glob (or `re:` regex) Vibe matches against the tool name, or the agent name for `post_agent`. Absent: every one. */
  matcher?: string
  commands: { command: string; timeout: number }[]
}

export interface Program {
  name: string
  binary: string
  find(env?: NodeJS.ProcessEnv): Found
  supports(file: string): Promise<Able>
  newId(): string
  isId(id: string): boolean
  fresh(id: string, name?: string): string[]
  resume(id: string, name?: string, line?: string): string[]
  settled(projectPath: string, id: string, since: number): Promise<string | null>
  sessions(projectPath: string, also?: readonly string[]): Promise<Recorded[]>
  install(env?: NodeJS.ProcessEnv): Install
  /** The environment the installer runs in: the one given, with the places `uv` and `curl` live added to PATH. */
  installEnvironment(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv
  /** What to tell the person when the installer ended without a binary: plain words and the next step. */
  explain(output: string, exitCode: number, ran: string, env?: NodeJS.ProcessEnv): string
  environment(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv
  /** The `.vibe/hooks.toml` that gives one process these hooks (written into its kit, skills.ts). */
  hooksFile(groups: readonly HookGroup[]): string
  /** What a status report's word means (status.ts): `working`, `blocked`, `done`, `error`; null for the rest. */
  signal(event: string): State | null
  active(file: string, env?: NodeJS.ProcessEnv): Promise<Running>
}

/* ------------------------------------------------------------------------ *
 * Mistral Vibe
 * ------------------------------------------------------------------------ */

const BINARY = 'vibe'

/** The home folder as the environment names it, which is what the program itself goes by. */
export function home(env: NodeJS.ProcessEnv = process.env): string {
  return env.HOME || homedir()
}

/**
 * Where Vibe keeps what it knows: `~/.vibe`, or wherever `VIBE_HOME` says — the variable the
 * program itself honours, which is also how a test points this at a scratch folder. Read, never
 * written: the conversations and their leases, and nothing else.
 */
export function vibeHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.VIBE_HOME || join(home(env), '.vibe')
}

/**
 * Where Vibe saves its conversations: `[session_logging] save_dir`, `$VIBE_HOME/logs/session` by
 * default. `VIBE_SESSION_LOGGING__SAVE_DIR` (Vibe's own override of the key) is honoured; a
 * `save_dir` written in the person's `config.toml` is not read (this module reads no config file
 * of theirs), and their conversations are then not listed here.
 */
export function sessionsRoot(env: NodeJS.ProcessEnv = process.env): string {
  const said = env.VIBE_SESSION_LOGGING__SAVE_DIR
  if (said && said.startsWith('/')) return said
  if (said && said.startsWith('~/')) return join(home(env), said.slice(2))
  return join(vibeHome(env), 'logs', 'session')
}

/**
 * The places an install usually lands that a thin PATH leaves out: `uv tool`'s bin folder (where
 * the official installer puts `vibe`), Homebrew's, and Cargo's.
 */
function usualDirs(env: NodeJS.ProcessEnv): string[] {
  const at = home(env)
  return [join(at, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', join(at, '.cargo', 'bin')]
}

/**
 * Where `uv` and `curl` usually are, beside PATH. `KEHIKOT_VIBE_TOOL_DIRS` (a PATH-style list,
 * empty for none) replaces them, which is how a test keeps this machine's real tools out of what it
 * checks.
 */
function toolDirs(env: NodeJS.ProcessEnv): string[] {
  const said = env.KEHIKOT_VIBE_TOOL_DIRS
  return said === undefined ? [join(home(env), '.local', 'bin'), join(home(env), '.cargo', 'bin'), '/opt/homebrew/bin', '/usr/local/bin'] : said.split(delimiter).filter(Boolean)
}

/** PATH with the usual places added after it, so `uv` is found under the desktop app's thin one. */
function installPath(env: NodeJS.ProcessEnv): string {
  const dirs = [...(env.PATH ?? '').split(delimiter).filter(Boolean), ...toolDirs(env), '/usr/bin', '/bin']
  return [...new Set(dirs)].join(delimiter)
}

function runnable(file: string): boolean {
  try {
    if (!statSync(file).isFile()) return false
    accessSync(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function find(env: NodeJS.ProcessEnv = process.env): Found {
  const looked: string[] = []
  const usual = usualDirs(env)
  const dirs = [...(env.PATH ?? '').split(delimiter).filter(Boolean), ...usual]
  for (const dir of dirs) {
    if (looked.includes(dir)) continue
    looked.push(dir)
    const file = join(dir, BINARY)
    if (runnable(file)) return { file, looked, usual }
  }
  return { file: null, looked, usual }
}

/**
 * The flags every session needs, checked against Vibe 3.0.4's `vibe --help` (its `cli.rs`):
 *
 *     --resume [SESSION_ID]   Resume a session. Without SESSION_ID, shows an interactive picker.
 *     --add-dir <ADD_DIR>     Additional working directory for file access. Repeat the flag.
 */
const NEEDS: readonly { said: string; test: RegExp }[] = [
  { said: '--resume', test: /--resume\b/ },
  { said: '--add-dir', test: /--add-dir\b/ },
]

const able = new Map<string, Able>()

/**
 * What the program prints for a command that only answers, read through a real pipe, whole.
 * Standard input closed; `''` for anything that went wrong.
 */
function answered(file: string, args: readonly string[], env?: NodeJS.ProcessEnv, more: { cwd?: string; timeout?: number } = {}): Promise<string> {
  return new Promise((done) => {
    const child = execFile('/bin/sh', ['-c', '"$0" "$@" </dev/null | /bin/cat', file, ...args], { timeout: more.timeout ?? 8000, maxBuffer: 16 * 1024 * 1024, ...(env ? { env } : {}), ...(more.cwd ? { cwd: more.cwd } : {}) }, (error, stdout) =>
      done(error ? '' : String(stdout ?? '')),
    )
    child.on('error', () => done(''))
  })
}

/**
 * Whether this copy has what is used, asked once per binary per build. A copy whose help cannot be
 * read at all is NOT called too old: nothing was learned, and nothing extra is passed either.
 */
async function supports(file: string): Promise<Able> {
  let stamp = file
  try {
    stamp = `${file}@${statSync(file).mtimeMs}`
  } catch {
    /* Gone between being found and being asked. */
  }
  const known = able.get(stamp)
  if (known) return known
  const help = await answered(file, ['--help'], environment())
  let said: Able
  if (!help) said = { ok: true, missing: null, tells: false, lists: false, names: false, configures: false, plugins: false, backgrounds: false }
  else {
    const missing = NEEDS.find((one) => !one.test.test(help))?.said ?? null
    const adds = /--add-dir\b/.test(help)
    said = { ok: missing === null, missing, tells: adds, lists: true, names: false, configures: adds, plugins: adds, backgrounds: false }
  }
  able.set(stamp, said)
  return said
}

/* ------------------------------------------------------------------------ *
 * Its records: <save_dir>/unified/<id>/CURRENT → generations/<g>/projection-state.json
 * ------------------------------------------------------------------------ */

/**
 * A session id as Vibe spells one: UUID-shaped, twenty random hex digits and a stable suffix of
 * twelve (`generate_session_id` in its harness).
 */
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const GENERATION = /^[0-9]{16}$/

/** Where the unified sessions are: one folder per conversation. */
export function unifiedRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(sessionsRoot(env), 'unified')
}

/**
 * Where Vibe keeps the record of session `id` — its `CURRENT` pointer, which names the newest
 * generation — or null when this computer has none.
 */
export async function recordFile(_projectPath: string, id: string, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  if (!SESSION_ID.test(id)) return null
  const file = join(unifiedRoot(env), id, 'CURRENT')
  try {
    return (await stat(file)).isFile() ? file : null
  } catch {
    return null
  }
}

export const LABEL_CHARS = 80
const TITLE_CHARS = 120
/** A generation's projection is small: the history is held apart, in chunks (`_detach_projection_history`). */
const PROJECTION_BYTES = 4 * 1024 * 1024

const line = (text: unknown, most: number): string => {
  const first = typeof text === 'string' ? (text.split('\n').map((one) => one.trim()).find(Boolean) ?? '') : ''
  return first.length > most ? `${first.slice(0, most - 1).trimEnd()}…` : first
}

const count = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null)

/**
 * What a generation's public session says: the folder, whether it is a person's own conversation,
 * its title and preview, when it changed, the model, and the tokens in its context.
 */
export interface Meta {
  id: string
  cwd: string
  /** A subagent's session, or one another session started, is not a conversation of the person's. */
  person: boolean
  title: string
  preview: string
  updatedAt: number | null
  model: string | null
  /** `context_usage`: what was in the window at the last request. */
  context: { input: number; cached: number; output: number; total: number } | null
}

/** The public session out of a projection state (`snapshot.session`), or null for anything else. */
export function metaOf(projection: unknown): Meta | null {
  const root = projection && typeof projection === 'object' ? (projection as Record<string, unknown>) : null
  const snapshot = root?.snapshot && typeof root.snapshot === 'object' ? (root.snapshot as Record<string, unknown>) : null
  const s = snapshot?.session && typeof snapshot.session === 'object' ? (snapshot.session as Record<string, unknown>) : null
  if (!s || typeof s.id !== 'string' || !SESSION_ID.test(s.id)) return null
  const usage = s.context_usage && typeof s.context_usage === 'object' ? (s.context_usage as Record<string, unknown>) : null
  const total = usage ? (count(usage.total_tokens) ?? 0) || (count(usage.input_tokens) ?? 0) + (count(usage.output_tokens) ?? 0) : 0
  return {
    id: s.id,
    cwd: typeof s.cwd === 'string' ? s.cwd : '',
    person: !s.parent_session_id && !s.started_by_session_id,
    title: typeof s.title === 'string' ? s.title : '',
    preview: typeof s.preview === 'string' ? s.preview : '',
    updatedAt: count(s.updated_at),
    model: typeof s.model === 'string' && s.model.trim() ? s.model.trim().slice(0, 80) : null,
    context: usage && total > 0 ? { input: count(usage.input_tokens) ?? 0, cached: count(usage.cached_input_tokens) ?? 0, output: count(usage.output_tokens) ?? 0, total } : null,
  }
}

/** The projection a `CURRENT` pointer names, parsed, or null. Only that one small file is read. */
export async function projectionAt(current: string): Promise<unknown> {
  try {
    const pointer = JSON.parse(await readFile(current, 'utf8')) as { generation?: unknown }
    if (typeof pointer.generation !== 'string' || !GENERATION.test(pointer.generation)) return null
    const file = join(current, '..', 'generations', pointer.generation, 'projection-state.json')
    const handle = await open(file, 'r')
    try {
      const size = (await handle.stat()).size
      if (size > PROJECTION_BYTES) return null
      const buffer = Buffer.alloc(size)
      await handle.read(buffer, 0, size, 0)
      return JSON.parse(buffer.toString('utf8'))
    } finally {
      await handle.close()
    }
  } catch {
    return null
  }
}

const described = new Map<string, { stamp: string; meta: Meta | null }>()

/** A session's meta from its record, read again only when its `CURRENT` changed. */
export async function describe(current: string): Promise<{ meta: Meta | null; lastActive: number } | null> {
  let info: { size: number; mtimeMs: number; ino: number }
  try {
    info = await stat(current)
  } catch {
    return null
  }
  const stamp = `${info.ino}@${info.size}@${info.mtimeMs}`
  const known = described.get(current)
  if (known?.stamp === stamp) return { meta: known.meta, lastActive: known.meta?.updatedAt ?? info.mtimeMs }
  const meta = metaOf(await projectionAt(current))
  described.set(current, { stamp, meta })
  while (described.size > 2048) described.delete(described.keys().next().value!)
  return { meta, lastActive: meta?.updatedAt ?? info.mtimeMs }
}

/** What a session is called: its title (Vibe writes one in the background), else its preview. */
export function labelOf(meta: Meta | null): string {
  if (!meta) return ''
  return line(meta.title, LABEL_CHARS) || line(meta.preview, LABEL_CHARS)
}

/** The first line of what a session's preview says: what a subagent was asked, for research.ts. */
export function firstPrompt(meta: Meta | null): string {
  return meta ? line(meta.preview, LABEL_CHARS) || line(meta.title, LABEL_CHARS) : ''
}

/** A folder as the program would name it: Vibe writes the path it resolved (`/tmp` is `/private/tmp`). */
function spellings(path: string): Set<string> {
  const out = new Set([path])
  try {
    out.add(realpathSync(path))
  } catch {
    /* Not there. */
  }
  return out
}

/** Every conversation folder under the unified root, by id. */
async function sessionDirs(env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  const names = await readdir(unifiedRoot(env)).catch(() => [] as string[])
  return names.filter((one) => SESSION_ID.test(one))
}

async function sessions(projectPath: string, also: readonly string[] = []): Promise<Recorded[]> {
  const folders = spellings(projectPath)
  const wanted = new Set(also.filter((id) => SESSION_ID.test(id)))
  const found: Recorded[] = []
  for (const id of await sessionDirs()) {
    const said = await describe(join(unifiedRoot(), id, 'CURRENT'))
    if (!said?.meta) continue
    const here = folders.has(said.meta.cwd) || [...spellings(said.meta.cwd)].some((one) => folders.has(one))
    /* A project's own record names it, whatever folder it ran in (a project whose folder was renamed). */
    if (!wanted.has(id) && (!here || !said.meta.person)) continue
    const label = labelOf(said.meta)
    found.push({ id, label, firstPrompt: line(said.meta.preview, LABEL_CHARS) || label, lastPrompt: line(said.meta.title, TITLE_CHARS), prs: [], next: [], lastActive: said.lastActive })
  }
  return found.sort((a, b) => b.lastActive - a.lastActive)
}

/** What a recorded session ran in: what `/kehikot-here` takes as its folder. */
export async function folderOfRecord(id: string, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const file = await recordFile('', id, env)
  if (!file) return null
  return (await describe(file))?.meta?.cwd || null
}

/** Where a conversation is now, from an id it was once under. Vibe keeps one id per conversation, so it is that id. */
export function headOf(id: string, _held?: ReadonlyMap<string, Recorded>, _live?: ReadonlySet<string>): string {
  return id
}

/** A place's name: one line, no control characters, never starting with a dash, short. */
export function sessionName(words: readonly (string | null | undefined)[]): string {
  const said = words.map((one) => (one ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' · ')
  return said.replace(/^-+\s*/, '').slice(0, 120)
}

/* ------------------------------------------------------------------------ *
 * A new session's id, which Vibe chooses
 * ------------------------------------------------------------------------ */

/**
 * The id Vibe gave each new session this module started, by the id this module opened it under.
 *
 * Vibe takes no session id on its command line. Its hooks name it — every hook is handed
 * `session_id` — and `tell.sh` passes it here (`learnSession`) beside the run's own id, which only
 * this module and the session's environment know. A `/clear` is a new session id in the same
 * process, said the same way.
 */
const LEARNED = new Map<string, string>()

export function learnSession(opened: string, session: string): void {
  if (!SESSION_ID.test(opened) || !SESSION_ID.test(session)) return
  LEARNED.delete(opened)
  LEARNED.set(opened, session)
  while (LEARNED.size > 1024) LEARNED.delete(LEARNED.keys().next().value!)
}

async function settled(projectPath: string, id: string): Promise<string | null> {
  const real = LEARNED.get(id) ?? id
  return (await recordFile(projectPath, real)) ? real : null
}

/* ------------------------------------------------------------------------ *
 * How it is installed
 * ------------------------------------------------------------------------ */

/**
 * How the Vibe CLI is installed, from the vendor's own page.
 *
 *   Source: https://docs.mistral.ai/vibe/code/cli/install-setup — "curl -LsSf
 *   https://mistral.ai/vibe/install.sh | bash" (installs uv when needed, then `mistral-vibe` with
 *   `uv tool`); manual: `uv tool install mistral-vibe` (Python 3.12+, which uv fetches). Read
 *   2026-10-31.
 *
 * Neither asks for admin rights: `uv tool` installs into the home folder (`~/.local/bin`). When
 * `uv` is here its own command is run; otherwise the vendor's installer.
 *
 * It is DATA. Nothing in this file runs it: `live.ts` does, in a pty the person is looking at, and
 * only after a press in the page. Signing in is Vibe's own first screen afterwards (`vibe` runs
 * its setup on first launch).
 */
const SOURCE = 'https://docs.mistral.ai/vibe/code/cli/install-setup'
const CHECKED = '2026-10-31'

/** Whether `uv` is here: on PATH, or in one of the usual places. */
export function hasUv(env: NodeJS.ProcessEnv = process.env): boolean {
  for (const dir of (env.PATH ?? '').split(delimiter).filter(Boolean)) if (runnable(join(dir, 'uv'))) return true
  return toolDirs(env).some((dir) => runnable(join(dir, 'uv')))
}

const UV_LINE = 'uv tool install mistral-vibe'
const SCRIPT_LINE = 'curl -LsSf https://mistral.ai/vibe/install.sh | bash'

/** The install command, the first that applies, none of which asks for admin rights. */
export function installFor(env: NodeJS.ProcessEnv = process.env): Install {
  return hasUv(env)
    ? { line: UV_LINE, lands: '~/.local/bin', source: SOURCE, checked: CHECKED }
    : { line: SCRIPT_LINE, lands: '~/.local/bin', source: SOURCE, checked: CHECKED }
}

/** The install command, or the stand-in a test names (`KEHIKOT_VIBE_INSTALL_LINE`, from the environment of whoever started this server). */
function install(env: NodeJS.ProcessEnv = process.env): Install {
  const said = env.KEHIKOT_VIBE_INSTALL_LINE
  const chosen = installFor(env)
  return said ? { ...chosen, line: said } : chosen
}

function installEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...env, PATH: installPath(env) }
}

/* eslint-disable-next-line no-control-regex */
const ESCAPES = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g

/** Terminal output as plain text. */
export function plain(output: string): string {
  return output.replace(ESCAPES, '').replace(/\r/g, '')
}

/** Whether the installer failed for lack of permission to write where it was asked to. */
export function deniedWrite(output: string): boolean {
  return /\bEACCES\b|permission denied/i.test(plain(output))
}

/**
 * What the person is told when the installer ended and no binary was found: plain words and the
 * next step, never a stack. The whole output stays in the terminal ("See the log").
 */
function explain(output: string, exitCode: number, ran: string): string {
  const text = plain(output)
  if (exitCode === 0) return `The installer finished, but Vibe was not found afterwards. Make sure ~/.local/bin is on your PATH, or see ${SOURCE}`
  if (deniedWrite(text)) return `The installer can't write where it was asked to. Check that the .local folder in your home is yours, or install Vibe another way: ${SOURCE}`
  if (exitCode === 127 || /(uv|curl|bash): (command )?not found/i.test(text)) {
    return ran.startsWith('uv') ? `uv was not found. Install Vibe with its installer instead: ${SCRIPT_LINE}` : `The installer could not be fetched or run. See the log, or install Vibe by hand: ${SOURCE}`
  }
  if (/requires-python|No interpreter found|Python 3\.1[2-9]/i.test(text)) return `Vibe needs Python 3.12 or newer, which uv could not set up. See the log, or ${SOURCE}`
  return `The installer exited with ${exitCode}. See the log, or run ${ran} in a terminal.`
}

/**
 * The variables a Vibe process, or a module host, may have set that a session opened here must
 * not inherit: `VIBE_CWD` moves its working folder (it is `--workdir`), and the app-server ones
 * point its back end somewhere else.
 */
const NESTED = ['VIBE_CWD', 'VIBE_APP_SERVER_CMD', 'VIBE_APP_SERVER_BIN', 'VIBE_APP_SERVER_CWD']

/**
 * A session's environment: the person's (`personEnv`, without the host's own `bun` this module was
 * started with first on its PATH and `BUN_BE_BUN`), without the variables above.
 */
function environment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = personEnv(env)
  for (const name of NESTED) delete out[name]
  return out
}

/* ------------------------------------------------------------------------ *
 * Its hooks, and its status reports
 * ------------------------------------------------------------------------ */

/**
 * The hooks `tell.sh` is run at, and the word it says. Vibe 3.0.4 hands every hook `session_id`,
 * `parent_session_id`, `transcript_path`, `cwd` and `hook_event_name` on standard input, and
 * `post_agent` also `agent_name` (docs: "Hooks", "Hook contract"; harness `_foreign_hooks.py`):
 *
 *     a tool has run                        post_tool    → `Tool`: names the conversation early
 *     an agent's turn ended (no tool left)  post_agent   → `Stop`, or `SubagentStop` when the
 *                                                          payload has a parent session (tell.sh)
 *
 * What a session is DOING is not heard here: Vibe says it on its terminal (status.ts). Vibe has
 * no hook at a prompt, at a session's start, or when an approval is put up.
 */
export const TELLS: readonly { event: HookEvent; matcher?: string; says: string }[] = [
  { event: 'post_tool', matcher: '*', says: 'Tool' },
  { event: 'post_agent', says: 'Stop' },
]

/** A TOML basic string: JSON's spelling is TOML's for everything this module writes. */
const tomlString = (text: string): string => JSON.stringify(text)

/** The prefix of every hook name this module writes: Vibe drops a second hook by the same name. */
export const HOOK_PREFIX = 'kehikot-vibe'

/**
 * The `.vibe/hooks.toml` of a session's kit: one `[[hooks]]` table per command, each named
 * `kehikot-vibe-<event>-<n>`. Vibe loads a `--add-dir` folder's hooks file as a project one (no
 * trust asked: an added directory is trusted for its session), beside the project's and the
 * person's own, and runs every one; on a name it already loaded it keeps the first, so the names
 * are this module's own.
 */
function hooksFile(groups: readonly HookGroup[]): string {
  const out: string[] = ['# Written by Kehikot for one Vibe session; removed when it ends.', '']
  let n = 0
  for (const group of groups) {
    for (const one of group.commands) {
      n += 1
      out.push('[[hooks]]')
      out.push(`name = ${tomlString(`${HOOK_PREFIX}-${group.event.replace('_', '-')}-${n}`)}`)
      out.push(`type = ${tomlString(group.event)}`)
      if (group.matcher !== undefined) out.push(`match = ${tomlString(group.matcher)}`)
      else if (group.event !== 'post_agent') out.push('match = "*"')
      out.push(`command = ${tomlString(one.command)}`)
      out.push(`timeout = ${Math.max(1, Math.min(60, one.timeout)).toFixed(1)}`)
      out.push('')
    }
  }
  return out.join('\n')
}

/** What each status word means (status.ts). `idle` is not here: it means different things after a turn and before one (live.ts). */
const SIGNALS: Record<string, State> = {
  working: 'working',
  blocked: 'needs-you',
  done: 'finished',
  error: 'finished',
}

/* ------------------------------------------------------------------------ *
 * Which process holds which conversation
 * ------------------------------------------------------------------------ */

const LEASE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.lock\.json$/

/** Whether a process by this id is running (and is this user's to ask about). */
export function alive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 1) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as { code?: string }).code === 'EPERM'
  }
}

/**
 * Every conversation a Vibe process holds now, in any folder: one per lease whose lock file is
 * there and whose process (`process_id` in `<id>.lock.json`) is alive. Reads; starts nothing. A
 * lease left behind by a process that ended is not a conversation running. A folder that cannot be
 * read is `failed`, never an empty list.
 */
async function active(_file: string, env: NodeJS.ProcessEnv = process.env): Promise<Running> {
  const dir = join(sessionsRoot(env), 'active')
  let names: string[]
  try {
    names = await readdir(dir)
  } catch (error) {
    return (error as { code?: string }).code === 'ENOENT' ? { known: true, active: [] } : { known: false, why: 'failed' }
  }
  const out: Active[] = []
  for (const name of names.slice(0, 512)) {
    const session = LEASE.exec(name)?.[1]
    if (!session || !names.includes(`${session}.lock`)) continue
    let pid: number | null = null
    let startedAt: number | null = null
    try {
      const said = JSON.parse(await readFile(join(dir, name), 'utf8')) as { process_id?: unknown; acquired_at?: unknown }
      pid = typeof said.process_id === 'number' ? said.process_id : null
      const at = typeof said.acquired_at === 'string' ? Date.parse(said.acquired_at) : NaN
      startedAt = Number.isFinite(at) ? at : null
    } catch {
      /* Torn while it is written: the next asking reads it. */
      continue
    }
    if (pid === null || !alive(pid)) continue
    out.push({ session, kind: 'interactive', called: 'a Vibe process', handle: null, pid, cwd: (await folderOfRecord(session, env)) ?? '', startedAt, name: '', state: null, status: null })
  }
  return { known: true, active: out }
}

/* ------------------------------------------------------------------------ *
 * The arguments
 * ------------------------------------------------------------------------ */

/**
 * A new session: no arguments of its own — Vibe chooses the id. Everything per run (`--add-dir`,
 * `--agent`) is added by whoever starts it.
 *
 * A session is a child of this module's process and ends with it: Vibe runs its back end (the
 * app-server) as a child of the terminal program, with nothing that outlives it. The next open of
 * its place resumes it by id.
 */
const fresh = (): string[] => []

/** A recorded session, with a sentence of this module's own as its first prompt when there is one. */
const resume = (id: string, _name?: string, said?: string): string[] => {
  if (!SESSION_ID.test(id)) throw new Error('that is not a session id')
  return ['--resume', id, ...(said && !said.startsWith('-') ? [said] : [])]
}

export const PROGRAM: Program = {
  name: 'Vibe',
  binary: BINARY,
  find,
  supports,
  newId: () => randomUUID(),
  isId: (id) => SESSION_ID.test(id),
  fresh,
  resume,
  settled,
  sessions,
  install,
  installEnvironment,
  explain,
  environment,
  hooksFile,
  signal: (event) => (Object.hasOwn(SIGNALS, event) ? SIGNALS[event]! : null),
  active,
}
