# agent-usage

Local CLI that reads coding-agent session history and generates a usage dossier — active time, token volume, model mix, costs, repos, and recent activity.

## Sources

| Agent       | Location                                       |
| ----------- | ---------------------------------------------- |
| Codex       | `~/.codex/sessions/`                           |
| opencode    | `~/.local/share/opencode/opencode.db`          |
| Pi          | `~/.pi/agent/sessions/`                        |
| Claude Code | `~/.claude/projects/` (opt-in with `--claude`) |

## Usage

```
agent-usage [--claude] [--scope today|1d|7d|30d] [--full | --section KEY[,KEY...]] [--html [FILE]]
```

Run without flags for an interactive terminal report. It will prompt for a time range, then prompt for report sections with the default summary set preselected.

| Flag            | Description                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------------- |
| `--claude`      | Include Claude Code sessions                                                                       |
| `--scope`       | Skip the prompt: `today`, `1d`, `7d`, `30d`                                                        |
| `--full`        | Show full diagnostic report (per-source sections, distribution tables, daily model breakdown)      |
| `--section`     | Show only selected sections. Repeatable and accepts comma-separated keys.                          |
| `--html [FILE]` | Write a standalone HTML report. Omit `FILE` to open in browser. Use `--html=-` to print to stdout. |
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

In **summary mode** (default): request summary, daily usage, source shares, model breakdown, token mix, top repos, and per-source sections for Codex, opencode, Pi (and Claude Code if enabled).

In **full mode**: adds GPT-only request summary, distribution tables (tokens/min, context size), daily model breakdown rows, language stats, and detailed per-source panels.

Section keys: `request-summary`, `gpt-only-request-summary`, `daily-usage`, `daily-breakdown`, `source-share`, `model-breakdown`, `token-mix`, `top-repos`, `source-sections`, `source-section-languages`.

The **HTML report** is self-contained (no external resources). It uses a dark "pre-dawn flight deck" design system with cobalt instrumentation and amber attention marks.

## Design

See [DESIGN.md](./DESIGN.md) for the design system specification (color tokens, typography, layout principles).

## License

ISC
