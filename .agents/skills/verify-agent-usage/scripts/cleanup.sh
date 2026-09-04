#!/usr/bin/env bash
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
run_dir="$repo/.local/verify-agent-usage"

if [ -d "$run_dir" ]; then
  rm -rf "$run_dir"
  echo "Removed $run_dir."
else
  echo "No verification run to remove."
fi

echo "Evidence kept in $repo/.local/verify-evidence/agent-usage/."
