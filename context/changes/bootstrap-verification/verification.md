---
bootstrapped_at: 2026-11-03T19:42:00Z
starter_id: t3
starter_name: T3 Stack
project_name: swarm-arena
language_family: js
package_manager: npm
cwd_strategy: subdir-then-move
bootstrapper_confidence: verified
phase_3_status: ok
audit_command: "npm audit --json"
---

## Hand-off

```yaml
starter_id: t3
package_manager: npm
project_name: swarm-arena
hints:
  language_family: js
  team_size: solo
  deployment_target: fly
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: verified
  path_taken: custom
  quality_override: false
  self_check_answers:
    typed: true
    from_official_starter: true
    conventions: true
    docs_current: true
    can_judge_agent: true
  has_auth: true
  has_payments: false
  has_realtime: true
  has_ai: false
  has_background_jobs: false
```

### Why this stack (from hand-off body)

Swarm Arena is a solo, after-hours, 6-week MVP whose core mechanic — several boids/predator
simulations running continuously in parallel, observed live, and resumable across restarts —
ruled out the registry's recommended `(web, js)` default, 10x Astro Starter, whose own card warns
that its edge runtime constrains long-running tasks. The custom path led to the T3 Stack instead:
NextAuth and Drizzle give authentication and a persistent database from day one (matching the
PRD's admin/member roles and save/resume requirements), end-to-end TypeScript keeps the simulation
parameters and scores strongly typed across client and server, and the stack clears all four
agent-friendly gates with a verified bootstrapper confidence. Deployment targets `fly` rather than
the starter's default `vercel` — a persistent container is required for the always-on simulation
loop and any WebSocket/SSE push to the live view, where serverless function timeouts would not
hold. CI runs on GitHub Actions with auto-deploy on merge, matching a solo after-hours workflow.
Payments and AI/LLM features are out of scope per the PRD; background-job infrastructure (queues/
cron) was not flagged as needed since the simulation tick runs as part of the long-lived server
process itself rather than a scheduled job.

## Pre-scaffold verification

| Signal      | Value                                      | Severity | Notes                                                       |
| ----------- | ------------------------------------------ | -------- | ----------------------------------------------------------- |
| npm package | create-t3-app v7.40.0 published 2025-11-05 | stale    | resolved from cmd_template (`npx create-t3-app@latest`)     |
| GitHub repo | not run                                    | n/a      | card `docs_url` is `https://create.t3.gg`, not a GitHub URL |

## Scaffold log

**Resolved invocation**: `npx create-t3-app@latest .bootstrap-scaffold --CI --tailwind --trpc --drizzle --appRouter --biome --dbProvider sqlite`
**Strategy**: subdir-then-move
**Exit code**: 0 (after one manual fix — see below)
**Files moved**: 15 top-level entries (`.env`, `.env.example`, `.gitignore`, `README.md`, `biome.jsonc`, `drizzle.config.ts`, `next-env.d.ts`, `next.config.js`, `node_modules/`, `package-lock.json`, `package.json`, `postcss.config.js`, `public/`, `src/`, `tsconfig.json`)
**Conflicts (.scaffold siblings)**: none — no path in the scaffold overlapped an existing cwd path
**.gitignore handling**: moved silently (did not previously exist in cwd)
**.bootstrap-scaffold cleanup**: deleted

### First attempt — HARD-STOP, then fixed

The first scaffold attempt exited non-zero (1). Root cause: `create-t3-app@latest` (7.40.0,
published 2025-11-05) generates a `biome.jsonc` whose `linter.rules.nursery.useSortedClasses` key
and its `options.functions` sub-key are not recognized by the Biome version the generator itself
pins in `package.json` (2.6.4) — a version-mismatch bug in the upstream starter template, not an
environment issue on this machine. The project's core files (package.json, src/, drizzle config,
next config, etc.) were written successfully before the generator's own post-generation lint-fix
step (`npm run check:unsafe` → `biome check --write --unsafe .`) ran and failed, which is what
made the overall CLI invocation exit non-zero.

Fix applied (with user approval) before retrying:
1. Ran `npx biome migrate --write` inside the scaffold directory, which rewrote `biome.jsonc` to
   the schema the installed Biome version (2.6.4) expects — renaming `useSortedClasses` to
   `useTailwindSortedClasses` and dropping the now-unsupported `options.functions` sub-key.
2. Re-ran `npm run check:unsafe` to confirm it now exits 0 (it formatted/fixed 18 files, exit 0).
3. Deleted the failed scaffold attempt and re-ran the full `create-t3-app` invocation from a clean
   state so the fix could be verified as part of the real CLI pipeline, not just the isolated
   lint step. `biome migrate` resolved the whole config in one pass on the clean re-run (no manual
   JSON edit needed the second time). Final exit code: 0.
