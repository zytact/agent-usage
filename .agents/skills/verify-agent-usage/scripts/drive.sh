#!/usr/bin/env bash
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
session_file="$repo/.local/verify-agent-usage/session.env"
action="${1:-}"

if [ ! -f "$session_file" ]; then
  echo "No verification run. Run scripts/launch.sh first." >&2
  exit 2
fi

. "$session_file"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
evidence_dir="$AGENT_USAGE_VERIFY_EVIDENCE/$stamp-$action"
mkdir -p "$evidence_dir"

case "$action" in
  terminal-summary)
    args=(--codex --scope today --originators --section request-summary,source-share,model-breakdown,token-mix,top-repos,source-sections --no-cache)
    ;;
  full-report)
    args=(--codex --scope today --originators --full --no-cache)
    ;;
  section-report)
    args=(--codex --scope today --originators --section request-summary,model-breakdown --no-cache)
    ;;
  html-report)
    args=(--codex --scope today --section request-summary,source-share,model-breakdown,token-mix,top-repos,source-sections --html "$evidence_dir/report.html" --no-cache)
    ;;
  *)
    echo "Usage: drive.sh terminal-summary|full-report|section-report|html-report" >&2
    exit 2
    ;;
esac

printf 'HOME=%q XDG_CACHE_HOME=%q node %q' "$AGENT_USAGE_VERIFY_HOME" "$AGENT_USAGE_VERIFY_CACHE" "$repo/dist/cli.mjs" > "$evidence_dir/command.txt"
printf ' %q' "${args[@]}" >> "$evidence_dir/command.txt"
printf '\n' >> "$evidence_dir/command.txt"

set +e
if [ "$action" = "html-report" ]; then
  HOME="$AGENT_USAGE_VERIFY_HOME" XDG_CACHE_HOME="$AGENT_USAGE_VERIFY_CACHE" \
    node "$repo/dist/cli.mjs" "${args[@]}" \
    > "$evidence_dir/stdout.txt" 2> "$evidence_dir/stderr.txt"
  code=$?
else
  HOME="$AGENT_USAGE_VERIFY_HOME" XDG_CACHE_HOME="$AGENT_USAGE_VERIFY_CACHE" \
    python3 "$repo/.agents/skills/verify-agent-usage/scripts/run-pty.py" \
    "$evidence_dir/stdout.txt" node "$repo/dist/cli.mjs" "${args[@]}" \
    2> "$evidence_dir/stderr.txt"
  code=$?
fi
set -e
printf '%s\n' "$code" > "$evidence_dir/exit-code.txt"

if [ "$code" -ne 0 ]; then
  echo "Drive failed with exit code $code. Evidence: $evidence_dir" >&2
  exit "$code"
fi

case "$action" in
  terminal-summary)
    grep -q "^SUMMARY" "$evidence_dir/stdout.txt"
    grep -q "CODEX VIA T3 CODE" "$evidence_dir/stdout.txt"
    ! grep -q "No sessions found in this range" "$evidence_dir/stdout.txt"
    ! grep -q "DAILY MODEL BREAKDOWN" "$evidence_dir/stdout.txt"
    ;;
  full-report)
    grep -q "Legend: input=fresh prompt" "$evidence_dir/stdout.txt"
    grep -q "DAILY MODEL BREAKDOWN" "$evidence_dir/stdout.txt"
    ;;
  section-report)
    grep -q "^SUMMARY" "$evidence_dir/stdout.txt"
    grep -q "  Models" "$evidence_dir/stdout.txt"
    ! grep -q "  Token mix" "$evidence_dir/stdout.txt"
    ! grep -q "  Top repos" "$evidence_dir/stdout.txt"
    ;;
  html-report)
    test -s "$evidence_dir/report.html"
    grep -q '<h1>Agent usage</h1>' "$evidence_dir/report.html"
    grep -q '<h2>Source share</h2>' "$evidence_dir/report.html"
    grep -q '<h3>Codex</h3>' "$evidence_dir/report.html"
    ! grep -q 'No sessions found in this range' "$evidence_dir/report.html"
    ;;
esac

printf '%s\n' "$evidence_dir"
