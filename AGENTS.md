# AGENTS.md

## Project

A tool to easily check Claude Code, Codex, Pi and OpenCode usage.

## Ubiquitous language

This repo has a domain glossary at `UBIQUITOUS_LANGUAGE.md`.

Read it when working on domain terminology, product concepts, naming, business rules, user-facing language, or when interpreting ambiguous terms. Prefer the canonical terms defined there, and avoid aliases listed as discouraged.

# Frontend Changes

Use impeccable skill when making UI changes

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
vp check
vp test run
vp run fallow
```

`vp check` formats, lints and type checks in one pass. Never overwrite fallow thresholds or get fallow issues ignored unless it is genuinely needed for good code, and justify it to the developer when you do.

Check `package.json` and `vite.config.ts` for scripts or tasks a change touches, and run them with `vp run <name>`. If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.
