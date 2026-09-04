#!/usr/bin/env bash
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
session_file="$repo/.local/verify-agent-usage/session.env"
failures=0

check() {
  local name="$1"
  shift
  if "$@"; then
    printf 'ok   %s\n' "$name"
  else
    printf 'FAIL %s\n' "$name"
    failures=$((failures + 1))
  fi
}

if [ ! -f "$session_file" ]; then
  echo "FAIL session file - run scripts/launch.sh" >&2
  exit 1
fi

. "$session_file"
check "isolated home" test "$AGENT_USAGE_VERIFY_HOME" != "$HOME"
check "Node 24" test "$(node -p 'process.versions.node.split(`.`)[0]')" = "24"
check "built CLI" test -f "$repo/dist/cli.mjs"
check "Codex fixture" test -s "$AGENT_USAGE_VERIFY_FIXTURE"
check "fixture records" node -e 'const fs=require("node:fs");const rows=fs.readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse);process.exit(rows.some(r=>r.type==="session_meta")&&rows.some(r=>r.type==="event_msg")?0:1)' "$AGENT_USAGE_VERIFY_FIXTURE"
check "current build" sh -c '! find "$1/src" -type f -newer "$1/dist/cli.mjs" -print -quit | grep -q .' sh "$repo"
check "CLI help" sh -c 'HOME="$1" XDG_CACHE_HOME="$2" node "$3/dist/cli.mjs" --help | grep -q "Usage: agent-usage"' sh "$AGENT_USAGE_VERIFY_HOME" "$AGENT_USAGE_VERIFY_CACHE" "$repo"

exit "$failures"
