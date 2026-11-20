# Test stack

## E2E

<!-- Written by /10x-e2e-setup. Re-run it to change this section; other skills only read it. -->

- runner: Playwright Test, @playwright/test 1.65.0
- config: playwright.config.ts
- single-spec command: npx playwright test tests/e2e/seed.spec.ts
- full-suite command: npx playwright test
- base URL: http://localhost:3000
- port: 3000 (detected default for `next start`, no port configured anywhere in the project; override with E2E_PORT)
- web server command: npm run build && node .next/standalone/server.js (PORT/HOSTNAME env, static assets copied in first — mirrors the Dockerfile exactly, since next.config.js's output: "standalone" means `next start` is not what's actually deployed; see playwright.config.ts's webServer comment); reuseExistingServer outside CI
- auth setup project: setup (tests/e2e/auth.setup.ts), signs in via the local-only test-auth bypass (src/app/api/test-auth/login/route.ts) instead of a real UI form — this app has no credentials provider (next-auth, GitHub OAuth only, database sessions) and automating a real GitHub OAuth round-trip was out of scope. Credentials: E2E_USERNAME (test-user email) and E2E_TEST_AUTH_SECRET (shared secret the route requires) in .env. The route also requires AUTH_TRUST_HOST=true (see below) and is inert unless E2E_TEST_AUTH_SECRET is set — never set that in a deployed environment.
- storageState: playwright/.auth/user.json (gitignored)
- seed: tests/e2e/seed.spec.ts — protects "unauthenticated visitor hitting a protected route is gated to /login" (not a risk in test-plan.md, whose current risk map routes every risk to unit/integration; chosen by request when standing up E2E infrastructure, since it needs no login and is true today per src/middleware.ts). Opts out of storageState deliberately — its risk is the signed-out path.
- browser CLI: npx -y @playwright/cli (global `npm i -g` blocked by filesystem permissions on this machine), command skill at .claude/skills/playwright-cli
- updated: 2026-11-13

### Visual-regression baselines & vision review (rollout Phase 12)

- visual-regression spec: `tests/e2e/visual-regression.spec.ts`, run via
  `npx playwright test tests/e2e/visual-regression.spec.ts` (CI-wired,
  required gate — see test-plan.md §5). Baselines live at
  `tests/e2e/visual-regression.spec.ts-snapshots/*.png`.
- baseline generation: Docker is NOT used (unavailable in this environment)
  and a locally-generated baseline does not reliably match real CI
  (`ubuntu-latest`) rendering. The baseline-generation method that actually
  works is a one-time `workflow_dispatch` GitHub Actions job that runs
  `npx playwright test tests/e2e/visual-regression.spec.ts
  --update-snapshots` on the real `ubuntu-latest` runner, uploads the
  resulting PNGs via `actions/upload-artifact@v4`, which are then pulled
  down with `gh run download <run-id>` and committed. The workflow file
  itself is temporary — add it, trigger it, download the artifact, commit
  the PNGs, then delete the workflow. See test-plan.md §6.12 for the full
  step-by-step and `git log` around commit `c42a524` for the real
  baseline-replacement commit.
- local vision review: `npm run visual:review` runs `scripts/vision-review.ts`
  — informational only, never a CI gate. Requires a server already running
  at the configured base URL (`npm run build && npm start`, or `npm run dev`
  — this script does not use Playwright's `webServer` auto-start) and
  `ANTHROPIC_API_KEY` set in `.env` (optional var in `src/env.js`,
  documented in `.env.example`; without it every screen is logged as
  skipped and the script still exits 0). See test-plan.md §6.13.
- updated: 2026-11-20

**Found while wiring the auth bypass, not specific to E2E:** next-auth v5 rejects every session with `UntrustedHost` unless `AUTH_TRUST_HOST=true` (or `AUTH_URL`) is set — this blocked the bypass locally and likely affects the real deployment too, since `.env_prod` didn't have it either and the deploy sits behind a reverse proxy. Added `AUTH_TRUST_HOST=true` to `.env`, `.env.example`, and `.env_prod`, and `trustHost: env.AUTH_TRUST_HOST` to `src/server/auth/config.ts`. The VPS's actual deployed env still needs the same variable — `.env_prod` here is not what's deployed, and this repo has no access to set it there (the deploy key is forced-command-only, see `context/deployment/deploy-plan.md`).

**Fixed:** the webServer command originally used `next start`, which Next.js itself warns is incompatible with `output: "standalone"` in `next.config.js` — and which silently served a dev-shaped server rather than the Dockerfile's actual `node .next/standalone/server.js`. Also caught along the way: the standalone server `chdir()`s into its own directory on start, so `DATABASE_URL`'s relative default (`file:./db.sqlite`) would have pointed at a fresh, schema-less database under `.next/standalone/` instead of the repo's real `db.sqlite` — the webServer command now passes an absolute `DATABASE_URL` to override it.
