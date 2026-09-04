# Scope filtering

## Sub-features

- `today`, `1d`, `7d`, and `30d` Scope values
- `Pick a time range` interactive prompt
- Invalid Scope errors
- Scope-sensitive availability of the Daily usage Section

## How to get to it (user POV)

Pass `--scope today`, `--scope 1d`, `--scope 7d`, or `--scope 30d`. Without the flag, choose a Scope at `Pick a time range`.

## Driving it with drive.sh

Run `scripts/drive.sh terminal-summary` for `today`. Launch rewrites the fixture timestamps to the current day, so the Terminal report must include its two Requests. For another Scope, run the recorded binary with that public `--scope` value and capture the same four evidence files.

## Gotchas

The fixture file's modification time and event timestamps both matter. Always use `launch.sh`; copying the repository fixture unchanged can produce `No sessions found in this range.`
