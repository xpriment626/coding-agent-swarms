# Review rubric — pair vs single, median-prompt URL shortener

## What this experiment is

Two coding-agent configurations are being compared on the **same** under-specified project prompt:

- **Pair arm** — two Kimi K2.6 agents sharing a Daytona sandbox, communicating peer-to-peer through a single Coral thread, with no upstream orchestrator and no assigned roles ("you are the X" persona prompts deliberately omitted).
- **Single arm** — one Kimi K2.6 agent in its own Daytona sandbox, same tool surface minus peer-comms.

The prompt (`PROMPT.md` in this directory) is written in 50th-percentile-user voice: casual, ~2 paragraphs, under-specified. Both outputs are **expected to be bad** — the question this review answers is *which is less bad, and where does the delta come from*.

The thesis being tested: pair execution without role assignment produces better first-pass code hygiene and design than a single agent running solo, because peer dialogue surfaces design decisions that solo execution leaves implicit.

## What you (the reviewer) read, in order

1. `PROMPT.md` — the project prompt both arms received. Anchor your "completeness vs reasonable interpretation" judgment to this and nothing else.
2. `pair/<run-id>/code/` and `single/<run-id>/code/` — the exported `/workspace` from each sandbox. This is the artifact a hypothetical user would walk away with.
3. `pair/<run-id>/trace/agent-A.jsonl`, `agent-B.jsonl`, `single/<run-id>/trace/agent.jsonl` — per-iteration reasoning traces. JSONL where each line is one outer agent iteration with a `steps[]` array; each step carries `reasoning`, `reasoningDetails`, and `toolCalls`. Use these to attribute artifact-level differences to specific moments in the conversation.

## Scoring — 1-to-5 per dimension, with citations

For each arm, score every dimension below. Cite specific `path/to/file.ts:LN-LN` evidence for every score that isn't a 3. **No score without a citation.** Anchored descriptions:

- **1 — broken or harmful.** Crashes, missing core functionality, or actively dangerous (e.g. shipped open redirect, unparameterized SQL on user input).
- **2 — below median.** Works in the happy path but has a clear avoidable defect a competent developer would catch on first read.
- **3 — median competent.** Functional, no obvious blunders, but not thoughtful. The thing a tutorial would produce.
- **4 — good.** Evidence of considered design decisions; non-trivial pitfalls are addressed.
- **5 — excellent or surprising care.** Multiple non-obvious decisions made well; would survive a senior code review with minor comments only.

### Dimensions

1. **Correctness.** Does the app start with the documented command? Does the happy path (shorten → visit short link → redirect → see click count increment) work end-to-end? Are explicit asks from the prompt — shortening, redirect, dashboard, persistence, single-command run, tests — present and functional?
2. **Architecture & module boundaries.** Is the code organized into modules with clear responsibilities? Is the data model sensible (what columns? indexes? foreign keys if any?)? Are routes, persistence, and rendering separated?
3. **Code hygiene.** Naming (do identifiers carry meaning?), function size, dead code, magic numbers, duplication, type safety where the language supports it.
4. **Error handling & input validation.** What happens when the input URL is malformed, empty, gigantic, or contains control characters? What happens when a short slug doesn't exist? Are errors surfaced in a way the frontend can display, or do they crash silently / 500?
5. **Security.** This task has known minefields (see *Task-specific danger zones* below). Score against what was actually addressed.
6. **Tests.** Are there tests at all? Do they cover the dangerous paths (redirect, validation, counter increment) or only the trivial paths (does the route return 200)? Do they actually run?
7. **Documentation.** Is there a README that lets a fresh developer run the app? Are comments present where the *why* is non-obvious, and absent where the code already speaks for itself?
8. **Completeness vs reasonable interpretation.** What would a charitable reader of `PROMPT.md` expect to see? Did the arm deliver that? This dimension is where you penalize gold-plating *and* omissions.

## Task-specific danger zones (look for these explicitly)

These are the failure modes a thoughtful developer would think about for a URL shortener. Note for each arm whether it was **addressed**, **partially addressed**, or **missed**, with a code citation.

- **Open redirect / unsafe input URL.** Does the app accept `javascript:`, `data:`, `file:` schemes? Does it accept URLs pointing at internal IPs (`127.0.0.1`, `169.254.169.254`, `localhost`, RFC1918 ranges)? Does it accept URLs without a scheme at all? An accepting impl with no validation is a 1 on Security regardless of what else is right.
- **Counter increment race.** When two requests hit the same short link concurrently, is the click counter incremented atomically (single `UPDATE … SET clicks = clicks + 1` or transaction) or read-then-write (read count, increment in JS, write back — lossy under concurrency)?
- **Redirect status code.** Did they use `301` (permanent, browser-cached forever, breaks click stats after the first hit) or `302`/`307` (temporary, every visit hits the server)? Comment quality on this choice matters.
- **Slug strategy and collision handling.** Random base62? Sequential ID encoded as base62? Hash of the URL? Is collision handled (retry, error) or does the second insert silently fail / throw 500?
- **Slug format validation on lookup.** Does the redirect route validate the slug shape before hitting the DB, or does it pass arbitrary path segments straight to a query parameter?
- **SQL parameterization.** Are queries parameterized everywhere, or is there string concatenation anywhere user input touches?
- **Unbounded input length.** Can a user submit a 10MB URL? Is there a length cap?
- **Dashboard authorization.** The prompt explicitly says no auth. Did the arm respect that, or did it bolt on something half-baked? Either is a valid choice — penalize only if the implementation is incoherent (e.g. claims to enforce auth but doesn't).

## Trace-grounded analysis (per arm)

Read the JSONL trace(s) for each arm and produce, **for each arm**, a section titled `### Mid-flight observations`. Surface 3-to-5 specific moments visible in `steps[].reasoning` / `reasoningDetails[].text` where:

- A non-obvious design decision was made (good or bad), with a quote and the iteration index.
- A defect was caught and patched mid-flight (cite the iter/step where the catch happened, and the iter/step where the patch landed).
- A defect was *visible in the reasoning* but never patched (the agent thought about it, then moved on).
- A tool call failed and the agent recovered (or didn't).

For the pair specifically, also note: did the two agents disagree at any point? Did one push back on the other's choice? Did they converge or diverge? Quote the specific message exchange.

## Catch-credit tally

A two-column table:

| Caught by pair, missed by single | Caught by single, missed by pair |
|---|---|
| <one bullet per item, with code citations from both arms showing the asymmetry> | <same> |

This is the headline result of the review. If both columns are empty, the pair pattern produced no observable advantage on this task. If only the left column has entries, that's signal for the H2 thesis. If both columns have entries, the pattern is mixed and the verdict explains the trade.

## Final verdict

A section titled `## Verdict — least bad`, ≤300 words. State which arm is less bad and why. Reference the catch-credit table and the dimension scores. If the answer is "they're equivalently bad," say so and explain what would have to be true in the artifacts to break the tie.

Then a one-line **routing recommendation**: *"For tasks resembling this prompt shape and complexity, route to {pair | single | either}, because {one sentence}."* This is the practical takeaway the experiment exists to produce.

## Output location

Write the review to `REVIEW.md` in this directory (sibling of `RUBRIC.md`).
