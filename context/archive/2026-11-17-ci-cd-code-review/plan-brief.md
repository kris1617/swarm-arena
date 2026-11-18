# AI Code Review Pipeline — Plan Brief

> Full plan: `context/changes/ci-cd-code-review/plan.md`
> Research: `context/changes/ci-cd-code-review/research.md`

## What & Why

Wire the already-built Claude Agent SDK code-review agent
(`tools/ai-reviewer/`, M5L2) into GitHub Actions so every pull request to
`master` gets an automated, structured review: six scored criteria, a
binding pass/fail verdict, a PR comment, and `ai-cr:passed`/`ai-cr:failed`
labels (M5L3). This is the practical project for the **10xChampion**
certification badge (Track A).

## Starting Point

`tools/ai-reviewer/` already exists, is independent of the Next.js app's
dependencies, and was verified locally this session against two fixtures
(a seeded SQL-injection diff correctly flagged `fail`; a clean diff
correctly flagged for a real missing-authorization risk). The repo's only
existing workflow (`deploy.yml`) triggers on push to `master`, not PRs —
this is purely additive CI.

## Desired End State

Opening a PR triggers a `review` job: it computes the diff, runs the
agent, comments the verdict + summary, labels the PR, and fails the job on
`fail`. Pushing a fix or adding the `ai-cr:review` label re-runs it.

## Key Decisions Made

| Decision | Choice | Why | Source |
|---|---|---|---|
| SDK | Claude Agent SDK | Lowest local setup; matches this session's own tooling | User (pre-plan) |
| Model (CI) | `claude-sonnet-5-5` | Same as local verification — no cost/quality divergence until a promptfoo comparison justifies one | Requirements |
| Diff computation | `git diff origin/$BASE...HEAD` to a file | Avoids `GITHUB_OUTPUT` multi-line limits | Research |
| Composite action location | Local, `.github/actions/ai-reviewer/` | Single-repo consumer today; easy to extract later | Research |
| Build step | None — run via `tsx` directly | Matches local M5L2 verification command; avoids adding a `dist/` build phase | Research |
| Node version (new CI) | 22 | Matches `deploy.yml`'s existing convention | Research |
| Action pinning (new workflow only) | Commit SHA | Handles a secret + untrusted PR input — course's own stated security guidance | Research |
| Branch protection / required check | Not configured | Unavailable on this private, non-Pro repo (confirmed via API) | Research |
| promptfoo multi-model eval (M5L3 task 3) | Parked, separate change | Needs its own `OPENROUTER_API_KEY` decision | Requirements |

## Scope

**In scope:** composite action wrapping the existing reviewer; PR-triggered
workflow with diff computation, comment, labels, retry-on-label, and a
fail-the-job gate.

**Out of scope:** branch protection / required checks (platform-unavailable
here), promptfoo evals, additional agent tools (plan-reading, direct
PR-posting from inside the agent), any change to `deploy.yml`.

## Architecture / Approach

```
PR event ──► review.yml ──► compute diff ──► .github/actions/ai-reviewer
                                                 │ (npm ci + tsx src/review.ts)
                                                 ▼
                                        Claude Agent SDK (claude-sonnet-5-5)
                                                 │
                                                 ▼
                                   verdict + summary (JSON, zod-validated)
                                                 │
                              ┌──────────────────┴──────────────────┐
                              ▼                                     ▼
                      PR comment + label                      job exit code
```

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Reviewer + composite action | `tools/ai-reviewer` committed; `.github/actions/ai-reviewer` wraps it | The action's working-directory wiring (`$GITHUB_ACTION_PATH`) is only provisionally verified until Phase 2 actually runs it on a real runner |
| 2. Consumer workflow | `.github/workflows/review.yml` — trigger, diff, comment, label, gate | Needs `ANTHROPIC_API_KEY` added as a repo secret before the first real run; branch protection can't yet turn the gate into a hard merge block |

**Prerequisites:** `ANTHROPIC_API_KEY` repository secret (user must add it
— this plan cannot).
**Estimated effort:** ~1 session across 2 phases; both are small, additive
file changes with no app-code impact.

## Open Risks & Assumptions

- The composite action's `cd`-into-`tools/ai-reviewer`-under-`$GITHUB_ACTION_PATH` wiring is based on GitHub's documented composite-action execution model, not independently reproduced on a runner before Phase 2's real test PR — flagged as provisional in the plan.
- Without GitHub Pro or a public repo, the `fail` verdict cannot block the merge button, only fail the Checks tab visibly — acceptable for badge evidence, but a real limitation to know about.

## Success Criteria (Summary)

- A real test PR shows the `review` job running, its logs showing the computed diff and the agent's JSON verdict, a PR comment with the summary, and the correct `ai-cr:*` label — these three are the exact 10xChampion badge evidence categories (pipeline view with ≥1 job, job logs, LLM PR comment).
- Pushing a fix or adding `ai-cr:review` re-triggers the review.
