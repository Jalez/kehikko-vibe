import { describe, expect, test } from 'bun:test'
import { placedGuardsSchema } from 'kehikot-module-protocol'

import { guardAnswer, type EditFiles } from '../context.ts'

/**
 * Edit guards through the protocol's one check (`checkToolCall`, protocol 2.80.0): Vibe's file tools
 * (`file_system.write_file`, `file_system.edit`, `file_system.search_replace`, the file in
 * `tool_input.file_path`) are refused in a main checkout or under paths a module on the kehikko names.
 */

const guards = placedGuardsSchema.parse([
  {
    module: 'kehikot.worktrees',
    name: 'Worktrees',
    guard: { id: 'main-checkout', tool: 'edit', match: { checkouts: ['main'], paths: ['~/Library/Application Support/Kehikot/installed/**'] }, action: 'deny', why: 'Work in a worktree: git worktree add ../<repo>-worktrees/<branch> -b <branch> origin/main' },
  },
])

const files: EditFiles = { home: '/Users/p', checkoutOf: (path) => (path.startsWith('/Users/p/Projects/app/') ? 'main' : path.startsWith('/Users/p/Projects/app-worktrees/') ? 'linked' : null) }
const TOOLS = ['file_system.write_file', 'file_system.edit', 'file_system.search_replace']
const call = (tool_name: string, file_path: string, cwd?: string) => ({ tool_name, tool_input: { file_path, content: 'x' }, ...(cwd ? { cwd } : {}) })

describe('edit guards', () => {
  test('an edit in a main checkout is refused with the module’s words', () => {
    for (const tool of TOOLS) {
      const answer = guardAnswer(call(tool, '/Users/p/Projects/app/src/a.ts'), guards, false, null, files)
      expect(answer).toMatchObject({ decision: 'deny' })
      expect(JSON.stringify(answer)).toContain('git worktree add')
    }
  })

  test('a relative path is read against the session’s folder', () => {
    expect(guardAnswer(call('file_system.edit', 'src/a.ts', '/Users/p/Projects/app'), guards, false, null, files)).toMatchObject({ decision: 'deny' })
    expect(guardAnswer(call('file_system.edit', 'src/a.ts', '/Users/p/Projects/app-worktrees/x'), guards, false, null, files)).toBeNull()
  })

  test('an installed module’s folder is refused, a worktree and elsewhere pass', () => {
    for (const tool of TOOLS) {
      expect(guardAnswer(call(tool, '/Users/p/Library/Application Support/Kehikot/installed/kehikot.queue/x.ts'), guards, false, null, files)).toMatchObject({ decision: 'deny' })
      expect(guardAnswer(call(tool, '/Users/p/Projects/app-worktrees/x/src/a.ts'), guards, false, null, files)).toBeNull()
      expect(guardAnswer(call(tool, '/tmp/note.md'), guards, false, null, files)).toBeNull()
    }
  })

  test('KEHIKOT_DIRECT in the session passes, and no edit guard means nothing is asked', () => {
    expect(guardAnswer(call('file_system.write_file', '/Users/p/Projects/app/a.ts'), guards, true, null, files)).toBeNull()
    expect(guardAnswer(call('file_system.write_file', '/Users/p/Projects/app/a.ts'), [], false, null, { home: null, checkoutOf: () => { throw new Error('not asked') } })).toBeNull()
  })

  test('reading a file is not an edit, and an edit guard never touches a shell command', () => {
    expect(guardAnswer(call('file_system.read_file', '/Users/p/Projects/app/a.ts'), guards, false, null, files)).toBeNull()
    expect(guardAnswer({ tool_name: 'file_system.bash', tool_input: { command: 'echo x > /Users/p/Projects/app/a.ts' } }, guards, false, null, files)).toBeNull()
  })
})
