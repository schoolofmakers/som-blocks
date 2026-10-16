# Agentic practices — how agents build in this repo

These wrap around the greploop discipline (`greploop-method.md`). Greploop owns branching/review/merge; these own how the work inside each PR gets done.

## 1. Proof before "done"
Every PR and every completion claim ships evidence, produced before the claim:
- Tests actually run, real output shown (pass/fail counts) — in the PR description.
- UI changes: screenshot(s); light + dark mode if both exist.
- API/server changes: a real request against the running dev server.
- Schema/data changes: a query showing before/after.
- A skipped verification is stated by name, never silent.
Agent-run tests do not replace CI or code review — the merge gate stays independent of whoever did the work.

## 2. Brief like a senior engineer
An implementer agent only knows the repo plus its prompt. Every implementation brief contains:
- **Reference**: the existing file/pattern that sets the standard ("do it like `src/...`").
- **Standard**: the applicable `_config` rules.
- **Riff**: an opinionated sketch of the intended behavior, like a Slack message to a senior colleague.
- For non-trivial work: research (repo + corpus, §6) → written plan → implement, in that order.

## 3. Roles: orchestrator thinks, implementers type
- The main (frontier-model) session decomposes work, writes briefs, reviews, and makes architecture calls.
- Cheaper-tier subagents implement; they never make architecture decisions.
- Default to the cheaper tier; escalate to the frontier model for gnarly problems and final review only.

## 4. Variants for anything taste-based
UI layouts, copy, names, visual design: generate 5–10 meaningfully different variants in one pass, have a human pick. Never iterate a single version toward taste.

## 5. Screens must earn their existence
Before building any admin/internal screen, ask: will a human really click through this, or would they prompt an agent in the repo instead? Real UI is for users who won't prompt agents; internal tooling starts as an agent prompt until proven otherwise.

## 6. Corpus before code
A local corpus of real open-source repos lives at `~/.steroids` (Agent Steroids, `steroids --help`). It is the evidence for "how do people actually do this", alongside the repo itself.
- Before any non-trivial slice, run `steroids search` on its core mechanism (2–3 queries, `--tag <project>` first). Read three hits.
- Write the finding down: the common pattern, the reference you chose, where our constraints differ. That note goes in the plan and in the PR description as evidence.
- Adapt the pattern in our own code; cite the repo. Copied blocks stay out (licenses vary; AGPL/GPL and unlicensed are strict).
- Consensus is a candidate, not a standard — the orchestrator picks the one reference the brief points at.
- "Not covered" means a corpus gap, not a bad query: run `steroids discover`, propose repos with why they fit, add them once approved.
