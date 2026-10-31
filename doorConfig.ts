import { randomBytes } from 'node:crypto'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { LIMITS, everywhereSkillSchema, type EverywhereSkill, oneLine, type AbsentModule, type SessionModule } from 'kehikot-module-protocol'
import { frameOrigins } from 'kehikot-module-protocol/serve'

import { ID } from './manifest.ts'
import { PLACE_TOKEN } from './record.ts'

/**
 * A session's Kehikot doors, each carrying its place (protocol 2.4.0).
 *
 * When this module starts or resumes a conversation it asks the host for the
 * doors the session should have — the host's own and those of the modules on
 * the place's kehikko — with the conversation's token on every URL
 * (`?kehikot-place=<token>`), and hands them to Vibe for that one
 * process in `VIBE_MCP_SERVERS` (`doorEnv`). Every door the session calls then knows
 * which conversation is calling, and answers from this module's record of it
 * (`/api/kehikot/place`), whatever the person has switched the screen to.
 *
 * ## The names
 *
 * Each door goes under the name the person's agent config ALREADY uses for it
 * (the host reads that), so the session's entry replaces theirs by name — no
 * second copy of the same tools — and the person's other servers are kept. A door the person never connected is
 * added under the name the container's plug would give it.
 */

export interface SessionDoor {
  module: string
  name: string
  url: string
  transport: 'http' | 'sse'
}

/** A token for a conversation: 32 random bytes, URL-safe. */
export const freshToken = (): string => randomBytes(32).toString('base64url')

/** The host's origins on this machine, in the order a host is asked. */
export function hostOrigins(env: Record<string, string | undefined> = process.env): string[] {
  const out: string[] = []
  for (const origin of frameOrigins(env)) {
    try {
      const url = new URL(origin)
      if ((url.protocol === 'http:' || url.protocol === 'https:') && ['127.0.0.1', 'localhost'].includes(url.hostname)) out.push(url.origin)
    } catch {
      /* Not a URL. */
    }
  }
  return [...new Set(out)]
}

/** What the host is asked: this module issued `token` for a conversation in a project, on a kehikko. */
export interface DoorsAsked {
  projectPath: string
  projectId: string | null
  token: string
  /** The kehikko's key, or null. */
  kehikko: string | null
}

/**
 * One container on a session's kehikko, as the host lists it beside the doors (`modules` in the
 * answer to `POST /host/place`, the protocol's `SessionModule`): its module, name, one line, what it
 * says to agents (`says`, protocol 2.36.0), the name of its door in the session's config (null for
 * none) and the skills it offers there. The words are the module's: text to read.
 */
export type ModuleOn = SessionModule

/**
 * What the host answers for a session's place: its doors, the modules on its kehikko, and the
 * installed ones absent from it that say something there (protocol 2.36.0) — each null from a host
 * too old to say.
 */
export interface HostPlace {
  doors: SessionDoor[]
  modules: ModuleOn[] | null
  absent: AbsentModule[] | null
  /**
   * The skills the host keeps for every conversation (protocol 2.23.0), for this module to keep
   * where Vibe reads skills. Null from a host too old to say, or a list that did not parse: then
   * nothing kept for every conversation is changed.
   */
  everywhere: EverywhereSkill[] | null
}

/**
 * Ask the host for a session's doors and the modules on its kehikko (`POST /host/place`). Null
 * when no host answers or it refuses. Asked again with the same token, it is the kehikko as it is
 * now: what `context.ts` tells a running session changed.
 */
export async function hostPlace(asked: DoorsAsked, options: { env?: Record<string, string | undefined>; fetch?: typeof fetch; timeoutMs?: number } = {}): Promise<HostPlace | null> {
  if (!PLACE_TOKEN.test(asked.token)) return null
  for (const origin of hostOrigins(options.env)) {
    const control = new AbortController()
    const timer = setTimeout(() => control.abort(), options.timeoutMs ?? 1500)
    try {
      const response = await (options.fetch ?? fetch)(`${origin}/host/place`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ module: ID, token: asked.token, project: asked.projectPath, projectId: asked.projectId, kehikko: asked.kehikko }),
        signal: control.signal,
      })
      if (!response.ok) continue
      const said = (await response.json()) as { ok?: unknown; token?: unknown; doors?: unknown; modules?: unknown; absent?: unknown; everywhere?: unknown }
      if (said.ok !== true || said.token !== asked.token || !Array.isArray(said.doors)) continue
      const everywhere = everywhereSkillSchema.array().max(LIMITS.EVERYWHERE_SKILLS).safeParse(said.everywhere)
      return {
        doors: said.doors.filter(isDoor).slice(0, 64),
        modules: Array.isArray(said.modules) ? said.modules.flatMap(moduleOn).slice(0, 64) : null,
        absent: Array.isArray(said.absent) ? said.absent.flatMap(absentOne).slice(0, 32) : null,
        everywhere: everywhere.success ? everywhere.data : null,
      }
    } catch {
      /* Not this origin. */
    } finally {
      clearTimeout(timer)
    }
  }
  return null
}

