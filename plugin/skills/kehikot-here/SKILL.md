---
name: kehikot-here
description: Move this Vibe conversation to the kehikko on screen in Kehikot. Only a person runs it, by typing /kehikot-here (add "own" to make it that kehikko's own conversation, or "kehikko: <key>" to name one).
disable-model-invocation: true
---

The person typed `/kehikot-here` to assign THIS conversation to the kehikko they have on screen in Kehikot. SAY is the words they wrote after `/kehikot-here` — `own`, `kehikko: <key>`, both, or nothing.

1. Run this one command with your shell tool, once: it talks to Kehikot's Vibe module at 127.0.0.1 on this computer. Put SAY in place of `SAY`, inside the single quotes; leave the quotes empty when they wrote nothing. `$KEHIKOT_TELL_SESSION` names the run Kehikot started this conversation in, and is set for every command you run: do not replace it.

   ```sh
   curl -s -m 5 --retry 4 --retry-connrefused --retry-delay 1 --retry-max-time 12 -w '\n[curl exit %{exitcode}: %{errormsg}; HTTP %{http_code}]\n' -X POST -G --data-urlencode "run=$KEHIKOT_TELL_SESSION" --data-urlencode 'say=SAY' {{origin}}/api/here || echo "[no answer from {{origin}}]"
   ```

2. If what it prints begins with "Kehikot:" and the report says HTTP 200, tell the person that answer, word for word, without the bracketed report, and stop. Do nothing else: the module has done what was asked, or said why not and what to type instead.
3. Otherwise the module is restarting, is not running, is older than this skill, or moved to another port. Run this one command, once, the same way: it asks the address the module registered. If what it prints begins with "Kehikot:" and its report says HTTP 200, tell the person that answer, word for word, without the bracketed report, and stop.

   ```sh
   curl -s -m 5 --retry 4 --retry-connrefused --retry-delay 1 --retry-max-time 12 -w '\n[curl exit %{exitcode}: %{errormsg}; HTTP %{http_code}; %{url_effective}]\n' -X POST -G --data-urlencode "run=$KEHIKOT_TELL_SESSION" --data-urlencode 'say=SAY' "$(sed -n 's/.*"url"[[:space:]]*:[[:space:]]*"\(http:\/\/127\.0\.0\.1:[0-9]*\)".*/\1/p' "$HOME/Library/Application Support/Kehikot/modules/kehikot.vibe.json")/api/here"
   ```

4. If that did not give an answer (it failed, printed nothing useful, or the person did not allow it), tell the person ONE line, built from the first report, and stop:
   - `$KEHIKOT_TELL_SESSION` was empty: "Kehikot: /kehikot-here works in a Vibe conversation started from Kehikot's Vibe container. [skill {{version}}]"
   - curl exit 7 (could not connect), 28 (timed out), 52 or 56 (connection closed), or no answer at all: "Kehikot: couldn't reach the Vibe module at {{origin}} (REASON; it may be restarting or not running). Try /kehikot-here again in a moment; if it keeps failing, update Vibe from Kehikot's Updates menu. [skill {{version}}]" — REASON is "connection refused" for 7, "timed out" for 28, "connection closed" for 52 or 56, "no answer" otherwise.
   - curl exit 0 with HTTP 404, 403 or 405: "Kehikot: the Vibe module at {{origin}} answered HTTP CODE to /kehikot-here, so it is older than this skill (or another program has its port). Update Vibe from Kehikot's Updates menu, then type /kehikot-here again. [skill {{version}}]"
   - anything else: "Kehikot: the Vibe module at {{origin}} did not assign this conversation (curl exit N, HTTP CODE: ERROR). Try /kehikot-here again in a moment; if it keeps failing, update Vibe from Kehikot's Updates menu. [skill {{version}}]" — with curl's numbers and error message from the report.

Never run either command again on your own, with another run, or with other words: only the person assigns a conversation, by typing `/kehikot-here`.

Once this conversation has a place: when you or a subagent finish researching something (investigating, comparing, auditing, reading up), say so with `tell_finished({ event: "research-complete", label })` on the Vibe module's MCP server (kehikko-vibe), and the person gets a "Research complete" notice.
