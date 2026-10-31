# Vibe — notes for agents

A Kehikot module: a terminal holding the Mistral Vibe CLI session that belongs to a place (project,
epic, picked parts, kehikko). The sibling of the Codex and Claude modules: the same record, page and
doors, with `program.ts` answering for Vibe. README.md says what it does and why, and what Vibe can
and cannot do here.

## The rules

- **Nothing in `~/.vibe` (or `$VIBE_HOME`) is written**, and nothing in the project's `.vibe/`. Everything a
  session is given is per run: its own folder (`sessionKit` in skills.ts, 0700 under this user's
  temporary directory), passed with `--add-dir`, holding `.vibe/hooks.toml`, `.vibe/skills/<name>/`,
  `AGENTS.md` and the context hook; and `VIBE_MCP_SERVERS` / `VIBE_ACTIVE_MODEL` in the process's
  environment. The folder goes with the session (`removeKit`), and a stopped process's folders at the
  next start (`sweepKits`).
- **Never** `--auto-approve`, `--yolo`, `--trust`, or the `auto-approve` agent. The person's Settings
  choose `ask`, `accept-edits` or `smart-approve`, or leave it to their Vibe config.
- **State is what Vibe says on its terminal** (OSC 7501, `status.ts`): the pty answers its query and
  reads its reports. Hooks (`post_tool`, `post_agent`) only name the conversation, end a turn for a
  research tag, and carry what changed (`context.sh`). Never read the screen to guess a state.
- **Vibe's records are read, never written**: `<save_dir>/unified/<id>/CURRENT` and the generation's
  `projection-state.json` (title, preview, cwd, model, `context_usage`), and the leases in
  `<save_dir>/active/`. The history chunks and the journal are never read.
- **The notes are the protocol's** (`sessionNotes`), delivered at the start in the kit's `AGENTS.md`
  (`startText`) and as changes after a tool call (`context`). Never word them here.
- **Project data** lives only in `<project>/.kehikot/vibe/` (`record.ts`, the protocol's
  `moduleDir`/`moduleFile`).
- **Tests never reach the real machine**: `test/setup.ts` points HOME, `VIBE_HOME`, the registry and
  PATH at scratch. `test/stand-in/vibe` (a Bun script) imitates the CLI as read in Vibe 3.0.4's source:
  its flags, its records and leases, its hooks file and its status reports. It never calls a model.
- **Never a browser on this Mac**; DOM tests use happy-dom.

## Working on it

```
bun run typecheck
bun test            # the whole suite: through the Test runs queue on a shared machine
bun run check:door
bun run build
```

## Releasing

Kehikot installs and updates this module from its GitHub releases, not from `main`.
Nobody tags by hand: merging the version bump is the release.

1. Bump `version` in `package.json` (semver). It is the only place the version is written.
2. Write `notes/<version>.md`: what a person notices (see `notes/README.md`).
3. Open a PR with both; merge it.
4. On that push to `main`, `.github/workflows/release.yml` (the shared `module-release.yml` in
   Jalez/kehikko-desktop) sees that `package.json`'s version is newer than the latest `v*` tag and that
   the notes exist, creates the annotated tag `v<version>` on the merge commit, checks the notes,
   typechecks and tests, then publishes the release "Vibe <version>" in the same run.

## Ready-built

`run.sh` serves the built page (`serve.ts`, the protocol's `run`) when `dist/.kehikot-built` names
the commit checked out, and Vite otherwise. `bun run build` makes it; a host runs that at install
and update, never at start. Under Bun the pty is Bun's own (`pty.ts`).