/** Ask the host for a session's doors (`POST /host/place`). Null when no host answers or it refuses: the session then starts exactly as it did before. */
export async function hostDoors(asked: DoorsAsked, options: { env?: Record<string, string | undefined>; fetch?: typeof fetch; timeoutMs?: number } = {}): Promise<SessionDoor[] | null> {
  return (await hostPlace(asked, options))?.doors ?? null
}

const MODULE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/

/** One listed container, or nothing for anything that is not one. Every string is cut to one short line of text. */
function moduleOn(raw: unknown): ModuleOn[] {
  if (typeof raw !== 'object' || raw === null) return []
  const one = raw as Record<string, unknown>
  if (typeof one.module !== 'string' || !MODULE.test(one.module)) return []
  const door = typeof one.door === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(one.door) ? one.door : null
  const skills = Array.isArray(one.skills) ? one.skills.filter((name): name is string => typeof name === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(name)).slice(0, 16) : []
  const says = oneLine(one.says)
  return [{ module: one.module, name: oneLine(one.name, 80) || one.module, summary: oneLine(one.summary), ...(says ? { says } : {}), door, skills }]
}

/** One installed module absent from the kehikko, with what it says there; nothing for anything else. */
function absentOne(raw: unknown): AbsentModule[] {
  if (typeof raw !== 'object' || raw === null) return []
  const one = raw as Record<string, unknown>
  const says = oneLine(one.says)
  if (typeof one.module !== 'string' || !MODULE.test(one.module) || !says) return []
  return [{ module: one.module, name: oneLine(one.name, 80) || one.module, says }]
}

function isDoor(raw: unknown): raw is SessionDoor {
  if (typeof raw !== 'object' || raw === null) return false
  const door = raw as Record<string, unknown>
  if (typeof door.module !== 'string' || typeof door.name !== 'string' || typeof door.url !== 'string') return false
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(door.name)) return false
  try {
    const url = new URL(door.url)
    return (url.protocol === 'http:' || url.protocol === 'https:') && ['127.0.0.1', 'localhost'].includes(url.hostname)
  } catch {
    return false
  }
}

/** A door's name as Vibe takes one for an MCP server: letters, digits, `_` and `-` (`normalize_mcp_server_name`). */
export function serverName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, '_').replace(/^[_-]+|[_-]+$/g, '').slice(0, 64) || 'kehikot'
}

/** The variable Vibe reads its MCP servers from, over the person's `config.toml` (its `VIBE_<KEY>` layer). */
export const MCP_ENV = 'VIBE_MCP_SERVERS'

/**
 * The environment that gives one Vibe process these doors: `VIBE_MCP_SERVERS`, a JSON list of
 * `{ name, transport, url }`. Vibe reads `VIBE_<KEY>` variables as a configuration layer above the
 * person's `config.toml` and merges `mcp_servers` with theirs by name (`WithUnionMerge(merge_key=
 * "name")` in Vibe 3.0.4's schema): a door under a name the person also uses replaces that one for
 * this process; their other servers are kept. Nothing is written.
 *
 * A Kehikot door is streamable HTTP (`streamable-http` in Vibe's words); an `sse` one is Vibe's
 * plain `http`. When the person's own environment already says `VIBE_MCP_SERVERS`, theirs are kept
 * too, under ours by name.
 *
 * ## The token is in the environment
 *
 * The door's address carries the place token. It travels in this process's environment, which is
 * not listed like its arguments are. The token is a pointer, not a credential (protocol 2.4.0,
 * `PLACE_PARAM`): it names one conversation's record and grants nothing a call could not do by
 * naming the place.
 */
export function doorEnv(doors: readonly SessionDoor[], env: NodeJS.ProcessEnv = {}): Record<string, string> {
  const seen = new Set<string>()
  const servers: Record<string, unknown>[] = []
  for (const door of doors) {
    const name = serverName(door.name)
    if (seen.has(name)) continue
    seen.add(name)
    servers.push({ name, transport: door.transport === 'sse' ? 'http' : 'streamable-http', url: door.url })
  }
  if (!servers.length) return {}
  let theirs: unknown = null
  try {
    theirs = env[MCP_ENV] ? JSON.parse(env[MCP_ENV]!) : null
  } catch {
    theirs = null
  }
  const kept = Array.isArray(theirs) ? theirs.filter((one): one is Record<string, unknown> => !!one && typeof one === 'object' && typeof (one as { name?: unknown }).name === 'string' && !seen.has((one as { name: string }).name)) : []
  return { [MCP_ENV]: JSON.stringify([...kept, ...servers]) }
}

/** Where a session's folders are kept: this user's temporary folder, readable by this user alone. */
export function configDirOf(base = tmpdir()): string {
  return join(base, `kehikot-vibe-${process.getuid?.() ?? 'user'}`)
}

export function removeConfig(file: string | null): void {
  if (!file) return
  try {
    rmSync(file, { force: true })
  } catch {
    /* Gone already. */
  }
}
