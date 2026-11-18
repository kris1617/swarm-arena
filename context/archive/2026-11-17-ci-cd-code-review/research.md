---
research_for: ci-cd-code-review
created: 2026-11-17
repo_root: /home/kris/10xdevs
head: 3caa729
branch: master
dirty: tools/ai-reviewer/ (untracked — M5L2 reviewer, not yet committed)
---

# Research: wiring `tools/ai-reviewer` into GitHub Actions

## Question

How should the already-built, already-verified local reviewer at
`tools/ai-reviewer/` (Claude Agent SDK, M5L2) be wired into a GitHub Actions
workflow for swarm-arena specifically — given this repo's existing `.github/`
state, its GitHub CLI/token posture, and the course's generic
`m5l3-review.yml.template` / `m5l3-action.yml.template`, which assume an
OpenRouter-flavored reviewer, not Claude Agent SDK?

## Existing `.github/` state

- `.github/workflows/deploy.yml` is the only existing workflow (confirmed via
  `ls .github/workflows/`). It triggers on `push: branches: [master]` only —
  **no PR trigger exists today**, so the new review workflow is purely
  additive, not a modification of existing CI.
- `deploy.yml` uses movable version tags for third-party actions
  (`actions/checkout@v4`, `actions/setup-node@v4`), not SHA pins, and
  `node-version: "22"` hardcoded (no `.nvmrc` in the repo root — confirmed:
  `.nvmrc` does not exist at repo root).
- `deploy.yml`'s `test` job already runs `npm ci`, `npm run build`,
  `npm run typecheck`, `npm run check`, `npm run db:migrate`, `npm test` with
  a fixed set of dummy env vars (`SKIP_ENV_VALIDATION=1`,
  `DATABASE_URL=file:./db.sqlite`, etc.) — this is the app's own CI, unrelated
  to and unaffected by the new review workflow, which only needs to read a
  diff, not build or test the Next.js app itself.

## GitHub CLI / token posture (this repo specifically)

- Repo is **private** (`gh repo view`: `"visibility":"PRIVATE"`).
- Org/repo **default workflow permissions are `read`**
  (`gh api repos/kris1617/swarm-arena/actions/permissions/workflow` →
  `{"default_workflow_permissions":"read","can_approve_pull_request_reviews":false}`).
  This means the new workflow's job **must** declare an explicit `permissions:`
  block (`pull-requests: write`, `issues: write` for labels) — GitHub Actions
  lets a workflow-level or job-level `permissions:` block override the repo
  default, so this is not a blocker, just a required explicit step the course
  template already includes.
- **Branch protection is unavailable on this repo today**: `gh api
  repos/.../branches/master/protection` returns
  `403 "Upgrade to GitHub Pro or make this repository public to enable this
  feature."` This means the review job's `exit 1` on a `fail` verdict will
  show as a red X on the PR and in the Checks tab, but **cannot currently be
  configured as a required status check that blocks the literal merge
  button** — GitHub's "required status checks" feature is gated behind
  Pro/public-repo branch protection, which this private repo doesn't have.
  The gate is real (CI goes red, the job fails) but not yet a hard merge
  block at the GitHub UI level. This is a platform constraint, not something
  the workflow YAML can work around — noted for `/10x-plan` as a known
  limitation to state rather than silently assume away.
- Existing repo labels (`gh label list`) are generic defaults (`bug`,
  `documentation`, `enhancement`, etc.) — `ai-cr:passed` / `ai-cr:failed` /
  `ai-cr:review` do not exist yet and must be created. The course template's
  `gh label create ... --force` step (idempotent, safe to run every time)
  handles this correctly without a separate setup step.
- `gh auth status` confirms the authenticated account (`kris1617`) during
  local verification; in CI, `GITHUB_TOKEN` is auto-provisioned per run and
  does not need `gh auth login` — confirmed as the course template's own
  assumption (`GH_TOKEN: ${{ github.token }}`).

## Diff computation

- No prior PR-triggered workflow exists to copy from. The course's
  `m5l3-review.yml.template` computes the diff with
  `git diff "origin/$BASE_REF...HEAD" > "$RUNNER_TEMP/pr.diff"` after a
  `fetch-depth: 0` checkout — this is a sound, standard pattern (shallow
  checkout has no base-branch history to diff against, confirmed by the
  lesson text and consistent with how `deploy.yml`'s existing checkout does
  NOT need `fetch-depth: 0` since it never diffs).
- Writing the diff to a file (`$RUNNER_TEMP/pr.diff`) rather than a step
  output avoids the multi-line / size limits of `GITHUB_OUTPUT` that the
  M5L2 lesson text calls out explicitly (`echo "value<<__DIFF__"` marker
  trick) — the template's file-based approach is simpler and was already
  adopted as the default in `m5l3-review.yml.template`, so no adaptation
  needed here.

## Adapting the templates for Claude Agent SDK (not generic OpenRouter)

Both `m5l3-review.yml.template` and `m5l3-action.yml.template` are written
generically enough that they do not assume a specific provider by variable
semantics — the actual provider-specific surface is narrow:

