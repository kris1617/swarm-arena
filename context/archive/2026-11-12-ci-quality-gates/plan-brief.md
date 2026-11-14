# Quality-Gates Wiring — Plan Brief

> Full plan: `context/changes/ci-quality-gates/plan.md`
> Research: `context/changes/ci-quality-gates/research.md`

## What & Why

This is rollout Phase 5 of `context/foundation/test-plan.md`: close the cross-cutting gap §5 identified from the very start — `.github/workflows/deploy.yml` auto-deploys on every push to `master` with zero lint/typecheck/test gating. All four prior rollout phases added real test coverage that a broken commit could still bypass straight to production until this gate exists.

## Starting Point

One workflow file, one job (`deploy`), triggered on push to `master`, that SSHes into the VPS to trigger a remote deploy script. No build, test, or check runs in CI today. `npm run typecheck`/`check`/`test` all currently pass and need no secrets to run.

## Desired End State

Two jobs: a new `test` job (build, typecheck, lint, test — no secrets) and the existing `deploy` job, now gated via `needs: test`. A broken commit never reaches the deploy step.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| `.next/types` uncertainty | Add a defensive `next build` step | Removes the uncertainty entirely rather than discovering it on a real CI failure | Plan (user-confirmed) |
| Trigger scope | Push-to-master only, no `pull_request` | Matches the existing trigger exactly; this repo doesn't use a PR-based workflow today | Plan (user-confirmed) |
| Secret scoping | `test` job gets zero secrets | Least-privilege, matching this project's existing SSH-key-scoping pattern | Plan (research-grounded) |
| Env validation for build | `SKIP_ENV_VALIDATION=1` on the build step | Reuses the project's own existing escape hatch (already used by the Dockerfile's build stage), no invented secret values | Plan (research-grounded) |

## Scope

**In scope:**
- A new `test` job in `.github/workflows/deploy.yml`
- `needs: test` added to the existing `deploy` job
- Local verification of all four gated commands + YAML syntax
- One real CI run observed after the commit lands

**Out of scope:**
- `pull_request` trigger
- Any change to `deploy`'s own steps, SSH logic, or secret access
- A second workflow file
- Real secret values for the build step (uses `SKIP_ENV_VALIDATION` instead)

## Architecture / Approach

One edit to one file: a self-contained `test` job (own runner, own steps, zero secrets) and a single added `needs: test` line on the existing `deploy` job. No other file changes.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Add the test job and gate deploy on it | Two-job workflow with required gating | Local success doesn't prove GitHub's job-dependency graph behaves correctly — only a real push verifies that, which is this phase's own manual verification step |

**Prerequisites:** None beyond what's already in the repo.
**Estimated effort:** ~1 session, single phase (plus observing one real CI run after push).

## Open Risks & Assumptions

- `next build`'s added wall-clock cost on every push to `master` was a conscious tradeoff for removing the `.next/types` uncertainty — if this becomes a real friction point later, revisit with `--refresh`.
- The manual verification step (observing a real CI run) can only happen after this phase's commit is actually pushed — it's the one success criterion that can't be checked before landing the change.

## Success Criteria (Summary)

- A future broken commit (failing lint, types, or tests) is blocked from triggering the VPS deploy automatically — the exact gap test-plan.md §5 named from the start is closed.
