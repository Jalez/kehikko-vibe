import { afterAll, describe, expect, test } from 'bun:test'
import { WELL_KNOWN, skillPath } from 'kehikot-module-protocol'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer, get, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { SessionDoor } from '../doorConfig.ts'
import { SKILLS_HEADING, forVibe, kitSkills, removeKit, sessionKit, skillDeclarations, skillText, skillsText } from '../skills.ts'

const scratch: string[] = []
const dir = () => {
  const one = mkdtempSync(join(tmpdir(), 'kehikko-vibe-skills-'))
  scratch.push(one)
  return one
}
const servers: Server[] = []
afterAll(() => {
  for (const one of servers) one.close()
  for (const one of scratch) rmSync(one, { recursive: true, force: true })
})

const text = (name: string, body = 'Do the thing.') => `---\nname: ${name}\ndescription: ${name} skill\n---\n${body}\n`

/** A stand-in module: a manifest declaring skills, and each one's text. */
function module(skills: Record<string, { text: string; version?: string; needs?: unknown[] }>, more: Record<string, unknown> = {}) {
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://x').pathname
    if (path === WELL_KNOWN) {
      response.setHeader('content-type', 'application/json')
      return void response.end(JSON.stringify({ id: more.id ?? 'kehikot.x', ...more, declares: { ...((more.declares as object) ?? {}), skills: Object.entries(skills).map(([name, one]) => ({ name, summary: `${name}.`, version: one.version ?? '1', ...(one.needs ? { needs: one.needs } : {}) })) } }))
    }
    for (const [name, one] of Object.entries(skills)) if (path === skillPath(name)) return void response.end(one.text)
    response.statusCode = 404
    response.end('no')
  })
  server.listen(0, '127.0.0.1')
  servers.push(server)
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

/* The test document replaces `fetch` with one that applies a browser's origin rules; a module is asked from a server. */
const plain = ((url: string) =>
  new Promise((done, fail) => {
    get(url, (response) => {
      let body = ''
      response.on('data', (chunk) => (body += chunk))
      response.on('end', () => done({ status: response.statusCode, text: async () => body }))
    }).on('error', fail)
  })) as unknown as typeof fetch

const door = (module: string, origin: string): SessionDoor => ({ module, name: module.split('.').pop()!, url: `${origin}/mcp?kehikot-place=x`, transport: 'http' })
/** The skills in a session's own folder, by name. */
const given = (kit: string) => {
  const at = join(kit, '.vibe', 'skills')
  return existsSync(at) ? readdirSync(at).sort() : []
}
const options = (extra: { log?: string[]; personal?: string[]; projectPath?: string; everywhere?: NonNullable<Parameters<typeof sessionKit>[1]>['everywhere'] } = {}) => ({
  base: dir(),
  personal: extra.personal ?? [dir()],
  ...(extra.projectPath ? { projectPath: extra.projectPath } : {}),
  log: (line: string) => extra.log?.push(line),
  fetch: plain,
  ...(extra.everywhere !== undefined ? { everywhere: extra.everywhere } : {}),
})

