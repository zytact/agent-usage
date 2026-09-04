#!/usr/bin/env bash
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
run_dir="$repo/.local/verify-agent-usage"
evidence_root="$repo/.local/verify-evidence/agent-usage"

if [ -e "$run_dir/session.env" ]; then
  echo "A verification run already exists at $run_dir/session.env." >&2
  echo "Run .agents/skills/verify-agent-usage/scripts/cleanup.sh first." >&2
  exit 2
fi

cd "$repo"
vp run build
mkdir -p "$run_dir/home/.codex/sessions" "$run_dir/cache" "$evidence_root"
node .agents/skills/verify-agent-usage/scripts/prepare-fixture.mjs \
  "$repo/test/parsers/codex.fixture.jsonl" \
  "$run_dir/home/.codex/sessions"

{
  printf 'export AGENT_USAGE_VERIFY_REPO=%q\n' "$repo"
  printf 'export AGENT_USAGE_VERIFY_DIR=%q\n' "$run_dir"
  printf 'export AGENT_USAGE_VERIFY_HOME=%q\n' "$run_dir/home"
  printf 'export AGENT_USAGE_VERIFY_CACHE=%q\n' "$run_dir/cache"
  printf 'export AGENT_USAGE_VERIFY_EVIDENCE=%q\n' "$evidence_root"
  printf 'export AGENT_USAGE_VERIFY_FIXTURE=%q\n' "$run_dir/home/.codex/sessions/verify-session.jsonl"
} > "$run_dir/session.env"

cat "$run_dir/session.env"
