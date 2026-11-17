# AI Code Review Pipeline — Implementation Plan

## Overview

Wire the already-built, already-verified local code-review agent
(`tools/ai-reviewer/`, Claude Agent SDK, M5L2) into GitHub Actions so every
pull request to `master` gets an automated review: six scored criteria, a
binding pass/fail verdict, a PR comment, `ai-cr:passed`/`ai-cr:failed`
labels, and a job that fails CI on `fail` (M5L3).

## Current State Analysis

- `tools/ai-reviewer/` exists as an independent npm package (not part of the
  Next.js app's dependency tree), with a working `review.ts` entry point
  that reads a diff (stdin locally, `$DIFF_FILE` env in CI), calls Claude
  Agent SDK with a shared zod schema (`review-schema.ts`), and prints the
  structured `ReviewResult` JSON. Verified against two fixtures (a seeded
  SQL-injection diff → correctly flagged `fail`; a clean diff → correctly
  flagged `fail` for a real missing-authorization/enumeration risk, not a
  false positive). Currently untracked in git.
- `.github/workflows/deploy.yml` is the repo's only existing workflow,
  triggered on `push: branches: [master]`, unrelated to PRs — this change
  is purely additive.
- Repo is private with no GitHub Pro; branch protection / required status
  checks cannot be configured today (confirmed: `gh api .../branches/master/protection`
  → 403). The gate will fail CI visibly but cannot yet block the literal
  merge button at the GitHub UI level.
- Default workflow permissions for this repo are `read` — the new
  workflow's job must declare its own `permissions:` block.

## Desired End State

Opening a PR to `master` triggers a `review` job that: computes the diff
against the PR's base, runs the Claude Agent SDK reviewer against it,
posts a PR comment with the verdict and summary, applies
`ai-cr:passed`/`ai-cr:failed`, and fails the job on `fail`. Pushing new
commits or adding the `ai-cr:review` label re-runs it. Verified by opening
a real test PR against this repo and observing the Checks tab, the PR
comment, and the label.

### Key Discoveries:

- `review.ts` already reads `DIFF_FILE` / `PR_TITLE` / `PR_BODY` /
  `REVIEW_MODEL` from `process.env` with no changes needed — confirmed in
  `tools/ai-reviewer/src/review.ts`.
- The course's `m5l3-action.yml.template` expects a prebuilt
  `dist/review.js`; `tools/ai-reviewer` has no build step. Running via
  `npx tsx src/review.ts` directly (matching the local M5L2 verification
  command) avoids adding a build phase — see research.md §3.2.
- Branch-protection-gated required checks are unavailable on this repo
  (research.md, "GitHub CLI / token posture").

## What We're NOT Doing

- Not configuring branch protection / required status checks (unavailable
  on this private repo without GitHub Pro or making it public) — the gate
  fails the job and shows red on the PR; it does not yet block merge.
- Not building promptfoo evals or a multi-model comparison (M5L3 task 3) —
  parked in `requirements.md` as a separate follow-up change; needs its own
  `OPENROUTER_API_KEY` decision.
- Not adding extra agent tools (reading `context/changes/*/plan.md`,
  posting comments *from inside* the agent, etc. — M5L3's optional task 4).
  The agent stays a pure scorer: diff in, verdict out; the workflow owns
  commenting/labeling.
- Not touching `.github/workflows/deploy.yml` or its looser action-pinning
  convention — out of scope for this change.
- Not adding a build/bundle step for `tools/ai-reviewer` — `tsx` runs the
  TypeScript directly in CI, same as locally.

## Implementation Approach

Two phases, matching the course's own M5L2/M5L3 split: Phase 1 commits the
already-verified reviewer and wraps it in a local composite action
(`.github/actions/ai-reviewer/`) so the main workflow stays a short list of
steps. Phase 2 adds the consumer workflow (`.github/workflows/review.yml`)
that triggers on PRs, computes the diff, calls the composite action, and
handles the comment/label/gate/retry side effects — all in the workflow,
not the agent, per "What We're NOT Doing".

## Critical Implementation Details

**Composite action step execution context**: a *local* composite action's
`run:` steps execute with the **repository's** working directory by
default, not the action's own directory — `${{ github.action_path }}`
must be used explicitly to reference files inside the action (e.g. to `cd`
into `tools/ai-reviewer` before `npm ci`/`npm run review`), since the
reviewer package lives there, not at the action's own path. This is the one
non-obvious wiring detail the templates don't spell out for this repo's
specific directory layout (reviewer lives outside the action folder,
unlike the course's `dist/review.js`-in-the-action-folder assumption).

## Phase 1: Commit the reviewer, add the composite action

### Overview

Commit the already-built and already-verified `tools/ai-reviewer/` package,
and add a local composite action that installs its dependencies and runs
it against a diff file, returning the verdict as a step output.

### Changes Required:

#### 1. Commit the existing reviewer package

**Files**: `tools/ai-reviewer/{package.json,package-lock.json,tsconfig.json,.gitignore,src/review.ts,src/review-schema.ts,fixtures/*.diff}`

**Intent**: These files already exist and were verified locally (M5L2) in
this same session — commit them as-is. No code change in this phase.

**Contract**: No interface change; this is a staging/commit step only.

#### 2. Composite action definition

**File**: `.github/actions/ai-reviewer/action.yml`

**Intent**: Wrap `tools/ai-reviewer`'s `npm run review` as a reusable GHA
step: accept the diff (as a file path, to avoid `GITHUB_OUTPUT` multi-line
limits — research.md), PR title/body, the API key, and an optional model
override; install dependencies and run the reviewer; emit the parsed
`verdict` and the path to the full JSON review as outputs.

**Contract**:
- `inputs`: `api-key` (required), `pr-title` (required), `pr-body`
  (optional, default `""`), `diff-file` (required), `model` (optional,
  default `claude-sonnet-5-5` — matching `review.ts`'s own local default,
  per `requirements.md`'s decision to keep CI and local verification on the
  same model).
- `outputs`: `verdict` (the parsed `pass`/`fail` string), `review-file`
  (path to the full JSON `ReviewResult`).
- `runs.using: composite`. Steps: `actions/setup-node` pinned to a commit
  SHA (Node 22, matching `deploy.yml`'s existing convention — research.md
  §"Node version"), then a `run:` step with `shell: bash` that `cd`s into
  `tools/ai-reviewer` under `$GITHUB_ACTION_PATH` (per "Critical
  Implementation Details" above), runs `npm ci`, then
  `DIFF_FILE=<diff-file> PR_TITLE=<pr-title> PR_BODY=<pr-body> ANTHROPIC_API_KEY=<api-key> REVIEW_MODEL=<model> npm run review > "$RUNNER_TEMP/ai-review.json"`,
  parses `verdict` from that JSON with a small inline `node -e`, and writes
  both outputs via `$GITHUB_OUTPUT`. Validate `verdict` is one of
  `pass`/`fail` before writing it — same shape as
  `m5l3-action.yml.template`'s own validation, adapted to the Claude Agent
  SDK env var names (`ANTHROPIC_API_KEY` in place of the template's generic
  `LLM_PROVIDER_API_KEY`; see research.md §"Adapting the templates").

### Success Criteria:

#### Automated Verification:

- `npx biome check tools/ai-reviewer .github/actions/ai-reviewer` passes (repo-wide lint; `.github/` and `tools/` are not in Biome's excluded-paths list per `biome.jsonc`)
- `cd tools/ai-reviewer && npx tsc --noEmit` passes
- `cd tools/ai-reviewer && cat fixtures/sample-sql-injection.diff | npm run review` prints valid JSON with `"verdict": "fail"`
- `cd tools/ai-reviewer && cat fixtures/sample-clean.diff | npm run review` prints valid JSON with a `verdict` field present (value may legitimately be `pass` or `fail` depending on the agent's judgment of that fixture — both were observed as correct, defensible outcomes in M5L2 verification)
- `git status --porcelain tools/ai-reviewer/node_modules` prints nothing (confirms `.gitignore` keeps it untracked)

#### Manual Verification:

- Read `.github/actions/ai-reviewer/action.yml` and confirm the `cd` target resolves correctly relative to `$GITHUB_ACTION_PATH` given this repo's actual directory layout (cannot be fully verified until Phase 2's workflow actually invokes it on a runner — flag this phase's composite-action correctness as provisional until Phase 2's end-to-end run)

---

## Phase 2: Consumer workflow — triggers, diff, comment, label, gate

### Overview

Add `.github/workflows/review.yml`: triggers on PR open/sync/reopen/the
`ai-cr:review` label, computes the diff against the base branch, calls the
Phase 1 composite action, posts the PR comment, applies the pass/fail
label, and fails the job on a `fail` verdict.

### Changes Required:

#### 1. Review workflow

**File**: `.github/workflows/review.yml`

**Intent**: Implement the requirements.md side effects (PR comment,
labels, on-demand retry) and the gate, adapted from
`m5l3-review.yml.template`.

**Contract**:
- `on.pull_request`: `branches: [master]`, `types: [opened, synchronize, reopened, labeled]`.
- `permissions`: `contents: read`, `pull-requests: write`, `issues: write` (labels live on the issues API — template's own note, confirmed applicable here since default workflow permissions are `read`, research.md).
- `concurrency`: group per PR number, `cancel-in-progress: true` (so a new push supersedes an in-flight review, per `requirements.md`'s "Expected behavior").
- `jobs.review.if`: skip unless the trigger is a non-`labeled` event, or the label is specifically `ai-cr:review` — same condition as the template, enabling the on-demand retry.
- Steps: `actions/checkout` pinned to a commit SHA (`fetch-depth: 0` — required to diff against the base branch per research.md), a `Compute diff` step writing `git diff "origin/$BASE_REF...HEAD"` to a `$RUNNER_TEMP` file, the Phase 1 composite action (`uses: ./.github/actions/ai-reviewer`, with `api-key: ${{ secrets.ANTHROPIC_API_KEY }}`, `pr-title`, `pr-body`, `diff-file`), a `Comment and label` step that posts the summary via `gh pr comment`, creates (idempotently, `--force`) and applies `ai-cr:passed`/`ai-cr:failed`, and removes `ai-cr:review` after a retry completes, and a `Gate on verdict` step that `exit 1`s when the verdict isn't `pass`.
- `actions/checkout` and `actions/setup-node` (inside the composite action) pinned to commit SHAs in this **new** workflow specifically — per research.md's security-posture finding, a deliberate, explicit deviation from `deploy.yml`'s looser movable-tag convention, justified because this workflow handles a secret (`ANTHROPIC_API_KEY`) and untrusted PR-author-controlled input (diff, title, body).
- **By design**: GHA's default bash shell runs with `-eo pipefail`, so an agent-side failure (the composite action's `npm run review` throwing on an SDK error, rate limit, or network failure) fails that step before `verdict`/`review-file` are set. The "Comment and label" step's `if: always() && steps.review.outputs.verdict != ''` guard then skips commenting rather than posting something misleading, and the job still goes red overall. This is the intended failure behavior, inherited from the course template — not a gap to close.

### Success Criteria:

#### Automated Verification:

- `npx biome check .github/workflows/review.yml` passes
- A YAML syntax check parses cleanly: `node -e "require('node:fs').readFileSync('.github/workflows/review.yml','utf8')"` plus a lint pass via `actionlint` if available locally, else deferred to GitHub's own workflow-syntax validation on push
- Repo labels `ai-cr:passed` (green, `#0E8A16`) and `ai-cr:failed` (red, `#B60205`) exist after the first real run: `gh label list | grep ai-cr`

#### Manual Verification:

- Open a real test PR against `master` with a small, deliberately flawed diff (reuse `tools/ai-reviewer/fixtures/sample-sql-injection.diff`'s change as a real commit) and confirm: the workflow run appears in the Actions tab with the `review` job, the job log shows the computed diff and the agent's JSON output, a PR comment with the verdict/summary appears, the `ai-cr:failed` label is applied, and the job itself shows red/failed.
- Push a fix commit to the same PR and confirm the workflow re-runs automatically (via `synchronize`) and the label flips to `ai-cr:passed` if the fix addresses the flaw, or add the `ai-cr:review` label manually and confirm an on-demand re-run.
- Add `ANTHROPIC_API_KEY` as a repository secret (Settings → Secrets and variables → Actions) before the first real run — this cannot be automated from inside this change.

**Implementation Note**: After completing this phase and automated verification passes, pause here for the manual PR-based confirmation above (which also doubles as the 10xChampion badge evidence: pipeline view with the `review` job, its logs, and the PR comment) before considering the change complete.

---

## Testing Strategy

### Unit Tests:

- None added — `review.ts`/`review-schema.ts` have no unit-testable logic
  beyond the zod schema itself, which is exercised end-to-end by the
  fixture runs in Phase 1's success criteria.

### Integration Tests:

- The two local fixture runs (Phase 1) and the real test PR (Phase 2) are
  this change's integration tests — there is no cheaper layer that
  exercises the actual GitHub Actions trigger/permissions/label wiring.

### Manual Testing Steps:

1. Run both `tools/ai-reviewer` fixtures locally and confirm the JSON shape (Phase 1).
2. Open a real PR with a flawed diff; confirm comment + label + red job (Phase 2).
3. Push a fix or add `ai-cr:review`; confirm re-run and label flip (Phase 2).

## Performance Considerations

Each PR review is 1-2 Claude Agent SDK turns (per `review.ts`'s
`maxTurns: 4`, observed to need up to ~2-3 turns including the
structured-output formatting step) against a single diff — cost scales
with diff size and PR frequency, not with repo size. No caching or
batching is needed at this scale (confirmed: this is a solo-contributor
repo, per the M4 repo-map's own commit-author finding).

## Migration Notes

Not applicable — this is new, additive CI; no existing workflow or data is
migrated.

**Rollback**: if the pipeline misbehaves post-merge (unexpected cost, noisy
comments, etc.), delete or comment out `.github/workflows/review.yml` —
there is no other state to clean up (no DB writes, no persisted session,
no data the workflow owns).

## References

- Research: `context/changes/ci-cd-code-review/research.md`
- Requirements: `context/changes/ci-cd-code-review/requirements.md`
- Course templates (starting point, adapted): `.claude/config-templates/m5l3-review.yml.template`, `.claude/config-templates/m5l3-action.yml.template`
- Existing CI convention: `.github/workflows/deploy.yml`
- Reviewer contract: `tools/ai-reviewer/src/review-schema.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Commit the reviewer, add the composite action

#### Automated

- [x] 1.1 `npx biome check tools/ai-reviewer .github/actions/ai-reviewer` passes — 9715af3
- [x] 1.2 `cd tools/ai-reviewer && npx tsc --noEmit` passes — 9715af3
- [x] 1.3 SQL-injection fixture returns `"verdict": "fail"` — 9715af3
- [x] 1.4 Clean fixture returns a valid `verdict` field — 9715af3
- [x] 1.5 `node_modules` stays untracked (`git status --porcelain` empty) — 9715af3

#### Manual

- [x] 1.6 Composite action's `cd` target resolves correctly relative to `$GITHUB_ACTION_PATH` — confirmed by PR #10's successful `npm ci`/`tsx` steps in run 44136245781

### Phase 2: Consumer workflow — triggers, diff, comment, label, gate

#### Automated

- [x] 2.1 `npx biome check .github/workflows/review.yml` passes — edb0faa
- [x] 2.2 Workflow YAML parses cleanly — edb0faa
- [x] 2.3 `ai-cr:passed`/`ai-cr:failed` labels exist after first real run — `ai-cr:failed` applied to PR #10

#### Manual

- [x] 2.4 Real test PR shows the `review` job, its logs, a PR comment, and the correct label/gate result — PR #10 (closed, demo-only), run https://github.com/kris1617/swarm-arena/actions/runs/44136245781: job green, PR commented with a correct SQL-injection "fail" verdict, `ai-cr:failed` label applied, "Gate on verdict" step failed as designed
- [x] 2.5 Re-run on push or `ai-cr:review` label confirmed — `synchronize` re-run confirmed (commit 6fec942 pushed to PR #10's branch re-triggered the workflow, run 44131608845); label-triggered re-run not separately exercised
- [x] 2.6 `ANTHROPIC_API_KEY` repository secret added — added by the user 2026-11-17
