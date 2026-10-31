import { describe, firstPrompt, recordFile } from './program.ts'

/**
 * "Research complete": the Inbox event this module declares (protocol 2.31.0, `events` in the
 * manifest), and the one rule for when a subagent's finish is one.
 *
 * ## How a finished piece of research is told
 *
 *  - **The session's own agent** calls `tell_finished({ event: 'research-complete', label })` on
 *    this module's MCP door (`doors.ts`). The door knows the conversation by the place token on its
 *    URL, so only that conversation's agent can tag its item. The tag waits for the turn to end
 *    (Vibe's `post_agent` hook for the main agent), and the finished item then names the event and
 *    carries the label.
 *  - **A subagent** that finishes (Vibe runs `post_agent` after a subagent's turn too, with its own
 *    `session_id`, its `parent_session_id` and its `agent_name`; tell.sh says `SubagentStop`) is one
 *    when it is research (`isResearch`). It is then an item of its own. Any other subagent finishing
 *    says nothing.
 *
 * ## What Vibe says of a subagent
 *
 * Its agent's name: `explore` for Vibe's own read-only subagent ("explore a large codebase"), or one
 * the person configured. So a subagent is research when it is `explore`, or when the first line of
 * what it was asked reads as research; that line is its label. It is read from the subagent's own
 * session record the way a conversation's label is (`firstPrompt`), and nothing else of it is.
 */

export { EVENTS, EVENT_IDS, RESEARCH_EVENT } from './events.ts'

const RESEARCH_WORDS =
  /\b(research\w*|investigat\w*|find(?:ing)? out|look(?:ing)? into|compar\w*|audit\w*|survey\w*|explor\w*|analy[sz]\w*|stud(?:y|ies|ying)|review\w*|evaluat\w*|assess\w*|read(?:ing)? up)\b/i
/** Vibe's own read-only subagent: it explores the code to answer questions about it. */
const RESEARCH_ROLES = new Set(['explore'])

/** Whether a finished subagent was research: `explore`, or a task whose first line has a research word. */
export function isResearch(agent: { agentType?: string | null; task?: string | null }): boolean {
  if (agent.agentType && RESEARCH_ROLES.has(agent.agentType)) return true
  return RESEARCH_WORDS.test((agent.task ?? '').trim())
}

/** A subagent's session id as Vibe gives one; nothing else is used to find a record. */
export const AGENT_ID = /^[0-9a-f-]{36}$/
/** An agent type (a role) as a hook gives one. */
export const AGENT_TYPE = /^[A-Za-z0-9:._-]{1,64}$/

/** The first line of the task a subagent was given, from its own session record; null when there is none. */
export async function subagentTask(agent: string, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  if (!AGENT_ID.test(agent)) return null
  const file = await recordFile('', agent, env)
  if (!file) return null
  return firstPrompt((await describe(file))?.meta ?? null) || null
}

/** What the session's agent said it finished, waiting for the turn or a subagent to end. */
export interface Told {
  event: string
  label: string
  at: number
}

/** A subagent's finished research, as an item of its own until the person opens the session. */
export interface Found {
  agent: string
  event: string
  label: string
  at: number
}

/** How many subagent items one session keeps at most; the oldest go first. */
export const FOUND_MOST = 8
