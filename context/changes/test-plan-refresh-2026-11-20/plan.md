# Visual-regression guard for critical/showcase screens — Implementation Plan

## Overview

Close `test-plan.md` Risk #11 (visual/layout regression caught only by
manual screenshot/DOM inspection — confirmed 3x this session, including a
real bug in `login-page-oauth-polish`) with a deterministic, CI-wired
Playwright screenshot baseline on 7 critical screens, plus a local-only,
non-blocking Claude-vision review script for judgment calls a pixel diff
can't make. This change folder is `test-plan.md` §3 rollout Phase 12 — it
both updates the strategy guide and implements the phase's actual work, the
same pattern `test-plan-refresh-2026-11-18` (Phase 11) used.

## Current State Analysis

- 6 kitchen-sink pages exist (`admin`, `leaderboard`, `dashboard`, `runs`,
  `reference`, `simulation`), all now console-error-smoke-tested
  (`kitchen-sink-smoke-coverage`) but with zero visual assertions.
- `playwright.config.ts` has one `chromium` project, `fullyParallel: true`,
  screenshots only `on-first-retry`/`on-failure`. No `toHaveScreenshot`
  usage anywhere in the repo yet.
- `.github/workflows/deploy.yml`'s `test` job runs `npm run build`
  (type-gen only), `npm run typecheck`, `npm run check`, `npm run
  db:migrate`, `npm test` (Vitest). **It never installs Playwright browsers
  or runs `npx playwright test`** — E2E is not wired into CI today at all,
  for any spec.
- `deploy` depends on `test` via `needs: test` — a failing step in `test`
  blocks the real VPS deploy.
- `tests/e2e/auth.setup.ts` creates a session via
  `src/app/api/test-auth/login/route.ts` using `E2E_USERNAME` +
  `E2E_TEST_AUTH_SECRET`; the route auto-creates the user row if the email
  doesn't exist (`route.ts:56-69`) — no fixture/seed required beyond those
  two env vars.
- The route's own comment (`route.ts:19-23`) currently reads: *"The deploy
  workflow's env (`.github/workflows/deploy.yml`, the VPS's own env file)
  must never define it."* This change narrows that wording — see Phase 1.
- `package.json` has no `@anthropic-ai/sdk` or any LLM client dependency.
  `src/env.js` has no `ANTHROPIC_API_KEY` entry.
- The 7 target screens (`/simulation`, and all 6 `*/kitchen-sink` pages) sit
  inside `tests/e2e/page-smoke-sweep.spec.ts`'s `"page smoke sweep — shared
  session"` describe block — all reachable with the default `storageState`,
  no admin fixture needed.

## Phase 1: Dependencies, env scaffolding, and strategy-guide update

### Changes Required:

**`package.json`**
- **Intent**: Add the Anthropic SDK for the local vision-review script (Phase 4).
- **Contract**: add `@anthropic-ai/sdk` to `dependencies`; add an
  `"visual:review": "tsx scripts/vision-review.ts"` entry to `scripts`
  (mirrors the existing `tsx scripts/perf-baseline-report.ts` pattern for
  `perf:baseline`).

**`src/env.js`**
- **Intent**: `ANTHROPIC_API_KEY` is only needed by the local vision-review
  script, never by the running app or CI — optional, server-only.
- **Contract**: add `ANTHROPIC_API_KEY: z.string().optional()` to the
  `server` schema and `ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY` to
  `runtimeEnv`, following this file's existing pattern for optional flags
  (e.g. `ALLOW_SELF_ELEVATION`).

**`.env.example`**
- **Intent**: Document the new variable per this repo's hard rule.
- **Contract**: add a commented section: `# Local vision-review script
  (scripts/vision-review.ts) only — never used by the running app or CI.` +
  `ANTHROPIC_API_KEY=""`.

**`src/app/api/test-auth/login/route.ts`**
- **Intent**: Phase 3 sets `E2E_TEST_AUTH_SECRET` as a step-scoped CI env
  var (ephemeral GitHub-hosted runner, never the `deploy` job or the VPS).
  The current comment's blanket wording ("the deploy workflow's env ... must
  never define it") would read as violated by that, even though the actual
  security property it protects (the bypass is never reachable on the real
  deployed app) still holds. Narrow the wording to name what actually
  matters.
