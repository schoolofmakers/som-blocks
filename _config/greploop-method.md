# The Greploop + Minimal-PR Execution Method

The discipline every code-bearing project hands off to after kickoff. This is the *execution* layer — how code actually gets built and merged. Copy this file into a project's `_config/` so the work follows it by default.

## Prime directive
Ship features as a **chain of minimal PRs**. No PR is done until **Greptile gives it a 5/5 confidence score with zero unresolved comments**, reached via the `/greploop` skill. Speed comes from structure, not from large diffs.

## Non-negotiables
1. **Plan before code.** For anything non-trivial, produce an approved plan that slices the work into minimal PRs before editing.
2. **One logical unit per PR** — a contract/schema, one panel, one component set. Never the whole feature at once.
3. **Tests live in the same PR as the code they cover.** Write/adjust them, run them green, *before* invoking review.
4. **Every PR targets `staging`, never `main`.**
5. **5/5 or it isn't done.** Mergeable only after `/greploop` reports 5/5 + zero unresolved comments.
6. **Don't break adjacent behavior.** Explore existing patterns before adding new ones.
7. **Surface, don't hide.** If you skip a check, cap scope, or can't auto-fix a comment, say so.

## The loop, per minimal PR
```bash
git checkout staging && git pull
git checkout -b feature/<slice>
# implement ONLY this slice + its tests; run tests until green
git add -A && git commit -m "<scoped message>"
git push -u origin feature/<slice>
gh pr create --base staging --fill
/greploop            # review → fix → push → re-review, stops at 5/5 (max 5 iterations)
# if 5/5: 
gh pr merge --squash --delete-branch
# if not 5/5: read remaining comments, fix or SPLIT, then /greploop again
```

## What `/greploop` does
Triggers a Greptile review, parses the `x/5` score and unresolved comments, fixes the actionable ones, pushes `address greptile review feedback (greploop iteration N)` commits, and re-reviews — up to **5 iterations**. It runs entirely through the `gh` CLI + the Greptile GitHub app; it needs no API key.

## Guardrails — when it won't hit 5/5
| Symptom | Means | Do |
|---|---|---|
| Many comments, stuck below 5/5 | PR too big | Split into smaller PRs. Never brute-force-loop a bloated PR. |
| A comment isn't auto-fixable | Design/opinion call | Resolve with human judgment; ask the user if the call is theirs. |
| Score oscillates | Fixes add new issues | Stop, read the diff yourself, fix deliberately, re-run once. |
| No score ever posts | Repo not indexed / app off / not a real PR | Stop and flag — a setup problem, not something to retry. |

**Splitting is always the correct escape hatch. Never merge a sub-5/5 PR to make progress.**

## Anti-patterns
Coding before an approved plan · bundling concerns into one PR · opening a PR with no/failing tests · merging at 3–4/5 · targeting `main` · fake-resolving threads · claiming done without an end-to-end test in the real app.

## TL;DR
> Plan → approve → branch off `staging` → one minimal slice + tests → PR → `/greploop` to 5/5 → squash-merge → next slice → end-to-end test. Below 5/5? Split the PR.
