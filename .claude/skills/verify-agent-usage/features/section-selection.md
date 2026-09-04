# Section selection

## Sub-features

- Repeatable `--section`
- Comma-separated Section keys
- Interactive `Pick report sections` prompt
- Scope validation for `daily-usage`

## How to get to it (user POV)

Pass `--section KEY[,KEY...]` in Summary mode or choose Sections at `Pick report sections`. The valid keys are printed by `agent-usage --help` and documented in the README.

## Driving it with drive.sh

Run `scripts/drive.sh section-report`. It selects `request-summary,model-breakdown`. `stdout.txt` must contain `SUMMARY` and `Models`, and must omit `Token mix` and `Top repos`.

## Gotchas

`daily-usage` is invalid with `--scope today`. Section labels in rendered output use spaces, while CLI values use lowercase kebab-case keys.
