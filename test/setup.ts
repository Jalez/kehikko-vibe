import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { GlobalRegistrator } from '@happy-dom/global-registrator'

/**
 * A document, for the tests that render one — and a machine of their own.
 *
 * Everything this module reads outside a project is pointed at a scratch
 * folder HERE, before any test file is imported, so that no test can read
 * somebody's real Vibe sessions, find their real binary, or write a
 * registration into their real host: the home folder, Vibe's config
 * folder, the module registry and PATH are all the test's own. A test that
 * wants a `vibe` puts the stand-in (`test/stand-in/vibe`) on its PATH.
 */
export const SCRATCH = mkdtempSync(join(tmpdir(), 'kehikko-vibe-test-'))
export const HOME = join(SCRATCH, 'home')
export const CONFIG = join(SCRATCH, 'vibe-home')
mkdirSync(HOME, { recursive: true })
mkdirSync(CONFIG, { recursive: true })
process.env.HOME = HOME
process.env.VIBE_HOME = CONFIG
/* The Bun these tests run on, for the stand-in `vibe` (test/stand-in/vibe runs vibe.ts with it). */
process.env.KEHIKOT_TEST_BUN = process.execPath
process.env.KEHIKOT_MODULES_DIR = join(SCRATCH, 'modules')
process.env.PATH = '/usr/bin:/bin'
/* No host: a test that wants one stands one in. Port 9 refuses at once. */
process.env.KEHIKOT_ORIGINS = 'http://127.0.0.1:9'
/* Neither this machine's Homebrew nor its npm is looked for, or run. */
process.env.KEHIKOT_VIBE_TOOL_DIRS = ''
delete process.env.KEHIKOT_VIBE_INSTALL_LINE
delete process.env.KEHIKOT_VIBE_QUIET_MS

GlobalRegistrator.register()