- **Contract**: rewrite the warning sentence to: *"Never set this in the
  `deploy` job's env or the VPS's own env file — a step inside the `test`
  job, on an ephemeral CI runner that never serves real traffic, is a
  different boundary and is fine."* No behavior change — comment only.

**`context/foundation/test-plan.md`**
- **Intent**: Record Risk #11, its response guidance, Phase 12's row, the
  two new quality gates, and bump the freshness ledger — the refresh's own
  reason for existing.
- **Contract**:
  - §2 Risk Map: append row `| 11 | <Risk #11 text from change.md> | Medium
    | High | <Source from change.md> |` and its Risk Response Guidance row.
  - §3 Phased Rollout: append row `| 12 | Visual-regression guard for
    critical/showcase screens | Prove visual/layout correctness on 7
    critical screens without manual eyeballing | #11 | e2e (deterministic
    screenshot diff) + local vision-review script | implementing →
    complete (set at Phase 5) | context/changes/test-plan-refresh-2026-11-20/ |`.
  - §5 Quality Gates: change the "visual diff (deterministic)" row from
    `not wired, not planned` to `.github/workflows/deploy.yml` `test` job,
    `required` — catches: "pixel-level regression on the 7 tracked
    critical/showcase screens". Add a new row: "vision review (Claude,
    local-only)" — Where: `npm run visual:review`, manual/on-demand —
    Required?: informational, non-blocking — Catches: "visual-correctness
    judgment calls a pixel diff can't make (e.g. color/hue drift across
    many elements at once)".
  - §8 Freshness Ledger: bump "Strategy (§1–§5) last reviewed" to today's
    date with a one-line note.

### Success Criteria:

