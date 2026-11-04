---
project: swarm-arena
checked_at: 2026-11-03T20:30:00Z
health_status: healthy
context_type: brownfield
language_family: js
stack_assessment_available: true
checks_run:
  - lockfile
  - dependency_audit
  - outdated_deps
  - test_runner
  - ci_cd
  - configuration
audit_findings:
  critical: 0
  high: 0
  moderate: 4
  low: 0
test_runner_detected: true
ci_provider: null
recommended_fixes: 2
---

## Dependency Health

### Lockfile

```
Status: present (package-lock.json)
Package manager: npm
```

### Security Audit

```
Tool: npm audit --json
Summary: 0 CRITICAL, 0 HIGH, 4 MODERATE, 0 LOW
Direct vs transitive: 1 MODERATE direct of 4 total (via isDirect flag)
```

All 5 HIGH findings from the previous run (`drizzle-orm`, `@t3-oss/env-nextjs`, `zod` direct;
`@t3-oss/env-core`, `postcss` transitive) are resolved — `drizzle-orm`, `@t3-oss/env-nextjs`,
`zod`, and `next` were all upgraded since the last check.

#### MODERATE findings

- **`drizzle-kit`** (direct) — range `0.19.0 - 1.0.0-beta.1-fd8bfcc`. No further fix available
  yet beyond the `0.31.11` already installed; this range reflects the advisory's upper bound, not
  an available-but-unapplied upgrade.
- **`esbuild`** (transitive, via `drizzle-kit`) — range `<=0.24.2`. Resolves if/when upstream
  `drizzle-kit` bumps its bundled `esbuild`.
- **`@esbuild-kit/core-utils`**, **`@esbuild-kit/esm-loader`** (transitive, via `drizzle-kit`) —
  same upstream dependency, no independent fix path.

None of the remaining 4 are exploitable by merely existing in `node_modules` — they're dev-time
tooling (drizzle-kit's bundled esbuild), not runtime dependencies.

### Outdated Dependencies

```
Packages with major version gaps: 1
```

- **`typescript`**: `5.9.3` → `7.0.2` (2 major versions behind) — **intentionally held back**.
  TypeScript 7.0.2 is a new major (the native/Go-ported compiler) that broke on this project:
  it removed the `baseUrl` compiler option and changed how it resolves implicit types for
  side-effect CSS imports, which Next.js's App Router relies on. Upgrading `@types/node` (now at
  latest, `26.6.6`) was safe and done; jumping to TypeScript 7 was not, until the wider Next.js/T3
  ecosystem catches up. Re-check this when `typescript@7.x` has broader framework support.

(`@libsql/client` `0.14.0` → `0.18.0` is a pre-1.0 version bump, not a major-version gap by
strict semver — not flagged.)

## Test Suite

```
Test runner: Vitest
Tests found: 1 test
Test execution: passing
```