describe('the skills a session is given, in its own folder', () => {
  test('every module on the kehikko and this module’s own, in Vibe’s format, in the folder given with --add-dir', async () => {
    const one = module({ browse: { text: text('browse') }, 'read-page': { text: text('read-page') } })
    const two = module({ journey: { text: text('journey') } })
    const kit = await sessionKit([door('kehikot.browser', one), door('kehikot.journeys', two), door('kehikot.browser', one)], options())
    expect(given(kit.dir)).toEqual(['browse', 'journey', 'kehikot-here', 'read-page'])
    expect(readFileSync(join(kit.dir, '.vibe', 'skills', 'browse', 'SKILL.md'), 'utf8')).toBe('---\nname: browse\ndescription: "browse skill"\n---\nDo the thing.\n')
    /* This module's own is the person's to run: Vibe's own front matter says so. */
    const here = readFileSync(join(kit.dir, '.vibe', 'skills', 'kehikot-here', 'SKILL.md'), 'utf8')
    expect(here).toContain('disable-model-invocation: true')
    expect(here).toContain('$KEHIKOT_TELL_SESSION')
    expect(statSync(kit.dir).mode & 0o777).toBe(0o700)
    expect(kitSkills(kit.dir).map((one) => `${one.name} ${one.state}`).sort()).toEqual(['browse callable', 'journey callable', 'kehikot-here callable', 'read-page callable'])
    /* The session ends: its folder, skills and all, goes. */
    removeKit(kit.dir)
    expect(existsSync(kit.dir)).toBe(false)
  })

  test('a module that does not answer, or gives a text the protocol refuses, is left out with one line', async () => {
    const log: string[] = []
    const bad = module({ broken: { text: 'no front matter' } })
    const kit = await sessionKit([door('kehikot.gone', 'http://127.0.0.1:9'), door('kehikot.bad', bad)], options({ log }))
    expect(given(kit.dir)).toEqual(['kehikot-here'])
    expect(log.some((line) => line.includes('kehikot.gone did not answer'))).toBe(true)
    expect(log.some((line) => line.includes('skill broken from kehikot.bad refused'))).toBe(true)
  })

  test('a kehikko-bound skill only when what it needs is on the kehikko — by id, or by what a module there provides', async () => {
    const log: string[] = []
    const factory = module({ 'review-factory': { text: text('review-factory'), needs: ['kehikot.review'] }, 'flow-roadmap': { text: text('flow-roadmap'), needs: [{ provides: 'steps' }] } }, { id: 'kehikot.factory', name: 'Factory' })
    const alone = await sessionKit([door('kehikot.factory', factory)], options({ log }))
    expect(given(alone.dir)).toEqual(['kehikot-here'])
    expect(log.some((line) => line.includes('review-factory') && line.includes('left out'))).toBe(true)
    const review = module({}, { id: 'kehikot.review', name: 'Review' })
    const journeys = module({}, { id: 'kehikot.journeys', name: 'Journeys', declares: { provides: ['steps'] } })
    const all = await sessionKit([door('kehikot.factory', factory), door('kehikot.review', review), door('kehikot.journeys', journeys)], options())
    expect(given(all.dir)).toEqual(['flow-roadmap', 'kehikot-here', 'review-factory'])
    /* In a folder no other conversation sees, a kehikko-bound skill needs no check of its place. */
    expect(readFileSync(join(all.dir, '.vibe', 'skills', 'review-factory', 'SKILL.md'), 'utf8')).toBe('---\nname: review-factory\ndescription: "review-factory skill"\n---\nDo the thing.\n')
  })

  test('a skill of the person’s own by that name — theirs, or the project’s — is not given, and the session is told why', async () => {
    const mine = dir()
    mkdirSync(join(mine, 'journey'), { recursive: true })
    writeFileSync(join(mine, 'journey', 'SKILL.md'), text('journey', 'Mine.'))
    const project = dir()
    mkdirSync(join(project, '.vibe', 'skills', 'browse'), { recursive: true })
    writeFileSync(join(project, '.vibe', 'skills', 'browse', 'SKILL.md'), text('browse', 'The project’s.'))
    const log: string[] = []
    const kit = await sessionKit([door('kehikot.journeys', module({ journey: { text: text('journey') }, browse: { text: text('browse') } }, { name: 'Journeys' }))], options({ personal: [mine], projectPath: project, log }))
    expect(given(kit.dir)).toEqual(['kehikot-here'])
    expect(kitSkills(kit.dir).filter((one) => one.state === 'taken').map((one) => one.name).sort()).toEqual(['browse', 'journey'])
    expect(log.some((line) => line.includes('skill journey not given'))).toBe(true)
    expect(readFileSync(join(mine, 'journey', 'SKILL.md'), 'utf8')).toBe(text('journey', 'Mine.'))
  })

  test('the skills the host keeps for every conversation are given too, from where the host says', async () => {
    const host = module({ 'kehikot-module': { text: text('kehikot-module') } }, { id: 'kehikko' })
    const everywhere = [{ module: 'kehikko', name: 'kehikot-module', version: '1', origin: host }, { module: 'kehikot.vibe', name: 'kehikot-here', version: skillDeclarations()[0]!.version, origin: 'http://127.0.0.1:9' }]
    const kit = await sessionKit([], options({ everywhere }))
    expect(kitSkills(kit.dir).map((one) => `${one.name} ${one.by}`).sort()).toEqual(['kehikot-here Vibe', 'kehikot-module Kehikot'])
    expect(given(kit.dir)).toEqual(['kehikot-here', 'kehikot-module'])
  })

  test('an everywhere entry from somewhere that is not this computer is not fetched', async () => {
    const log: string[] = []
    const kit = await sessionKit([], options({ log, everywhere: [{ module: 'kehikot.x', name: 'far', version: '1', origin: 'https://example.com' }] }))
    expect(given(kit.dir)).toEqual(['kehikot-here'])
    expect(log.some((line) => line.includes('not on this computer'))).toBe(true)
  })
})

