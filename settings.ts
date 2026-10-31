import { KEHIKOT_DIR, settingValueIssue, settingsDeclarationSchema, type SettingField } from 'kehikot-module-protocol'

/**
 * Vibe's settings as a host shows them (protocol 2.15.0, `declares.settings`), kept in the
 * project's `.kehikot/vibe/settings.json` — the same file the page's toggle writes, in the same
 * format. Pure; the door is in `doors.ts`; what a setting becomes is `sessionFlags` and
 * `sessionEnv`.
 *
 * Each is the person's (`personOnly`): an agent is refused. Resuming a conversation a restart cut
 * off sends a sentence on the person's account; the model changes what a session costs; how often
 * Vibe asks before it acts is theirs to say.
 *
 * What is NOT a choice here, on purpose: Vibe's `auto-approve` agent and `--auto-approve`/`--yolo`,
 * which run every tool unasked. A session opened here asks at least as often as Vibe's own
 * `smart-approve` does.
 */
export const SETTINGS_FILE = `${KEHIKOT_DIR}/vibe/settings.json`

/** The agents (approval modes) Vibe 3.0.4 ships that this module may start a session with. Never `auto-approve`. */
export const AGENTS = ['ask', 'accept-edits', 'smart-approve'] as const

export const SETTINGS: SettingField[] = settingsDeclarationSchema.parse([
  {
    key: 'resumeCutOff',
    label: 'Resume conversations cut off by a restart',
    description: 'A conversation a restart stopped mid-turn is told what happened when you open it again, and carries on. Off: it waits for you.',
    type: 'boolean',
    default: true,
    personOnly: true,
  },
  {
    key: 'model',
    label: 'Model for sessions started here',
    description: 'The model alias a session started or resumed here uses, as your Vibe config names it (for example mistral-medium-3.5). Empty: your Vibe config’s active model.',
    type: 'string',
    default: '',
    personOnly: true,
  },
  {
    key: 'agent',
    label: 'When Vibe asks before acting',
    description: 'Ask: before every tool. Accept edits: file edits run, other actions ask. Smart approve: Vibe judges each call and asks before risky ones. Vibe config: your default agent. Never runs everything unasked.',
    type: 'choice',
    choices: [
      { value: 'default', label: 'Vibe config' },
      { value: 'ask', label: 'Ask' },
      { value: 'accept-edits', label: 'Accept edits' },
      { value: 'smart-approve', label: 'Smart approve' },
    ],
    default: 'default',
    personOnly: true,
  },
])

/** A project's settings for this module. */
export interface Settings {
  resumeCutOff: boolean
  model: string
  agent: string
}

export const DEFAULTS: Settings = { resumeCutOff: true, model: '', agent: 'default' }

/** A model alias as Vibe takes one: no spaces, no quotes. */
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/

/** Why `value` cannot be setting `key`, or null. Beyond the protocol's type check: a model is one word. */
export function settingIssue(key: string, value: unknown): string | null {
  const field = SETTINGS.find((one) => one.key === key)
  if (!field) return `Vibe has no setting called "${key.slice(0, 64)}".`
  const wrong = settingValueIssue(field, value)
  if (wrong) return `${field.label}: ${wrong}.`
  if (key === 'model' && value !== '' && !MODEL.test(String(value))) return 'A model is one word, as your Vibe config names it (for example mistral-medium-3.5).'
  return null
}

/** Settings off a file, each value the default where the file says nothing it could be. */
export function settingsOf(raw: unknown): Settings {
  const said = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const out = { ...DEFAULTS }
  for (const key of Object.keys(DEFAULTS) as (keyof Settings)[]) {
    if (Object.hasOwn(said, key) && settingIssue(key, said[key]) === null) (out as Record<string, unknown>)[key] = said[key]
  }
  return out
}

/**
 * The arguments a project's settings give a session started or resumed here: `--agent`, one of
 * `AGENTS`. Nothing for a setting left at its default — the person's own Vibe config decides, as
 * in any terminal. (Vibe keeps the agent a resumed conversation last ran on, whatever is passed.)
 */
export function sessionFlags(settings: Settings): string[] {
  return (AGENTS as readonly string[]).includes(settings.agent) ? ['--agent', settings.agent] : []
}

/**
 * The environment a project's settings give a session: `VIBE_ACTIVE_MODEL`, Vibe's own override
 * of `active_model` for one process (`--model` is for its headless mode only).
 */
export function sessionEnv(settings: Settings): Record<string, string> {
  return settings.model && MODEL.test(settings.model) ? { VIBE_ACTIVE_MODEL: settings.model } : {}
}
