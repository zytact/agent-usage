# agent-usage

Local CLI that reads coding-agent session history and generates a usage dossier — active time, token volume, model mix, costs, repos, and recent activity.

## Sources

| Source      | Location                                                          |
| ----------- | ----------------------------------------------------------------- |
| Codex       | `~/.codex/sessions/`                                              |
| opencode    | `~/.local/share/opencode/opencode.db`                             |
| Pi          | `~/.pi/agent/sessions/`, `~/.pi/workflows/projects/*/runs/*.json` |
| Claude Code | `~/.claude/projects/`                                             |

The Pi Source includes completed `pi-dynamic-workflows` records with the Originator shown as `pi-dynamic-workflows`. Workflow records provide aggregate Session accounting, not request-level or reasoning-token detail. If `persistAgentSessions=true` writes workflow subagents as standard Pi Sessions, their explicit `workflow:<runId> <label>` metadata is used to subtract the represented accounting from the aggregate record, preventing duplicate Sessions, Requests, and tokens. Mixed persistence fallback is supported.

## Usage

```
agent-usage [--codex] [--opencode] [--pi] [--claude] [--scope today|1d|7d|30d] [--full | --section KEY[,KEY...]] [--originators] [--html [FILE]] [--no-cache]
```

Run without flags for an interactive terminal report. It will prompt for a time range, then prompt for sources with nothing preselected, then prompt for report sections with the default summary set preselected.

In non-interactive flag mode, pass at least one source flag: `--codex`, `--opencode`, `--pi`, or `--claude`.

| Flag            | Description                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------------- |
| `--codex`       | Include Codex sessions                                                                             |
| `--opencode`    | Include opencode sessions                                                                          |
| `--pi`          | Include Pi sessions                                                                                |
| `--claude`      | Include Claude Code sessions                                                                       |
| `--scope`       | Skip the prompt: `today`, `1d`, `7d`, `30d`                                                        |
| `--full`        | Show full diagnostic report (per-source sections, distribution tables, daily model breakdown)      |
| `--section`     | Show only selected sections. Repeatable and accepts comma-separated keys.                          |
| `--originators` | Show per-originator source sections (for example T3 Code, Desktop, CLI, Subagent)                  |
| `--html [FILE]` | Write a standalone HTML report. Omit `FILE` to open in browser. Use `--html=-` to print to stdout. |
| `--no-cache`    | Reparse session files instead of using the parsed-session cache.                                   |
| `-h, --help`    | Show help                                                                                          |

## Install

```sh
vp install
vp run build
```

The binary is at `./dist/cli.mjs`.

## Build & check

```sh
vp check   # format + lint + typecheck
vp test run    # run tests
vp run build   # pack binary
```

## Output

In **summary mode** (default): request summary, daily usage, source shares, model breakdown, token mix, top repos, and per-source sections for the selected sources.

In **full mode**: adds GPT-only request summary, distribution tables (tokens/min, context size), daily model breakdown rows, language stats, and detailed per-source panels.

Section keys: `request-summary`, `gpt-only-request-summary`, `daily-usage`, `daily-breakdown`, `source-share`, `model-breakdown`, `token-mix`, `top-repos`, `source-sections`, `source-section-languages`.

The **HTML report** is self-contained (no external resources). It uses a calm, dark analytical design with layered red-black surfaces and restrained coral signals.

## Design

See [DESIGN.md](./DESIGN.md) for the design system specification (color tokens, typography, layout principles).

## License

ISC
