# Ubiquitous Language

## Usage data

| Term            | Definition                                                                     | Aliases to avoid         |
| --------------- | ------------------------------------------------------------------------------ | ------------------------ |
| **Agent usage** | Measured activity from coding-agent history across selected sources.           | Usage, stats             |
| **Source**      | A supported coding-agent product whose local history can be ingested.          | Agent, provider, harness |
| **Session**     | One contiguous coding-agent conversation or work record from a source.         | Chat, conversation, run  |
| **Request**     | One model invocation with request-level token, model, effort, and timing data. | Call, turn, completion   |
| **Originator**  | The client or sub-system that started a session inside a source.               | Client, launcher, app    |
| **Repository**  | The project directory attributed to a session.                                 | Repo name, project       |
| **Language**    | A programming language inferred from file paths mentioned in session content.  | Tech, stack              |

## Time and scope

| Term            | Definition                                                         | Aliases to avoid                  |
| --------------- | ------------------------------------------------------------------ | --------------------------------- |
| **Scope**       | The report time range used to filter included sessions.            | Range, window                     |
| **Active time** | Estimated engaged work time in a session, capped across idle gaps. | Duration, elapsed time, wall time |
| **Daily usage** | Per-day rollup of active time, requests, tokens, and cost.         | Daily stats, day rows             |

## Token accounting

| Term                   | Definition                                                                      | Aliases to avoid                    |
| ---------------------- | ------------------------------------------------------------------------------- | ----------------------------------- |
| **Input tokens**       | Fresh prompt tokens sent to the model.                                          | Prompt tokens, uncached prompt      |
| **Cached tokens**      | Input tokens served from provider prompt cache reads.                           | Cache read tokens, reused input     |
| **Cache write tokens** | Input tokens written into provider prompt cache.                                | Cache creation tokens, cache writes |
| **Output tokens**      | Visible model response tokens.                                                  | Completion tokens, answer tokens    |
| **Reasoning tokens**   | Hidden model thinking tokens reported separately by a provider.                 | Thinking tokens, hidden output      |
| **Total tokens**       | Provider-reported total tokens, or the local sum when provider total is absent. | Token volume, all tokens            |
| **Context size**       | Input, cached, and cache-write tokens available to a request.                   | Context, prompt size                |
| **Uncached input**     | Fresh input plus cache-write tokens for a request.                              | Fresh context, noncached input      |
| **Cache read ratio**   | Share of context size supplied by cached tokens.                                | Cache ratio, cached share           |

## Reporting

| Term                 | Definition                                                                         | Aliases to avoid               |
| -------------------- | ---------------------------------------------------------------------------------- | ------------------------------ |
| **Usage dossier**    | The generated report summarizing activity, tokens, models, repositories, and cost. | Report, dashboard              |
| **Terminal report**  | The interactive or printed text version of the usage dossier.                      | CLI output, console report     |
| **HTML report**      | The standalone browser-readable version of the usage dossier.                      | Web report, exported report    |
| **Summary mode**     | The default report mode with the core usage sections.                              | Default mode, short report     |
| **Full mode**        | The diagnostic report mode with all available sections and deeper breakdowns.      | Detailed mode, diagnostic mode |
| **Section**          | A named report slice that can be selected independently.                           | Panel, block                   |
| **Source share**     | Breakdown of active time by selected source or originator section.                 | Source split, source mix       |
| **Model breakdown**  | Breakdown of usage by model, including time, tokens, effort, and cost.             | Model mix, model usage         |
| **Token mix**        | Breakdown of token totals by token category.                                       | Token breakdown, token split   |
| **Top repositories** | Repositories ranked by attributed active time.                                     | Top repos, project ranking     |

## Costing

| Term                | Definition                                                                   | Aliases to avoid                 |
| ------------------- | ---------------------------------------------------------------------------- | -------------------------------- |
| **Estimated cost**  | Approximate USD cost calculated from model pricing and observed token usage. | Spend, price, bill               |
| **Pricing map**     | Model pricing data used to estimate cost.                                    | Rate table, price list           |
| **Billable output** | Output plus reasoning tokens charged as completion usage.                    | Charged output, completion total |

## Relationships

- A **Source** has zero or more **Sessions**.
- A **Session** belongs to exactly one **Source**.
- A **Session** has zero or more **Requests**.
- A **Request** belongs to exactly one **Session**.
- A **Session** is attributed to one **Repository** when a working directory is known.
- A **Session** may have one **Originator**.
- A **Usage dossier** includes one **Scope** and one or more selected **Sources**.
- A **Usage dossier** contains one or more **Sections**.
- **Total tokens** include **Input tokens**, **Cached tokens**, **Cache write tokens**, **Output tokens**, and **Reasoning tokens** when provider data supports them.
- **Estimated cost** depends on the **Pricing map**, **Token mix**, and **Model breakdown**.

## Example dialogue

> **Dev:** "For the **Usage dossier**, should **Active time** mean wall-clock duration from **Session** start to end?"
> **Domain expert:** "No. **Active time** is engaged time inferred from event gaps; use **Scope** only to decide which **Sessions** are included."
> **Dev:** "When a **Request** has both **Cached tokens** and **Cache write tokens**, do both count toward **Context size**?"
> **Domain expert:** "Yes. **Context size** is fresh **Input tokens** plus cache reads and cache writes, while **Uncached input** excludes cache reads."
> **Dev:** "Should the per-client breakdown be called client share?"
> **Domain expert:** "Use **Originator** for the client inside a **Source**, and **Source share** for the report section."

## Flagged ambiguities

- "agent" can mean a coding-agent **Source** or a runtime actor; use **Source** when referring to Codex, opencode, Pi, or Claude Code history.
- "usage" can mean the entire **Agent usage** domain, provider token records, or a generated **Usage dossier**; name the narrower concept when possible.
- "duration" can imply wall-clock time, but the report uses **Active time**; avoid "duration" in user-facing labels unless wall time is intended.
- "context" can mean prompt window capacity or per-request **Context size**; use **Context size** for measured request tokens.
- "cache" can mean reads or writes; use **Cached tokens** for reads and **Cache write tokens** for writes.
- "report" can mean **Terminal report**, **HTML report**, or **Usage dossier**; use the precise term when output format matters.