Configuration: `vitest.config.ts` (native `resolve.tsconfigPaths`, test env vars for
`DATABASE_URL`/`NODE_ENV` set directly in config since Vitest doesn't auto-load `.env`)
Framework: Vitest `5.1.0`

First test (`src/server/api/routers/post.test.ts`) exercises the `postRouter.hello` procedure via
tRPC's `createCaller` pattern — the same pattern `stack-assessment.md` recommended documenting.
This is a smoke test proving the harness works end-to-end (tsconfig path aliases, tRPC context,
superjson transformer); it is not yet the scoring-determinism test the project's core guardrail
needs, because no scoring logic exists yet (the codebase is still the T3 scaffold default).

## CI/CD

```
Provider: not detected
Configuration: not found
```

ℹ No CI/CD configuration detected. You'll set this up in the infrastructure and deployment
lesson. For now, a local test runner is sufficient for agent collaboration — and that runner is
now in place and passing.

| Stage      | Status | Notes                                                |
| ---------- | ------ | ----------------------------------------------------- |
| Lint       | ✗      | not configured in CI (Biome exists locally)            |
| Test       | ✗      | not configured in CI (Vitest exists locally, passing)  |
| Build      | ✗      | not configured in CI (`next build` exists locally)     |
| Type check | ✗      | not configured in CI (`tsc --noEmit` exists locally)   |
| Security   | ✗      | not configured in CI (`npm audit` run manually)        |

## Configuration

### High severity

None — `.gitignore` present, `tsconfig.json` has `strict: true`.

### Medium severity

None — Biome (`biome.jsonc`) covers linting and formatting; no separate ESLint/Prettier config
expected or missing. Biome is now also scoped (via `files.includes`) to exclude `context/`,
`CLAUDE.md`, and `AGENTS.md`, after an earlier `biome check --write --unsafe` run reformatted
those files' YAML frontmatter and had to be reverted — worth knowing if you ever widen Biome's
scope again.

### Low severity

- **`.editorconfig`** — still not present. Fix: add a standard `.editorconfig` (two-space indent,
  UTF-8, LF line endings) matching Biome's current formatting output.

(`.env.example` is present — no gap there.)

## Stack Assessment Cross-Reference

```
Stack assessment: context/foundation/stack-assessment.md
Agent readiness (from stack-assess): ready-with-compensation
```

| Quality Gate Gap                       | Health-Check Finding                                                                  | Status     |
| --------------------------------------- | --------------------------------------------------------------------------------------- | ---------- |
| Test runner: fail (not configured)      | Resolved — Vitest is now installed, configured, and passing 1/1 tests                   | Mitigated  |
| Build tool (Biome) training-data: fail  | Unchanged — no CI lint stage exists to catch an agent drifting toward ESLint idioms      | Reinforced |
| Build tool (Biome) documented: fail     | Unchanged — same schema-drift issue stands; Biome's scope was narrowed this run, not its docs | Reinforced |

`stack-assessment.md` itself is now slightly stale: its "Test runner: none configured" finding
and `gates_failed: 3` count no longer reflect reality (a test runner exists now). Re-running
`/10x-stack-assess` would refresh that file if you want it to match current state — not required,
since health-check's own test-suite section above already reflects the fix.

The ready-to-paste `CLAUDE.md`/`AGENTS.md` entries stack-assess drafted (Testing + Biome
sections) are still not written into `CLAUDE.md` — still intentionally deferred to agent
onboarding per this skill's course-context framing (see Category B below).

## Recommended Fixes

### Fix before agent work (Category A)

#### 1. Remaining MODERATE dependency findings (transitive, `drizzle-kit`'s bundled `esbuild`)

**Impact**: low practical risk — these are dev-time tooling dependencies (drizzle-kit's bundled
esbuild dev server), not runtime code paths. Worth a periodic re-check, not urgent action.
**Severity**: low-to-medium
**Effort**: quick (< 5 min to re-check)
**Fix**: run `npm audit` again after your next routine dependency bump; no action needed today.

#### 2. Missing `.editorconfig`

**Impact**: minor — Biome already enforces formatting; this only affects editor behavior Biome
doesn't cover.
**Severity**: low
**Effort**: quick (< 5 min)
**Fix**: add a standard `.editorconfig` (two-space indent, UTF-8, LF line endings).

### Addressed in upcoming lessons (Category B)

#### No CI/CD pipeline

**Lesson**: [Sprint Zero z Agentem: infrastruktura, walking skeleton i pierwszy deploy (M1L5)](https://platforma.przeprogramowani.pl/external/10xdevs-3/m1-l5)
**What you'll do there**: set up a GitHub Actions workflow covering lint, type-check, test (now
that Vitest exists locally, wiring it into CI is straightforward), and build.

#### Missing stack-specific `CLAUDE.md` / `AGENTS.md` content

**Lesson**: [Agent Onboarding: Agents.md, AI Rules i feedback loops (M1L4)](https://platforma.przeprogramowani.pl/external/10xdevs-3/m1-l4)
**What you'll do there**: build out the project's instruction file. The Testing and Biome entries
already drafted in `stack-assessment.md` are ready to drop in — and the Testing example can now
reference the real `post.test.ts` pattern instead of a hypothetical one.

#### Missing deployment configuration

**Lesson**: [Sprint Zero z Agentem: infrastruktura, walking skeleton i pierwszy deploy (M1L5)](https://platforma.przeprogramowani.pl/external/10xdevs-3/m1-l5)
**What you'll do there**: generate the `fly.toml` for the `fly` deployment target already
recorded in the tech-stack hand-off, and do the first deploy.

## Summary

Health status: healthy

Both Category A blockers from the previous check are resolved: a working test runner (Vitest,
1/1 passing) now exists, and all 5 HIGH-severity dependency advisories are fixed — including the
`drizzle-orm` SQL-injection advisory, now patched before any data-access code was written against
it. What remains is low-impact: 4 MODERATE findings confined to a dev-time bundler dependency,
one deliberately-deferred major upgrade (TypeScript 7, held back for a real ecosystem
incompatibility, not an oversight), and a missing `.editorconfig`. CI/CD and deployment
configuration are still absent but are expected gaps at this stage, not findings against the
project's health.

Next step: your project is healthy — proceed to agent onboarding. Both the greenfield and
brownfield paths converge there with equivalent context artifacts.
