# Source selection

## Sub-features

- Explicit `--codex`, `--opencode`, `--pi`, and `--claude` flags
- Multi-Source selection by repeating Source flags
- Interactive `Pick sources` prompt when no Source flag is passed
- Missing-Source error in non-interactive flag mode

## How to get to it (user POV)

Run `agent-usage` and choose Sources at the prompt, or pass one or more Source flags. The isolated verifier has data only for Codex, so use `--codex` for a positive proof.

## Driving it with drive.sh

Run `scripts/drive.sh terminal-summary`. The recorded command passes `--codex`, and `stdout.txt` must contain the `T3 CODE` Source section without the empty-range notice. For prompt changes, use the PTY recipe in the parent skill and select `Codex` at `Pick sources`.

## Gotchas

Selecting another Source reads only the verifier's empty isolated store, not the user's real history. Preserve Source capitalization from the product language: Codex, opencode, Pi, and Claude Code.
