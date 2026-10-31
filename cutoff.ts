/**
 * What a conversation's own record says about how it ended: whether its last turn was still under
 * way, and whether the person has moved on since something was said about it.
 *
 * ## What Vibe's record does not say, and so what is not read
 *
 * Vibe 3.0.4 keeps a conversation as generations (`<save_dir>/unified/<id>/`): a pointer
 * (`CURRENT`), snapshots, and a journal of steps in its own internal format, with the history held
 * apart in content-addressed chunks. None of it is read here for turns or prompts: a turn a
 * restart cut off is told by the record's own `working` mark, which this module keeps from what Vibe
 * says on its terminal (`recover` in live.ts), and what the person said is never read.
 *
 * Claude Code writes a `<task-notification>` into a transcript for each background task that a
 * session's end cut off, and the Claude module tells the person about them. Vibe's background
 * processes are the session's own and end with it; so the one kind said here is the turn itself
 * (`turn`). `cutOffs` finds none, `movedOn` and `midTurn` say no.
 */

/** Which way something did not finish: `turn` is a turn a restart cut off. The others are kept for the record's format. */
export type CutKind = 'turn' | 'ended' | 'stopped' | 'failed'

export interface CutOff {
  /** When it was found, in milliseconds. */
  at: number
  kind: CutKind
  /** One line, for the person. */
  summary: string
  tasks: number
}

export const SUMMARY_CHARS = 90

/** Background work a record says was cut off. Vibe writes none. */
export function cutOffs(_text: string): CutOff[] {
  return []
}

/** Whether the person said something after `after`. Vibe's record is not read for it: no. */
export function movedOn(_text: string, _after: number, _except: readonly string[] = []): boolean {
  return false
}

/** Whether the last turn was still under way when the record stopped. Not read from Vibe's record: no (the `working` mark says it). */
export function midTurn(_text: string): boolean {
  return false
}

/** The words for what was cut off: the label's tail, and the detail. */
export function cutOffWords(open: readonly CutOff[]): { said: string; detail: string } {
  if (open.some((one) => one.kind === 'turn')) {
    return { said: 'its turn was cut off when Kehikot restarted', detail: 'Open it to carry on: it is told what happened when you do, unless “Resume conversations cut off by a restart” is off.' }
  }
  const count = open.reduce((sum, one) => sum + one.tasks, 0)
  const tasks = `${count} background task${count === 1 ? '' : 's'}`
  return { said: `${tasks} ${count === 1 ? 'was' : 'were'} cut off or failed`, detail: open.map((one) => one.summary).join('; ') }
}