4. Moved all scaffolded files up into cwd per the conflict matrix (no conflicts — see above) and
   removed the empty `.bootstrap-scaffold/` directory.

## Post-scaffold audit

**Tool**: `npm audit --json`
**Summary**: 0 CRITICAL, 5 HIGH, 5 MODERATE, 0 LOW
**Direct vs transitive**: 3 HIGH direct of 5 total, 2 MODERATE direct of 5 total (via `isDirect` flag in the advisory JSON)

#### HIGH findings

- **`@t3-oss/env-nextjs`** (direct) — range `<=0.12.0`. Fix available: upgrade to `0.13.11` (semver-major).
- **`@t3-oss/env-core`** (transitive, pulled in via `@t3-oss/env-nextjs`) — range `<=0.12.0`. No direct fix path; resolves when `@t3-oss/env-nextjs` is upgraded.
- **`drizzle-orm`** (direct) — range `<0.45.2`. Advisory: "Drizzle ORM has SQL injection via improperly escaped SQL identifiers" ([GHSA-gpj5-g38j-94v9](https://github.com/advisories/GHSA-gpj5-g38j-94v9)). Fix available: upgrade to `0.45.4` (semver-major).
- **`postcss`** (transitive, pulled in via `next`) — range `<=8.5.22`. Four advisories: XSS via unescaped `</style>` in CSS stringify output, and three related to arbitrary `.map` file disclosure via `sourceMappingURL` ([GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93), [GHSA-6g55-p6wh-862q](https://github.com/advisories/GHSA-6g55-p6wh-862q), [GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp), [GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849)). Fix path: upgrade `next` to `16.4.5` (semver-major), which pulls a patched `postcss`.
- **`zod`** (direct) — range `<4.6.6`. Advisory: "Zod can exhaust memory while validating oversized constrained collections" ([GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)). Fix available: upgrade to `4.6.7` (semver-major).

#### MODERATE findings

- **`drizzle-kit`** (direct) — range `0.9.1 - 0.9.54 || 0.12.9 - 1.0.0-beta.1-fd8bfcc`. Fix available: upgrade to `0.31.11` (semver-major).
- **`next`** (direct) — range `9.3.4-canary.0 - 16.3.0-preview.10`. Fix available: upgrade to `16.4.5` (semver-major).
- **`esbuild`** (transitive, pulled in via `drizzle-kit`) — range `<=0.24.2`. Advisory: "esbuild enables any website to send any requests to the development server and read the response" ([GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99)). Resolves when `drizzle-kit` is upgraded.
- **`@esbuild-kit/core-utils`** (transitive, pulled in via `drizzle-kit`) — no advisory title in this npm registry snapshot. Resolves when `drizzle-kit` is upgraded.
- **`@esbuild-kit/esm-loader`** (transitive, pulled in via `drizzle-kit`) — no advisory title in this npm registry snapshot. Resolves when `drizzle-kit` is upgraded.

#### CRITICAL / LOW / INFO findings

None.

Every available fix is a semver-major bump (`npm audit fix` would not apply any of these
automatically without `--force`). Not applied in this run — bootstrapper informs, the user
decides. See `## Next steps`.

## Hints recorded but not acted on

| Hint                    | Value                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------ |
| bootstrapper_confidence | verified                                                                                               |
| quality_override        | false                                                                                                  |
| path_taken              | custom                                                                                                 |
| self_check_answers      | typed: true, from_official_starter: true, conventions: true, docs_current: true, can_judge_agent: true |
| team_size               | solo                                                                                                   |
| deployment_target       | fly                                                                                                    |
| ci_provider             | github-actions                                                                                         |
| ci_default_flow         | auto-deploy-on-merge                                                                                   |
| has_auth                | true                                                                                                   |
| has_payments            | false                                                                                                  |
| has_realtime            | true                                                                                                   |
| has_ai                  | false                                                                                                  |
| has_background_jobs     | false                                                                                                  |

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- `git init` (if you have not already) to start your own repo history.
- Review the 10 `npm audit` findings above (3 direct HIGH, 2 direct MODERATE) and decide whether
  to take the semver-major upgrades now or defer them — none are exploitable purely by existing
  in `node_modules`, but `drizzle-orm`'s SQL-injection advisory is worth prioritizing once the
  simulation's data-access layer is written.
- `deployment_target` is recorded as `fly` in the hand-off but no `fly.toml` or CI workflow was
  generated in v1 — that scaffolding is deferred along with `CLAUDE.md`/`AGENTS.md` generation.
- `.scaffold` siblings: none were created this run — there were no conflicting paths.
