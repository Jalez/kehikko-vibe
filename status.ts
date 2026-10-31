/**
 * What a Vibe session says it is doing, read off its own terminal.
 *
 * ## Vibe's program status reports (OSC 7501)
 *
 * Vibe 3.0.4's terminal program (the Rust TUI, `program_status.rs` and `terminal_notifier.rs` in
 * mistral-vibe at 338ad4b) asks the terminal it runs in, once at start, whether it takes program
 * status reports:
 *
 *     ESC ] 7501 ; ? ESC \            the query
 *     ESC ] 7501 ; ? ESC \            a terminal's reply, within half a second ("revision 0.3")
 *
 * A terminal that replies is sent a report each time the program's state changes (with
 * `experimental_enable_tab_status`, on by default):
 *
 *     ESC ] 7501 ; state=<s> : app=vibe [: msg=<base64>] ESC \
 *
 * where `<s>` is `idle`, `working`, `done`, `error`, `blocked:kind=permission` (an approval is on
 * screen) or `blocked:kind=question` (Vibe's question tool waits for an answer). `msg` is the
 * session's title, or the approval's or question's text; it is not read here.
 *
 * The pty this module holds is that terminal: it answers the query (`QUERY`, `REPLY`) and reads the
 * reports. Nothing else of the screen is read to guess at a state. The page's own terminal
 * ignores both sequences, as xterm.js does any OSC it does not know.
 */

/** The query Vibe writes, and the reply that turns its reports on. */
export const QUERY = '\u001b]7501;?\u001b\\'
export const REPLY = '\u001b]7501;?\u001b\\'

/** One report: the state's word, and the kind of block for `blocked`. */
export interface Report {
  state: 'idle' | 'working' | 'done' | 'error' | 'blocked'
  kind: 'permission' | 'question' | null
}

const STATES = new Set(['idle', 'working', 'done', 'error', 'blocked'])
/** The most of a sequence kept across chunks: a report's message is capped at 2048 bytes before base64. */
const MOST = 4096
const START = '\u001b]7501;'

/** One report's payload (`state=…:app=vibe:…`), or null when it is not one this module reads. */
export function readReport(payload: string): Report | null {
  const fields = payload.split(':')
  const head = fields[0] ?? ''
  if (!head.startsWith('state=')) return null
  const state = head.slice('state='.length)
  if (!STATES.has(state)) return null
  if (!fields.includes('app=vibe')) return null
  let kind: Report['kind'] = null
  if (state === 'blocked') {
    const said = fields.find((one) => one.startsWith('kind='))?.slice('kind='.length)
    kind = said === 'permission' || said === 'question' ? said : null
  }
  return { state: state as Report['state'], kind }
}

/**
 * Reads a pty's output as it comes, in chunks of any size: whether the query was asked, and the
 * reports, in order. A sequence split across chunks is kept until it ends (at most `MOST`).
 */
export class StatusReader {
  private carry = ''

  feed(chunk: string): { asked: boolean; reports: Report[] } {
    let text = this.carry + chunk
    this.carry = ''
    let asked = false
    const reports: Report[] = []
    let from = 0
    for (;;) {
      const at = text.indexOf(START, from)
      if (at < 0) {
        /* A start cut at the end of the chunk: keep the tail that could begin one. */
        const tail = text.slice(Math.max(from, text.length - START.length + 1))
        const cut = [...Array(tail.length).keys()].map((i) => tail.slice(i)).find((one) => START.startsWith(one))
        if (cut) this.carry = cut
        break
      }
      const bodyAt = at + START.length
      const st = text.indexOf('\u001b\\', bodyAt)
      const bel = text.indexOf('\u0007', bodyAt)
      const end = st < 0 ? bel : bel < 0 ? st : Math.min(st, bel)
      if (end < 0) {
        if (text.length - at <= MOST) this.carry = text.slice(at)
        break
      }
      const body = text.slice(bodyAt, end)
      if (body === '?') asked = true
      else {
        const report = readReport(body)
        if (report) reports.push(report)
      }
      from = end + (end === st ? 2 : 1)
    }
    text = ''
    return { asked, reports }
  }
}
