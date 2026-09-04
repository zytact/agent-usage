---
name: verify-agent-usage
description: Verify Agent Usage through its CLI and generated HTML report after changing ingestion, arguments, report modes, sections, or rendering.
---

# Verify Agent Usage

Drive the built `agent-usage` binary against an isolated Codex Session. Read [features/README.md](features/README.md) before choosing a proof path.

## Launch

From the repository root, run:

```sh
.agents/skills/verify-agent-usage/scripts/launch.sh
```

Launch runs `vp run build`, creates `.local/verify-agent-usage/`, and writes a current-dated Codex fixture under an isolated `HOME`. A printed `AGENT_USAGE_VERIFY_HOME` means it is ready. There is no long-running process.

The fixed run directory makes overlapping launches fail. Finish or clean up the current run before launching another.

## Doctor

Run this read-only check whenever the binary, fixture, or run state looks wrong:

```sh
.agents/skills/verify-agent-usage/scripts/doctor.sh
```

It checks the recorded run, Node 24, fixture structure, build freshness, executable help output, and separation from the real home directory.

## Drive

Use the helper from the repository root:

```sh
.agents/skills/verify-agent-usage/scripts/drive.sh terminal-summary
.agents/skills/verify-agent-usage/scripts/drive.sh full-report
.agents/skills/verify-agent-usage/scripts/drive.sh section-report
.agents/skills/verify-agent-usage/scripts/drive.sh html-report
```

The helper invokes `dist/cli.mjs` with real user-facing flags. Each action validates stable output text and prints its evidence directory. Use the feature map for the path that matches the change.

For the interactive prompt flow, start the binary in a real PTY with the recorded environment:

```sh
. .local/verify-agent-usage/session.env
HOME="$AGENT_USAGE_VERIFY_HOME" XDG_CACHE_HOME="$AGENT_USAGE_VERIFY_CACHE" node dist/cli.mjs
```

Drive the prompts by their visible labels: `Pick a time range`, `Pick sources`, `Pick report sections`, and `Show originators in per-source sections?`.

## Evidence

Proof survives under `.local/verify-evidence/agent-usage/<UTC timestamp>-<action>/`. Every drive stores `command.txt`, `stdout.txt`, `stderr.txt`, and `exit-code.txt`. `html-report` also stores `report.html`.

A valid proof exercises the built CLI through public flags or prompts. Capture the action and resulting state, then check the output file as well as visible terminal text. Do not call renderer or parser functions directly. Use the isolated production-format fixture instead of test-only setters. External Source stores need no mocks because verification selects only the isolated Codex Source. If a later proof covers file or network side effects, observe those effects instead of trusting a flag name.

## Cleanup

Run:

```sh
.agents/skills/verify-agent-usage/scripts/cleanup.sh
```

Cleanup removes only `.local/verify-agent-usage/`. It leaves `.local/verify-evidence/agent-usage/` intact. No process-name kill is needed because every CLI invocation is short-lived.

## Helpers

`launch.sh` builds and prepares isolated state. `doctor.sh` checks that state without changing it. `drive.sh <action>` runs one mapped path and captures proof. For Terminal reports, it calls `run-pty.py` so the real interactive CLI can render and exit through `Choose an action`. `cleanup.sh` removes the isolated run state while preserving proof.
