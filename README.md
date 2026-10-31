# Vibe

A terminal holding the Mistral Vibe CLI session that belongs to the place you are looking at.

Port **8140**. `kehikot.vibe`. The sibling of the Codex and Claude modules: the same record, page,
doors and promises, with `program.ts` answering for Mistral's Vibe CLI. Everything here was read in
Vibe **3.0.4**'s source (github.com/mistralai/mistral-vibe at `338ad4b`) and its docs
(docs.mistral.ai/vibe/code/cli, every page, read 2026-10-31), and tested against a stand-in CLI.
**No copy of Vibe was run against Mistral's API**, and Vibe was not installed on the machine this was
built on: the "measured" column below is the source, not a live run.

```bash
bun install
./run.sh             # or: PORT=8140 ./run.sh
```

Then put it on a kehikko. Opened on its own (<http://127.0.0.1:8140/app>) it says nothing is
framing it: a session belongs to a project, and only a host says which.

---

## What it does

- **A session per place.** A place is project + epic + the picked parts + kehikko. Opening the
  module there shows Vibe's own UI in a terminal: the place's conversation, resumed by id
  (`vibe --resume <id>`), or a new one. The View menu lists this kehikko's conversations; Vibe's own
  `/resume` and `/clear` work in it, and the record follows (the session's hooks name the
  conversation it is on).
- **Disconnect and connect again**, as in the Codex module: "Connected to this kehikko" in the View
  menu, "Disconnect from this kehikko" in the Run menu, "Connect a conversation to this kehikko" in
  the Go menu. Not confirmed (it can be undone), and no agent may press any of them.
- **Filed with no command.** A conversation started here is filed under its place as soon as Vibe
  has a record of it and its hooks name it (its first tool call, or the end of its first turn), and
  is that kehikko's own when the kehikko had none. `/kehikot-here`, typed in a conversation started
  here, moves it to the kehikko on screen.
- **It knows where it is.** A new conversation is told its place, one line per module on the
  kehikko (name, door, its `agentSays`, its skills), the installed modules absent from it that say
  something there, and the skills it was given — the protocol's `sessionNotes`, word for word what a
  Claude or Codex conversation on the same kehikko is told. Delivered in the `AGENTS.md` of the
  session's own folder, which Vibe puts into a new session's instructions. After that, what changed
  (a module put on or taken off, the conversation moved) is told after its next tool call, through
  Vibe's `post_tool` hook (`additional_context`). *What this conversation was told* in the View menu
  shows it as plain text.
- **The kehikko's MCP doors** — the host's and each module's, each carrying the conversation's place
  token — are given to that one process in `VIBE_MCP_SERVERS`, which Vibe merges with the person's own
  servers by name.
- **Skills, as Vibe slash commands.** `/kehikot-here`, the skills of every module on the kehikko
  (kehikko-bound ones only when what they need is there) and the ones Kehikot keeps for every
  conversation, translated from Claude Code's format and written into the session's own
  `.vibe/skills/`: in that conversation's `/` menu and nowhere else. A skill of the person's by the
  same name wins, and the session is told so.
- **Working, needs you, finished**, from Vibe's own program status reports (OSC 7501), in the Inbox
  (`activity.set`) and the View menu; a notice when a session nobody is looking at needs its person
  or finishes. "Needs you" is an approval or a question Vibe put up in a conversation that has had a
  turn, which the person has not had on screen since: never an empty conversation at its prompt; it
  goes when answered, opened or ended.
- **Research complete** (protocol 2.31.0): `tell_finished` on this module's door tags the turn; a
  subagent that finishes is one when it is Vibe's `explore` or its task reads as research. Sound
  "answer".
- **Interrupted work.** A conversation a restart cut off mid-turn is a "needs you" line, and —
  unless "Resume conversations cut off by a restart" is off — is told what happened when its place is
  next opened.
- **The context meter** under the session: the tokens in the context at the last request, from the
  conversation's record, with **Compact** (`/compact`) and **Clear** (`/clear`) typed only on a
  person's press, only while Vibe waits at its prompt.
- **The footer.** In an app that draws module footers (protocol 2.38.0, `kehikot.footer`), the
  context meter, the model, **Compact** and **Clear** (Clear with the app's confirm, neither for
  agents) and the notes along the bottom — folder renamed, modules changed, session ended, install
  failed, each with its button as a run (and the install log as a toggle) — are declared as footer
  items (`src/view/footer.ts`) and the page draws none of its own. Any other app gets no footer and
  the page draws its own line and rows as before.
- **Settings** (Kehikot › Settings): resume conversations cut off by a restart; the model
  (`VIBE_ACTIVE_MODEL`); when Vibe asks before acting (`--agent ask | accept-edits | smart-approve`,
  or the person's Vibe config). Never `auto-approve`.
- **Install** from the container, in a terminal the person watches: `uv tool install mistral-vibe`
  when `uv` is here, otherwise the vendor's `curl -LsSf https://mistral.ai/vibe/install.sh | bash`.
  Neither needs admin rights. Signing in is Vibe's own first screen afterwards.
- **`sessions`**, an MCP tool that reads, and `tell_finished`.
- `holds: ['live-sessions']`, `shows: ['agent-session']`, `personEnv` for every process it starts.

## What Vibe supports, as found

| | Mistral Vibe CLI 3.0.4 |
|---|---|
| **Installed here?** | No: `vibe`, `vibe-acp` are on no PATH of this machine, so `--version`/`--help` were read from the source (`vibe/cli-rust/src/cli.rs`). |
| **Install** | `curl -LsSf https://mistral.ai/vibe/install.sh \| bash` (installs uv, then `uv tool install mistral-vibe`), or `uv tool install mistral-vibe` (Python ≥ 3.12). Lands in `~/.local/bin`. `vibe update` upgrades. The `vibe` script is a tiny Python launcher that execs a bundled Rust TUI (`vibe-rs`), which runs a Python app-server as its child. |
| **Non-interactive** | `vibe -p "…"` (or `--prompt-file`, stdin) with `--output text\|json\|streaming`, `--max-turns`, `--max-tokens`, `--max-price`, `--time-limit`, `--output-dir` (writes `export.json`: tokens, cost, outcome). Exit codes 0/1/2/3. Denies every approval unless `--auto-approve`. |
| **Sessions** | `vibe --resume <id>` (partial ids work, from any folder), `--resume` (picker), `-c/--continue`, `/resume`, `/branch`, `/rewind`, `/clear`. Vibe chooses the id (UUID-shaped). Records at `<save_dir>/unified/<id>/` (`CURRENT` → `generations/<g>/projection-state.json` + a journal + content-addressed chunks), `save_dir` = `~/.vibe/logs/session`. A running conversation holds `<save_dir>/active/<id>.lock` with its process id beside it in `<id>.lock.json`. No way to choose the id at start. |
| **Per-run config** | `VIBE_<KEY>` environment variables are a layer over the user and project `config.toml` (`VIBE_MCP_SERVERS` as JSON, `VIBE_ACTIVE_MODEL`, `__` for nested keys). `--add-dir <dir>` makes a folder a trusted project root for that session: its `.vibe/hooks.toml`, `.vibe/skills/`, `.vibe/agents/`, `.vibe/prompts/` and `AGENTS.md` are read (its `.vibe/config.toml` is not). `VIBE_HOME` would move everything, credentials included, so it is not used. `--agent`, `--enabled-tools`, `--disabled-tools`, `--workdir`, `--trust`, `--worktree`. |
| **MCP** | `[[mcp_servers]]` with `http`, `streamable-http`, `stdio`; `vibe mcp add`, `/mcp`. Merged across layers by `name` (`WithUnionMerge`), so a per-process `VIBE_MCP_SERVERS` adds to the person's own. Tools are `<server>_<tool>`. |
| **Hooks / context injection** | `hooks.toml` (project, `--add-dir` folders, user, plugins): `pre_tool`, `post_tool`, `post_agent` only. Each gets `session_id`, `parent_session_id`, `transcript_path`, `cwd`, `hook_event_name` (+ tool fields, or `agent_name`). `post_tool` can append `additional_context` to a tool's result; `post_agent` can make the agent retry. **No hook at a session's start, at a prompt, or at an approval.** Per-session context at the start: `AGENTS.md` (user, project chain, `--add-dir` roots), stored with the session's instructions. Subagents run `post_agent` too, with their own session id and a parent. |
| **Skills / commands** | Agent Skills format (`SKILL.md`, `name`, `description`, `user-invocable`, `disable-model-invocation`, `allowed-tools` not enforced). Found in `skill_paths`, `.vibe/skills/` and `.agents/skills/` of trusted project roots (so `--add-dir`), `~/.vibe/skills`, `~/.agents/skills`, plugins. Each is a `/name` slash command. No `$ARGUMENTS`, no load-time command lines, no session-id variable. |
| **How it reports state** | Its TUI asks the terminal `ESC ]7501;?` and, when answered, reports `state=idle\|working\|done\|error\|blocked:kind=permission\|blocked:kind=question` (`:app=vibe`, base64 `msg`) on every change (`experimental_enable_tab_status`, on by default). Without an answer: the terminal title (`>> ` working, `? ` blocked) and a bell when unfocused. `vibe run-server` / the app-server speak JSON-RPC for embedders (not used: it replaces the TUI). |
| **Usage** | The public session in each generation carries `context_usage` and `token_usage` (`input/output/total/cached_input_tokens`) and the model. No context window in the record (it is the model preset's). Cost only from prices in the config ("indicative only"), in `export.json` of headless runs and `/status`. Admin API has org-level Vibe analytics. |
| **Environment** | Hooks inherit the Vibe process's environment. No variable names the conversation in the commands Vibe runs. |

## The Codex module, feature by feature

| Codex 0.6.1 | Vibe 0.1.0 | |
|---|---|---|
| Terminal sessions per place, reload reconnects to the same screen | **done** | the same server-owned runs and headless screen |
| Filed per place, auto-assigned, the kehikko's own | **adapted** | Vibe chooses the id; filed when a hook names it: the first tool call, else the end of the first turn (Codex: the first prompt) |
| Resume after restarts and updates | **done** | `--resume <id>` when the place is next opened; a session ends with this module (no background server) |
| A conversation open in another process | **adapted** | read from Vibe's leases (`active/<id>.lock(.json)`, the process id checked alive) instead of `lsof`. "Open it here anyway" lets Vibe refuse it as busy in its own words |
| Kehikot's MCP doors per session | **done, better** | `VIBE_MCP_SERVERS` in the environment, merged by name; the token is not on the command line |
| Skills per session, kehikko-bound by `needs` | **done, better** | written into the session's own `--add-dir` folder: no `~/.agents/skills` install, no marker, no switching off in other processes |
| `/kehikot-here` | **adapted** | Vibe gives commands no conversation id, so the skill names the run (`KEHIKOT_TELL_SESSION`) and the door takes its conversation: only for conversations started here (to move one) |
| Context at start and changes at the next prompt (`sessionNotes`) | **adapted** | start: the kit's `AGENTS.md` (a new session, or one `/clear` makes); changes: after the next tool call (`post_tool`), not the next prompt. A resumed conversation keeps the instructions it was made with and hears changes after its next tool call |
| What this conversation was told | **done** | |
| Working / needs you / finished, notices, Inbox | **done, better** | from Vibe's own OSC 7501 reports, which name an approval and a question apart; no hooks needed for state |
| Research complete (`events`, sound "answer") | **adapted** | `tell_finished` tags the turn (ended by `post_agent`); subagents by `explore` or a research-like task. Vibe has no subagent-start hook, so a tag never goes to a subagent |
| Interrupted-work alert after a restart | **done** | the record's `working` mark; Vibe's journal is not read for turns |
| Context meter | **adapted** | tokens at the last request and the model, from `context_usage`; no window (not in the record), no share, no "compacts soon", no compaction count, no cost |
| Compact and Clear | **done** | `/compact`, `/clear`, on a press, only at the prompt |
| Settings | **adapted** | resume after a restart; model (`VIBE_ACTIVE_MODEL`); agent (`ask`/`accept-edits`/`smart-approve`). No reasoning-effort setting (Vibe's thinking level is per model preset and `/thinking`) |
| `sessions` MCP tool, `tell_finished` | **done** | |
| Install helper | **done** | `uv tool install mistral-vibe`, else the vendor's script; no admin rights |
| Ready-built, run.sh stamp check | **done** | |
| Icon | **adapted** | `lucide:zap`: the protocol has no Mistral mark yet |
| Sessions started outside Kehikot reported | **not done** | would need a hook in `~/.vibe/hooks.toml` |
| A session name at start | **not possible** | Vibe takes none (`/rename` is typed in the session) |
| `${CLAUDE_SESSION_ID}` in modules' skills | **not possible** | Vibe sets no such variable; the skill text says it is unknown |

## Where its data lives

`<project>/.kehikot/vibe/places.json` (which session belongs to which place) and
`<project>/.kehikot/vibe/settings.json`. Nothing in `~/.vibe` or the project's `.vibe/` is written;
Vibe's own records are read (`logs/session/unified/<id>/CURRENT` and the newest generation's
`projection-state.json`, and `logs/session/active/`). A session's folder (its skills, hooks, notes,
context hook and token, 0700/0600) is in this user's temporary directory under
`kehikot-vibe-<uid>/`, removed when the session ends.

A `save_dir` set in the person's `config.toml` is not read (this module reads no config of theirs);
`VIBE_SESSION_LOGGING__SAVE_DIR` is honoured. With a moved `save_dir`, conversations are still
started and resumed, but not listed or filed.

## What it never does

- It never sends a prompt of anybody's. Its one sentence goes, once, to a conversation a restart cut
  off, behind the person's setting; and `/compact` or `/clear` on a person's press.
- It never widens what Vibe may do: no `--auto-approve`/`--yolo`, no `--trust`, no `auto-approve`
  agent.
- It never writes Vibe's config, hooks, skills, agents or trusted folders.
- It never reads what a hook is handed beyond the conversation's ids and a subagent's name, and never
  reads a conversation's history.

## Not verified against a real Vibe

The mechanisms were read in the source; with no Vibe installed and no Mistral account used, these
are unmeasured and are the first things to check on a machine that has it: that the TUI's OSC 7501
query reaches this module's pty and the reports follow; that `--add-dir` folders' hooks, skills and
`AGENTS.md` load in an interactive session as the source says; that `VIBE_MCP_SERVERS` parses as
JSON; when a new session's `CURRENT` first appears.

## Checks

```bash
bun run typecheck
bun test
bun run check:door
bun run build
```

The tests give themselves a machine of their own (`test/setup.ts`): a scratch home, `VIBE_HOME`,
registry and PATH, and `test/stand-in/vibe` for the CLI.