1. **Secret name**: template uses `secrets.LLM_PROVIDER_API_KEY` (generic).
   For Claude Agent SDK this must become `secrets.ANTHROPIC_API_KEY`, matching
   `tools/ai-reviewer/src/review.ts`, which reads `ANTHROPIC_API_KEY` via the
   SDK's own default credential resolution (no explicit key-reading code in
   `review.ts` — the SDK itself looks for `ANTHROPIC_API_KEY` in the
   environment when no session is active, confirmed via the M5L2 lesson's own
   "Start bez klucza" section, which states the key must be explicit once
   local Claude Code credentials aren't available, i.e. always in CI).

2. **`action.yml`'s expected entry point**: the template expects a *built*
   `dist/review.js` (`node "$GITHUB_ACTION_PATH/dist/review.js"`). Our
   `tools/ai-reviewer` has no build step configured (`tsx` runs TypeScript
   directly, per M5L2's own local-dev pattern of `npx tsx review.ts`). Two
   options: (a) add a `tsc` build step to the composite action before running
   `node dist/review.js`, or (b) run via `npx tsx src/review.ts` directly
   inside the composite action, skipping the build step entirely. **(b) is
   simpler and consistent with how the local M5L2 verification already runs**
   (`npm run review` → `tsx src/review.ts`); it needs `npm ci` inside
   `tools/ai-reviewer/` as a composite-action step before invoking the
   reviewer, which the template does not currently have (it assumes a
   prebuilt `dist/`). This is a deviation from the raw template that
   `/10x-plan` should make explicit rather than silently build-step it in.

3. **`review.ts`'s existing env contract already matches the template's
   consumer-side wiring without changes**: `review.ts` reads `DIFF_FILE`,
   `PR_TITLE`, `PR_BODY`, and `REVIEW_MODEL` from `process.env` (confirmed by
   reading `tools/ai-reviewer/src/review.ts` directly) — these are exactly
   the env var names the course's `action.yml` template sets
   (`DIFF_FILE`, `PR_TITLE`, `PR_BODY`, `REVIEW_MODEL`), so no field-name
   adaptation is needed there; only the API-key env var name
   (`LLM_PROVIDER_API_KEY` → the SDK's own expected `ANTHROPIC_API_KEY`) needs
   to change in the composite action's `env:` block.

4. **Default model**: template defaults `model` input to
   `z-ai/glm-5.3` (an OpenRouter model id). Must become `claude-sonnet-5-5`
   to match `tools/ai-reviewer`'s own local default (confirmed in
   `review.ts`: `process.env.REVIEW_MODEL ?? "claude-sonnet-5-5"`), per
   `requirements.md`'s explicit decision to keep CI and local verification on
   the same model until a promptfoo comparison (parked) justifies changing it.

5. **Node version for the composite action's `setup-node` step**: template
   pins `node-version: 24`. `tools/ai-reviewer/package.json` has no `engines`
   field, and local verification ran under the already-installed Node v22.
   `deploy.yml` also uses Node 22. For consistency with the rest of this
   repo's CI (not a hard technical requirement — the SDK/zod versions in use
   don't require Node 24), **Node 22 is the better default here**, matching
   `deploy.yml`'s existing convention rather than introducing a second Node
   version into the repo's CI surface.

## Composite action location

- Confirmed via the lesson text and the template's own header comment: a
  **local** composite action under `.github/actions/<name>/` is the
  recommended starting point over a separate marketplace repository — this
  matches the "don't start with multi-repo" guidance and this repo currently
  has exactly one consumer (itself).

## Security posture for the new workflow

- The course lesson is explicit that third-party actions touching secrets
  should be pinned to a commit SHA, not a movable tag — `deploy.yml`'s own
  existing `actions/checkout@v4` / `actions/setup-node@v4` do NOT follow this
  (they use movable tags), which is a pre-existing, unrelated inconsistency
  in this repo's CI, not something this change should silently fix (out of
  scope — `deploy.yml` isn't part of this change). The **new** review
  workflow handles secrets (`ANTHROPIC_API_KEY`) and untrusted PR content
  (diff, title, body — all attacker-influenced input from a PR author), which
  is exactly the risk profile the lesson's SHA-pinning advice targets. SHA
  pins for `actions/checkout` and `actions/setup-node` in the *new* workflow
  specifically are recommended by the lesson text and are a reasonable,
  explicit deviation from this repo's existing (looser) convention, to be
  decided explicitly in `/10x-plan` rather than silently matched to
  `deploy.yml`'s weaker precedent.

## Gaps / unresolved for `/10x-plan`

- Branch-protection-gated "required status check" cannot be configured on
  this private repo without upgrading to GitHub Pro or making the repo
  public — the plan should state this as a known limitation (the gate fails
  CI visibly; it does not yet block the merge button) rather than claim full
  enforcement.
- The composite action's exact invocation of `npm ci` scoped to
  `tools/ai-reviewer/` (via `working-directory:` in the step, since
  `action.yml`'s own `run:` steps execute relative to `$GITHUB_ACTION_PATH`
  by default for a *local* composite action, not the repo root) needs to be
  verified empirically once the workflow file exists — not independently
  confirmed in this research pass beyond reading GitHub's own composite
  action docs structure; flagged as a plan-time implementation detail, not a
  blocked question.
