# Report modes

## Sub-features

- Summary mode as the default
- Full mode through `--full`
- Originator breakdown through `--originators`
- Rejection of `--full` combined with `--section`

## How to get to it (user POV)

Run with a Source and Scope for Summary mode. Add `--full` for the diagnostic Usage dossier. Add `--originators` when per-Originator Source sections matter.

## Driving it with drive.sh

Run `scripts/drive.sh terminal-summary` for Summary mode and `scripts/drive.sh full-report` for Full mode. The full proof must contain the detailed token legend and `DAILY MODEL BREAKDOWN`; the summary proof must omit both.

## Gotchas

`--full` and `--section` are mutually exclusive. Full mode changes the set of Sections, not the underlying Session ingestion.
