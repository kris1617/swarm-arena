# Quality-Gates Wiring Implementation Plan

## Overview

Add a `test` job to `.github/workflows/deploy.yml` that runs a defensive build, typecheck, lint, and the test suite, and make the existing `deploy` job depend on it via `needs: test` — closing the cross-cutting gap test-plan.md §5 identified: auto-deploy on every push to `master` with zero lint/typecheck/test gating. Pure CI configuration change; no production or test code touched.

## Current State Analysis

- `.github/workflows/deploy.yml` (full content read) is the only workflow in the repo — a single `deploy` job triggered on `push` to `master`, whose one step SSHes into the VPS using the `DEPLOY_SSH_KEY` secret to run a forced-command remote script (`deploy.sh`, documented in `context/deployment/deploy-plan.md`). The GitHub Actions job itself does no building, testing, or checking today.
- `npm run typecheck` (`tsc --noEmit`), `npm run check` (`biome check .`), and `npm test` (`vitest run`) all currently pass against the tree; none of the three need any secret or env var (`vitest.config.ts`'s own `test.env` block is self-contained).
- `package-lock.json` exists and is tracked — `npm ci` is correct for CI.
- `next build` (chosen as this phase's defensive step) imports `src/env.js` at module load, which validates required env vars via T3's `createEnv` and throws if they're missing — unless `SKIP_ENV_VALIDATION` is set, which this project's own `Dockerfile` already does for its build stage (per `context/deployment/deploy-plan.md`'s "Known gap" note on the Docker build skipping validation). The CI gate job will follow that same established pattern rather than inventing dummy secret values.

### Key Discoveries:

- No Node version is pinned anywhere in `package.json` (no `engines` field); local dev uses Node v22. `actions/setup-node` will pin `22` explicitly so CI doesn't silently drift from local dev as Node releases new majors.
- No YAML/Actions linter is installed locally, but Python's `pyyaml` is available — sufficient for a local YAML-syntax validity check (not a substitute for GitHub's own job/`needs`-graph validation, which only a real Actions run performs).

## Desired End State

`.github/workflows/deploy.yml` has two jobs: `test` (checkout, Node setup, `npm ci`, `next build` with `SKIP_ENV_VALIDATION=1`, `npm run typecheck`, `npm run check`, `npm test`) and `deploy` (unchanged except for a new `needs: test`). Both triggered only by `push` to `master`, matching the existing trigger exactly. The `test` job has no access to `DEPLOY_SSH_KEY` or any other secret.

**Verification:** The YAML parses as valid (`python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy.yml'))"`); all four gated commands (`next build` with the env flag, `typecheck`, `check`, `test`) currently pass locally; after this phase's commit lands on `master`, one real GitHub Actions run is observed to confirm the `test` job succeeds and `deploy` correctly waits for it.

## What We're NOT Doing

- Not adding `pull_request` as a trigger — scope stays exactly "gate the existing push-to-master auto-deploy," matching this repo's current direct-commit workflow (no PR-based flow exists yet).
- Not changing the `deploy` job's own steps, secret access, or SSH logic — only its trigger condition (via `needs: test`) changes.
- Not adding a second workflow file — this is a two-job addition to the existing single workflow, the idiomatic GitHub Actions pattern for sequential gating.
- Not inventing real secret values for the `next build` step — using the project's own existing `SKIP_ENV_VALIDATION` escape hatch, already established by the Dockerfile's build stage.

## Implementation Approach

One edit to one file. The `test` job is self-contained (own runner, own steps, no secrets); the `deploy` job gains exactly one line (`needs: test`) and is otherwise untouched.

## Phase 1: Add the test job and gate deploy on it

### Overview

Edit `.github/workflows/deploy.yml` to add the `test` job and the `needs: test` dependency.

### Changes Required:

#### 1. CI quality gate

**File**: `.github/workflows/deploy.yml`

**Intent**: Give the existing auto-deploy a required lint/typecheck/test/build gate, with least-privilege secret scoping matching this project's existing SSH-key-scoping pattern.

**Contract**: Add a new `test` job (before or alongside `deploy` in the `jobs:` map): `runs-on: ubuntu-latest`; steps: `actions/checkout@v4`; `actions/setup-node@v4` with `node-version: "22"` and `cache: "npm"`; `npm ci`; `next build` (via `npm run build`) with `SKIP_ENV_VALIDATION: "1"` set in that step's `env:` (matching the Dockerfile's existing pattern, not inventing new secret values); `npm run typecheck`; `npm run check`; `npm test`. No step in this job references `secrets.DEPLOY_SSH_KEY` or any other secret. Add `needs: test` to the existing `deploy` job — its own steps, `DEPLOY_SSH_KEY` usage, and SSH logic stay byte-for-byte unchanged. The `on: push: branches: [master]` trigger block stays exactly as-is, applying to the whole workflow (both jobs), matching the current scope exactly.

### Success Criteria:

#### Automated Verification:

- YAML parses as valid: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy.yml'))"`
- `SKIP_ENV_VALIDATION=1 npm run build` passes locally (the exact command the new `test` job runs)
- `npm run typecheck` passes locally
- `npm run check` passes locally
- `npm test` passes locally

#### Manual Verification:

- After this phase's commit is pushed to `master`, open the repository's Actions tab and confirm: the `test` job runs and succeeds, the `deploy` job shows as waiting on (then running after) `test`, and the overall workflow completes successfully — the one thing only a real GitHub Actions run can confirm (job-dependency graph execution, not just local command success).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human. This is the final phase.

---

## Testing Strategy

### Unit Tests:

- N/A — this phase is CI configuration, not application code.

### Integration Tests:

- N/A for this phase.

### Manual Testing Steps:

1. Push this phase's commit to `master` (the normal flow for this repo — no PR step exists today).
2. Open the GitHub Actions tab for this run; confirm the `test` job's four steps (build, typecheck, check, test) each show green.
3. Confirm the `deploy` job started only after `test` succeeded (visible in the job-dependency graph / timing in the Actions UI), and that it completed its SSH step as before.

## Performance Considerations

Adding `next build` to the gate job adds real wall-clock time to every push to `master` (a full Next.js production build, not just a type-check) — the cost this phase's own design decision explicitly accepted in exchange for removing the `.next/types` uncertainty research flagged.

## Migration Notes

None — no schema or data changes; this is CI configuration only. The existing `deploy` job's behavior is unchanged once `test` passes; if `test` ever fails, `deploy` simply does not run, which is the intended new behavior (previously `deploy` ran unconditionally).

## References

- Research: `context/changes/ci-quality-gates/research.md`
- Test plan: `context/foundation/test-plan.md` (§5 Quality Gates; §3 Phase 5)
- Existing workflow: `.github/workflows/deploy.yml`
- Deploy mechanism documentation: `context/deployment/deploy-plan.md`
- Existing `SKIP_ENV_VALIDATION` precedent: `Dockerfile`'s build stage

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Add the test job and gate deploy on it

#### Automated

- [x] 1.1 YAML parses as valid: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy.yml'))"`
- [x] 1.2 `SKIP_ENV_VALIDATION=1 npm run build` passes locally
- [x] 1.3 `npm run typecheck` passes locally
- [x] 1.4 `npm run check` passes locally
- [x] 1.5 `npm test` passes locally

#### Manual

- [ ] 1.6 After pushing to master, the test job succeeds and deploy correctly waits for it in the GitHub Actions UI
