# Source data formats

How each Source stores history, which fields the parsers read, and the quirks that have caused wrong numbers before. Check this before debugging a count, and update it when a parser learns something new.

Discovery (`src/discovery.ts`) picks files by modification time. Filenames and dated directories record creation, so a resumed Session keeps an old name while gaining new Requests.

## Codex

- Location: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`. Parser: `src/parsers/codex.ts`.
- Each line is `{ timestamp, type, payload }`.
- `session_meta` holds the session `id`, `cwd`, and `originator`. A Session is a subagent when it has `thread_source: "subagent"`, a `parent_thread_id`, or `source.subagent`.
- `turn_context` sets the current `model` and `effort`. Later Requests inherit them.
- Each `event_msg` with `payload.type === "token_count"` is one Request. `payload.info.last_token_usage` holds that Request's tokens, and `total_token_usage` holds the running Session total.
- Codex writes no cache-write field, so cache-write Telemetry availability is always `unknown`. It is not zero.

## Claude Code

- Location: `~/.claude/projects/<encoded-cwd>/*.jsonl`, with subagent transcripts under `<session>/subagents/`. Parser: `src/parsers/claude.ts`.
- `type: "assistant"` lines carry `message.usage`. Streaming writes the same `message.id` several times, so the parser merges by id and keeps the most complete usage. Summing every line double-counts.
- Usage fields: `input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, `cache_creation.ephemeral_1h_input_tokens`, and `output_tokens`. Reasoning tokens are known only when `output_tokens_details.reasoning_tokens` (counted inside output) or `reasoning_output_tokens` (separate) is present. Thinking content alone gives no number.
- `isSidechain: true` marks a subagent. Otherwise `entrypoint` is the Originator.
- The model `<synthetic>` is not a real model and gets skipped.

## Pi

- Location: `~/.pi/agent/sessions/**/*.jsonl`, or `PI_CODING_AGENT_SESSION_DIR`, or `PI_CODING_AGENT_DIR/sessions`. Parser: `src/parsers/pi.ts`.
- The first line has `type: "session"`. `model_change` and `thinking_level_change` set the current model and effort.
- Every usage record is a Request. That covers `message` entries, including tool results, and also `compaction` and `branch_summary` entries.
- `parentSession` marks a fork, clone, or continued Session, not a subagent. A fork copies the parent's entries with their original timestamps. The parser drops entries older than the fork header so copied history is not counted twice.
- Workflow runs from `pi-dynamic-workflows` live in `~/.pi/workflows/projects/*/runs/*.json` (`src/parsers/pi-workflow.ts`). They only have aggregate accounting, reported under the model `mixed usage`. Scope uses `completedAt`, not file mtime.

## opencode

- Location: SQLite at `~/.local/share/opencode/opencode.db`, read through `sql.js` (no child processes). Parser: `src/parsers/opencode.ts`.
- Tables: `session` (`id`, `directory`, `title`, `time_created`, `time_updated`, `model`, `metadata`) and `message` (`session_id`, `data` JSON).
- `message.data` has `role`, `modelID`, `variant` (effort), `tokens`, `path`, and `time.completed`.
- Scope filters in SQL on `session.time_updated`.

## Inspecting real data

```sh
vp exec tsx src/cli.ts --codex --scope today --json | jq '.models'
jq -c 'select(.type == "event_msg" and .payload.type == "token_count") | .payload.info.last_token_usage' FILE.jsonl
sqlite3 -json ~/.local/share/opencode/opencode.db 'select data from message limit 5'
```