#### Automated Verification:
- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`
- `npm install` resolves `@anthropic-ai/sdk` with no peer-dependency errors

#### Manual Verification:
- `test-plan.md` §2/§3/§5/§8 edits read correctly against the change
  folder's accepted refresh brief
- `route.ts`'s rewritten comment still reads as a clear, correct security
  boundary (no change in actual behavior, wording only)

## Phase 2: Deterministic screenshot tests (local baseline)

### Changes Required:

**`tests/e2e/visual-regression.spec.ts`** (new file)
- **Intent**: One `toHaveScreenshot()` assertion per critical screen,
  reusing the default shared `storageState` (no new fixture) — proves
  Risk #11's "what would prove protection" line: a future token/spacing/
  width regression on a tracked screen is caught without a human
  eyeballing it.
- **Contract**: 7 tests, each: `page.goto(<route>)`, wait for the page's
  known `<h1>` heading to be visible (same readiness signal
  `page-smoke-sweep.spec.ts` already uses per route), then `await
  expect(page).toHaveScreenshot()` (full page, Playwright's default
  threshold — no custom `maxDiffPixelRatio`). Routes: `/simulation`,
  `/simulation/kitchen-sink`, `/dashboard/kitchen-sink`,
  `/leaderboard/kitchen-sink`, `/runs/kitchen-sink`, `/admin/kitchen-sink`,
  `/reference/kitchen-sink`.

**Baseline generation** (one-time, local, via Docker)
- **Intent**: CI's `ubuntu-latest` render is the only trustworthy source
  for pixel-exact comparison; generate baselines in the official Playwright
  Docker image to match that rendering, not a local OS/GPU combination that
  will drift.
- **Contract**: document and run (not committed as a script — a one-time
  command recorded in `test-stack.md`):
  `docker run --rm -v "$(pwd):/work" -w /work
  mcr.microsoft.com/playwright:v1.65.0-noble npx playwright test
  tests/e2e/visual-regression.spec.ts --update-snapshots` (image tag
  matches the `@playwright/test` version already pinned in `package.json`).
  Commit the generated `tests/e2e/visual-regression.spec.ts-snapshots/*.png`
  files — confirm `.gitignore` does not exclude them (it excludes
  `test-results/`/`playwright-report/` only, not Playwright's
  `*-snapshots/` convention).

### Success Criteria:

#### Automated Verification:
- New spec passes against its own freshly-generated baseline:
  `docker run --rm -v "$(pwd):/work" -w /work
  mcr.microsoft.com/playwright:v1.65.0-noble npx playwright test
  tests/e2e/visual-regression.spec.ts`
- Full E2E suite still passes: `npx playwright test`
- Typecheck/lint still pass: `npm run typecheck`, `npm run check`

#### Manual Verification:
- Spot-check 2-3 of the generated baseline PNGs visually (opened directly)
  to confirm they show the intended page content, not an error/blank state

## Phase 3: Wire the screenshot spec into CI (deploy-blocking)

### Changes Required:

**`.github/workflows/deploy.yml`**
- **Intent**: Make a future visual regression on these 7 screens block the
  real deploy, the same way a failing unit test already does via `needs:
  test` — per the explicit choice to CI-gate this specific spec (not the
  whole E2E suite, which stays local/ad hoc as it is today).
- **Contract**: in the `test` job, after the existing `npm run db:migrate`
  step and before (or alongside) `npm test`, add:
  1. `npx playwright install --with-deps chromium`
  2. A new step running only the new spec:
     `npx playwright test tests/e2e/visual-regression.spec.ts`, with a
     step-scoped `env:` block containing the same placeholder secrets the
     existing `Build`/`Migrate` steps already use
     (`SKIP_ENV_VALIDATION`, `DATABASE_URL`, `AUTH_SECRET`,
     `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `GITHUB_FEEDBACK_TOKEN`,
     `AUTH_TRUST_HOST: "true"`) **plus** `E2E_TEST_AUTH_SECRET:
     "ci-only-test-secret"` and `E2E_USERNAME:
     "e2e-visual-ci@example.com"` — scoped to this one step only, per the
     narrowed security comment from Phase 1.
  Playwright's own `webServer.command` (already in `playwright.config.ts`)
  builds and starts the production server itself; no separate build step is
  needed beyond what that command already does.

### Success Criteria:

#### Automated Verification:
- A deliberately broken baseline (temporarily mis-set one PNG) makes the
  new CI step fail locally when simulated:
  `npx playwright test tests/e2e/visual-regression.spec.ts` against a
  swapped-in wrong baseline returns non-zero
- Full CI `test` job steps run clean end-to-end locally in sequence (build,
  typecheck, check, migrate, `npm test`, playwright install, new spec) — no
  step fails for reasons unrelated to a real regression

#### Manual Verification:
- Push to a throwaway branch (or open a PR) and confirm the Actions run
  shows the new "Visual regression" step passing, then confirm a real
  deploy still succeeds on `master`

## Phase 4: Local vision-review script (non-blocking)

### Changes Required:

**`scripts/vision-review.ts`** (new file)
- **Intent**: Cover the "must challenge" line from Risk #11's response
  guidance — a judgment call a deterministic diff can't make (e.g. overall
  color/hue coherence across many elements) — without making a
  non-deterministic model verdict a CI/deploy gate. Runs locally only, by
  design (per the CI-secret decision in Phase 1/3, `ANTHROPIC_API_KEY`
  never reaches CI).
- **Contract**: a standalone script (`tsx`, matching
  `scripts/perf-baseline-report.ts`'s pattern), invoked via `npm run
  visual:review`. For each of the 7 screens: read the PNG already captured
  by Phase 2's spec run (or take a fresh screenshot via a short-lived
  Playwright `chromium.launch()` call if no recent capture exists), send it
  to the Anthropic Messages API (`claude-sonnet-5-5` or current default
  vision-capable model) with a prompt asking whether the screenshot shows
  any visually broken/inconsistent rendering, and print a per-screen
  verdict + one-line reasoning to stdout. On any Anthropic API error or
  timeout: catch it, log `"vision review skipped for <route>: <error>"`,
  continue to the next screen — never throw, never set a non-zero exit
  code (informational, non-blocking, per the Phase 1 decision).

### Success Criteria:

#### Automated Verification:
- `npm run visual:review` exits `0` whether or not `ANTHROPIC_API_KEY` is
  set (unset → every screen logs a skip, still exits `0`)
- Typecheck passes with the new script included: `npm run typecheck`

#### Manual Verification:
- With a real `ANTHROPIC_API_KEY` set locally, run `npm run visual:review`
  once and confirm it prints a plausible verdict for at least one screen

## Phase 5: Cookbook & doc sync

### Changes Required:

**`context/foundation/test-plan.md`**
- **Intent**: Close the loop — §3 Phase 12 moves to `complete`, and §6
  gains the reusable pattern for the next screen or script run.
- **Contract**: set Phase 12's Status cell to `complete`. Add §6 entries:
  "Adding a visual-regression baseline for a new critical screen" (add a
  `toHaveScreenshot()` test to `visual-regression.spec.ts`, regenerate via
  the Docker command, commit the new PNG) and "Running the local
  vision-review script" (`npm run visual:review`, requires
  `ANTHROPIC_API_KEY` in `.env`, informational only).

**`context/foundation/test-stack.md`**
- **Intent**: Record the Docker baseline-generation command where
  `test-stack.md`'s existing `## E2E` section already documents the rest of
  the Playwright setup.
- **Contract**: append a short subsection under `## E2E` naming the exact
  Docker command from Phase 2 and the `npm run visual:review` command from
  Phase 4.

### Success Criteria:

#### Automated Verification:
- Full suite still green end-to-end: `npm run typecheck`, `npm run check`,
  `npm test`, `npx playwright test`

#### Manual Verification:
- `test-plan.md` §3/§6 and `test-stack.md` read correctly as a finished,
  consistent record of this phase

## What We're NOT Doing

- Not CI-gating the whole E2E suite (`tests/e2e/*.spec.ts`) — only the new
  `visual-regression.spec.ts` file runs in CI; the rest of the E2E suite
  stays local/ad hoc, unchanged, per the explicit scoping decision.
- Not making the vision-review script a CI/deploy gate, and not giving it a
  GitHub Actions secret — it is local-only and informational by design.
- Not adding a custom `maxDiffPixelRatio` tolerance — using Playwright's
  built-in default.
- Not building a `workflow_dispatch` baseline-regeneration pipeline in
  GitHub Actions — baselines are regenerated locally via Docker and
  committed directly.
- Not covering the other 2-4 "lower-density" visual surfaces beyond these 7
  screens in this phase — can be added later as new `toHaveScreenshot()`
  tests following the §6 cookbook pattern this phase establishes.

## Progress

### Phase 1: Dependencies, env scaffolding, and strategy-guide update

#### Automated

- [ ] 1.1 Typecheck passes: `npm run typecheck`
- [ ] 1.2 Lint passes: `npm run check`
- [ ] 1.3 `npm install` resolves `@anthropic-ai/sdk` with no peer-dependency errors

#### Manual

- [ ] 1.4 `test-plan.md` §2/§3/§5/§8 edits read correctly against the accepted refresh brief
- [ ] 1.5 `route.ts`'s rewritten comment still reads as a clear, correct security boundary

### Phase 2: Deterministic screenshot tests (local baseline)

#### Automated

- [ ] 2.1 New spec passes against its freshly-generated baseline (Docker run)
- [ ] 2.2 Full E2E suite still passes: `npx playwright test`
- [ ] 2.3 Typecheck/lint still pass

#### Manual

- [ ] 2.4 Spot-check 2-3 generated baseline PNGs visually

### Phase 3: Wire the screenshot spec into CI (deploy-blocking)

#### Automated

- [ ] 3.1 A deliberately broken baseline fails the new spec locally
- [ ] 3.2 Full CI `test` job steps run clean end-to-end locally in sequence

#### Manual

- [ ] 3.3 Push/PR confirms the Actions run's new step passes, and a real deploy still succeeds

### Phase 4: Local vision-review script (non-blocking)

#### Automated

- [ ] 4.1 `npm run visual:review` exits 0 with and without `ANTHROPIC_API_KEY` set
- [ ] 4.2 Typecheck passes with the new script included

#### Manual

- [ ] 4.3 With a real API key set, one run prints a plausible verdict

### Phase 5: Cookbook & doc sync

#### Automated

- [ ] 5.1 Full suite still green end-to-end: typecheck, check, test, playwright test

#### Manual

- [ ] 5.2 `test-plan.md` §3/§6 and `test-stack.md` read correctly as a finished record
