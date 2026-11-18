## Overall concept

- GHA workflow run for every new pull request to `master`
- composite action for the review itself so the main workflow stays easy to reason about
- reuses the existing local reviewer at `tools/ai-reviewer/` (Claude Agent SDK, M5L2) — the CI step does not reimplement review logic, only invokes `npm run review` with CI-specific input plumbing

## Input parameters

- pull request title
- pull request description (cost tradeoff: tokens scale with description length; include it since swarm-arena PRs are typically short)
- git diff (full diff against the PR's base branch)

## Code Review Criteria

Six criteria, each scored 1-10 (1 worst, 10 best) — already implemented in `tools/ai-reviewer/src/review-schema.ts`:

1. **implementation correctness** — does the code do what it claims, handling edge cases and error paths without regressions?
2. **idiomaticity** — does it follow this repo's TypeScript/Next.js/tRPC/Drizzle conventions (AGENTS.md)?
3. **complexity** — is it as simple as the problem allows?
4. **test / risk coverage** — are risky paths tested in proportion to their risk?
5. **documentation** — are non-obvious decisions explained?
6. **security and safety** — does it avoid vulnerabilities, secret leaks, unsafe handling of untrusted input?

## Verdict

- binding `verdict`: `pass` | `fail`, alongside the six scores and a Markdown `summary`
- contract: `tools/ai-reviewer/src/review-schema.ts` (`ReviewResult`)
- the merge gate reads only `verdict`

## Parked for later

- business alignment (requires broader context than a diff)
- architectural fit (requires broader context than a diff)
- promptfoo multi-model evals (M5L3 task 3) — separate follow-up change, needs its own API-key decision (OpenRouter) and is not required for this change's own gate to work

## Expected side-effects

- PR comment with the summary
- labels: `ai-cr:failed` (red) OR `ai-cr:passed` (green)

## Expected behavior

- on-demand retry when label `ai-cr:review` is added
- workflow uses `concurrency` so a new push cancels an in-flight review for the same PR

## Secrets

- `ANTHROPIC_API_KEY` — must be added as a repository secret (Settings → Secrets and variables → Actions) before this workflow can run. The implementation does not and cannot add this itself.

## Model

- `claude-sonnet-5-5` (matches `tools/ai-reviewer`'s local default) — CI should use the same model as local verification, not a cheaper substitute, until a promptfoo comparison (parked above) justifies a change.