describe('a skill written for Claude Code, said for Vibe', () => {
  const claude = [
    '---',
    'name: monitor',
    'description: Ask Monitor what repeats. Only a person runs it, by typing /monitor.',
    'disable-model-invocation: true',
    'allowed-tools: Bash(curl:*), mcp__monitor__traffic',
    '---',
    '',
    'The person typed `/monitor $ARGUMENTS`. Monitor answers at http://127.0.0.1:9010:',
    '',
    '!`curl -s -m 5 -G --data-urlencode "session=${CLAUDE_SESSION_ID}" http://127.0.0.1:9010/api/traffic`',
    '',
    'Then say what repeats.',
  ].join('\n')

  test('Claude Code’s front matter goes; a person-only skill stays one, in Vibe’s words; `/name` is Vibe’s slash command too', () => {
    const said = forVibe(claude, 'monitor')
    expect(said.implicit).toBe(false)
    expect(said.description).toBe('Ask Monitor what repeats. Only a person runs it, by typing /monitor.')
    expect(said.text.startsWith('---\nname: monitor\ndescription: "Ask Monitor what repeats. Only a person runs it, by typing /monitor."\ndisable-model-invocation: true\n---\n')).toBe(true)
    expect(said.text).not.toContain('allowed-tools')
    expect(said.text).toContain('The person typed `/monitor $ARGUMENTS`')
    expect(said.text).toContain('Only the person runs this skill, by typing `/monitor`')
  })

  test('a line Claude Code runs on load is a command to run first; a session id Vibe cannot give is said to be unknown', () => {
    const said = forVibe(claude, 'monitor')
    expect(said.text).not.toContain('!`curl')
    expect(said.text).toContain('```sh\ncurl -s -m 5 -G --data-urlencode "session=UNKNOWN-SESSION" http://127.0.0.1:9010/api/traffic\n```')
    expect(said.text).toContain('`$ARGUMENTS` below is whatever the person wrote after `/monitor`')
    expect(said.text).toContain('`UNKNOWN-SESSION` below stands where Claude Code would have put its session id')
    expect(said.text).not.toContain('CLAUDE_SESSION_ID')
  })

  test('a skill with none of that is the same text under Vibe’s front matter', () => {
    expect(forVibe(text('journey', 'Read the steps.'), 'journey')).toEqual({ name: 'journey', description: 'journey skill', implicit: true, text: '---\nname: journey\ndescription: "journey skill"\n---\nRead the steps.\n' })
  })

  test('the session is told its skills as /name entries it can call, and what was not given', async () => {
    const kit = await sessionKit([], options())
    const said = skillsText([...kitSkills(kit.dir), { name: 'journey', description: 'Mine.', implicit: true, module: 'kehikot.journeys', by: 'Journeys', state: 'taken' }])!
    expect(said.startsWith(SKILLS_HEADING)).toBe(true)
    expect(said).toContain("Vibe's `/` menu")
    expect(said).toContain('- `/kehikot-here` (Vibe): ')
    expect(said).toContain('Only when the person types it.')
    expect(said).toContain("a skill of the person's own already has the name (`/name` runs theirs): `/journey` (Journeys).")
    expect(skillsText([])).toBeNull()
    expect(skillText('kehikot-here')).toContain('/api/here')
  })
})
