import { describe, expect, test } from 'bun:test'

import { MCP_ENV, doorEnv, serverName } from '../doorConfig.ts'

/** A session's doors, as Vibe takes MCP servers for one process: `VIBE_MCP_SERVERS`, merged with the person's by name. */

const door = (name: string, url: string, transport: 'http' | 'sse' = 'http') => ({ module: `kehikot.${name}`, name, url, transport })

describe('the doors, in the environment', () => {
  test('one server per door, streamable HTTP, under a name Vibe keeps as it is', () => {
    const env = doorEnv([door('kehikko', 'http://127.0.0.1:4180/mcp?kehikot-place=t'), door('notes', 'http://127.0.0.1:4600/mcp?kehikot-place=t', 'sse'), door('kehikko', 'http://127.0.0.1:1/x')])
    expect(Object.keys(env)).toEqual([MCP_ENV])
    expect(JSON.parse(env[MCP_ENV]!)).toEqual([
      { name: 'kehikko', transport: 'streamable-http', url: 'http://127.0.0.1:4180/mcp?kehikot-place=t' },
      { name: 'notes', transport: 'http', url: 'http://127.0.0.1:4600/mcp?kehikot-place=t' },
    ])
  })

  test('no doors, no variable: the person’s own config alone', () => {
    expect(doorEnv([])).toEqual({})
  })

  test('the person’s own VIBE_MCP_SERVERS is kept, under ours by name; one that does not parse is left out', () => {
    const theirs = JSON.stringify([{ name: 'linear', transport: 'streamable-http', url: 'https://mcp.linear.app/mcp' }, { name: 'notes', transport: 'stdio', command: 'x' }])
    const env = doorEnv([door('notes', 'http://127.0.0.1:4600/mcp')], { [MCP_ENV]: theirs })
    expect(JSON.parse(env[MCP_ENV]!).map((one: { name: string; transport: string }) => `${one.name} ${one.transport}`)).toEqual(['linear streamable-http', 'notes streamable-http'])
    expect(JSON.parse(doorEnv([door('notes', 'http://127.0.0.1:4600/mcp')], { [MCP_ENV]: 'not json' })[MCP_ENV]!)).toHaveLength(1)
  })

  test('a name as Vibe normalises one', () => {
    expect(serverName('kehikko-vibe')).toBe('kehikko-vibe')
    expect(serverName('a.b c')).toBe('a_b_c')
    expect(serverName('...')).toBe('kehikot')
  })
})
