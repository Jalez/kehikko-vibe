#!/bin/sh
#
# What a session this module started runs after each tool call, to be told what
# changed about where it is: its place, the modules on its kehikko (see context.ts).
# What it is told at its start is in its folder's AGENTS.md, which Vibe reads
# into the session's instructions; this is for what changes after.
#
#   /bin/sh context.sh PostToolUse
#
# It is one of the hooks this module gives a Vibe session for that one process
# (`post_tool` in the `.vibe/hooks.toml` of its folder, passed with `--add-dir`;
# see `hooksFile` in program.ts), copied into that folder (`sessionKit` in
# skills.ts) beside `kehikot/token`, `kehikot/stable`, `kehikot/origin` and
# `kehikot/registration`, which this module wrote there 0600 for this one session. Vibe appends what a
# `post_tool` hook answers as `hook_specific_output.additional_context` to the
# tool's result, which the model reads next (docs: "Hooks", `post_tool`); that is
# the whole point of it, so unlike tell.sh this one prints — and only the answer of
# this module's own server, only when it is that answer.
#
#   - Of what Vibe hands it, one thing leaves this script: the session's id,
#     checked for its exact spelling. The tool's input and output are never read
#     out of it, sent, stored or shown. A subagent's tool says nothing.
#   - The token goes to curl on a pipe, never on a command line.
#   - It speaks only to this computer: the origin is checked to be loopback,
#     and no proxy is used.
#   - After guard.sh let a tool run without the guards because Kehikot did not answer
#     (`kehikot/unguarded`), the agent is told so here, with how to queue heavy work
#     itself, and the marker goes: a `pre_tool` hook of Vibe's cannot tell the model.
#   - It never holds the session up for long and never fails it: four seconds
#     at most, every outcome is exit 0, and anything that is not this module's
#     answer is nothing.

event=${1-}
case $event in PostToolUse) ;; *) exit 0 ;; esac

here=$(/usr/bin/dirname "$0")/kehikot
token=$(/bin/cat "$here/token" 2>/dev/null)
origin=$(/bin/cat "$here/origin" 2>/dev/null)
case $token in '' | *[!A-Za-z0-9_-]*) exit 0 ;; esac
[ ${#token} -le 64 ] || exit 0

curl=/usr/bin/curl
sed=/usr/bin/sed
[ -x "$curl" ] && [ -x "$sed" ] || exit 0

# The hook's input is one JSON object. Inside its strings a quote is escaped, so a
# quoted key followed by a colon is only ever a real key (a tool's output cannot fake one).
input=$(/usr/bin/head -c 262144 2>/dev/null | /usr/bin/tr -d '\n\r')
session=$(printf '%s' "$input" | "$sed" -n 's/.*"session_id" *: *"\([0-9a-f-]\{36\}\)".*/\1/p')
parent=$(printf '%s' "$input" | "$sed" -n 's/.*"parent_session_id" *: *"\([0-9a-f-]\{36\}\)".*/\1/p')
case $session in '' | *[!0-9a-f-]*) exit 0 ;; esac

# What the agent is told after a tool guard.sh let through unguarded (see guard.sh).
unguarded='Kehikot did not answer (it may be restarting), so that tool call ran without the guards of the modules on your kehikko. Until it is back, run heavy work (tests, typechecks, builds, big installs) through Queue yourself: its CLI, the kehikot-queue program its wait lines name, run as `kehikot-queue run -- <command>` in the background, waits for Queue to come back and exits with the exit code of the command.'
note=
if [ -f "$here/unguarded" ]; then
  /bin/rm -f "$here/unguarded"
  note=$unguarded
fi
if [ -n "$parent" ]; then
  [ -z "$note" ] || printf '{"hook_specific_output":{"additional_context":"%s"}}\n' "$note"
  exit 0
fi

ask() {
  case $1 in http://127.0.0.1:[0-9]*) ;; *) return 1 ;; esac
  printf 'header = "x-module-ticket: %s"\n' "$token" |
    "$curl" -q --config - --silent --fail --max-time 4 --connect-timeout 1 --noproxy '*' \
      --request POST "$1/api/context?event=$event&session=$session" 2>/dev/null
}

# Kehikot's stable address for this module (`kehikot/stable`, the host's `/m/<this module>`, which
# follows it to whatever port it bound) first, then the origin it served on, then what its
# registration says now. An answer with nothing in it is an answer.
stable=$(/bin/cat "$here/stable" 2>/dev/null)
said=
asked=1
[ -n "$stable" ] && said=$(ask "$stable") && asked=0
if [ "$asked" -ne 0 ]; then
  said=$(ask "$origin")
  asked=$?
fi
if [ "$asked" -ne 0 ] && [ -f "$here/registration" ]; then
  reg=$(/bin/cat "$here/registration" 2>/dev/null)
  if [ -f "$reg" ]; then
    url=$("$sed" -n 's/.*"url"[[:space:]]*:[[:space:]]*"\(http:\/\/127\.0\.0\.1:[0-9]*\)".*/\1/p' "$reg" | /usr/bin/head -n 1)
    [ -n "$url" ] && [ "$url" != "$origin" ] && said=$(ask "$url")
  fi
fi

head='{"hook_specific_output":{"additional_context":"'
case $said in
  "$head"*)
    if [ -n "$note" ]; then printf '%s%s\\n\\n%s\n' "$head" "$note" "${said#"$head"}"; else printf '%s\n' "$said"; fi
    ;;
  *) [ -z "$note" ] || printf '{"hook_specific_output":{"additional_context":"%s"}}\n' "$note" ;;
esac
exit 0
