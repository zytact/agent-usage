# AGENTS.md

## Project

`agent-usage` is a local CLI that reads coding-agent history (Codex, Claude Code, Pi, opencode) and renders a usage dossier as a terminal report, HTML report, or JSON.

The pipeline runs in one direction: `discovery.ts` finds session files, `parsers/<source>.ts` turns each into a `ParsedSession` (`domain.ts`), `runtime.ts` caches and collects them, `report-data.ts` builds the report with `pricing.ts` and `effort-breakdown.ts`, and `terminal-report.ts`, `html-report.ts`, or `json-report.ts` renders it.

## Ubiquitous language

This repo has a domain glossary at `UBIQUITOUS_LANGUAGE.md`.

Read it when working on domain terminology, product concepts, naming, business rules, user-facing language, or when interpreting ambiguous terms. Prefer the canonical terms defined there, and avoid aliases listed as discouraged.

## Source data

Read `docs/sources.md` before changing a parser or debugging a count, token total, or cost. It lists each Source's record format and the quirks that have caused wrong numbers before.

Inspect computed results by running the CLI from source with `--json`, for example `vp exec tsx src/cli.ts --codex --scope today --json | jq '.models'`. The output names models without a models.dev price under `unpricedModels`. Add `--no-cache` when a sandbox blocks writes to `~/.cache`. For anything `--json` lacks, write a scratch `.mts` file under `.local/` and run it with `vp exec tsx`, since `tsx -e` compiles as CommonJS and rejects top-level `await`.

Imports use `.js` specifiers that resolve to `.ts` files, so run source through `tsx`. Use `vp exec` when piping output, because `vp run` prints a banner to stdout.

## Frontend changes

`DESIGN.md` holds the visual system and `PRODUCT.md` holds audience and tone. Follow both for UI changes and update them when the design changes. Prove visual changes with the `verify-agent-usage` skill's `html-screenshot` action.

## Skills

`.agents/skills` (Codex) and `.claude/skills` (Claude Code) hold byte-identical copies. Edit `.agents/skills`, then run `cp -r .agents/skills/. .claude/skills/`. `test/skills.test.ts` fails when they differ.

<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Tool Versions

Run `vp toolchain` to show versions and relationships in the active Vite+
release. Add a tool name to select part of the graph. For example, run
`vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use
`vp why <package>` to show the package-manager dependency graph.

<!--VITE PLUS END-->

## Validation

Run `vp install` after pulling remote changes. After any change, run:

```sh
vp check --fix
vp test run
vp run fallow
```

`vp check --fix` formats, then lints and type checks in one pass. Never overwrite fallow thresholds or get fallow issues ignored unless it is genuinely needed for good code, and justify it to the developer when you do.

Check `package.json` and `vite.config.ts` for scripts or tasks a change touches, and run them with `vp run <name>`. If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.
