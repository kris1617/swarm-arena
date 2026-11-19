<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Security hardening pass

- **Plan**: context/changes/security-hardening-pass/plan.md
- **Mode**: Deep
- **Date**: 2026-11-19
- **Verdict**: REVISE (triaged — both findings FIXED → SOUND)
- **Findings**: 1 critical, 1 warning, 0 observations — all FIXED

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | WARNING |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | FAIL |
| Plan Completeness | WARNING |

## Grounding
6/6 paths ✓, 3/3 symbols ✓, brief↔plan ✓. `docs/reference/contract-surfaces.md` absent — skipped.

## Findings

### F1 — Phase 2's `.notNull()` column has no schema default, contradicting both project precedent and the plan's own text

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots / Plan Completeness
- **Location**: Phase 2 §1 (Contract) and Migration Notes
- **Detail**: Verified every prior `ADD COLUMN ... NOT NULL` in this project's entire migration history (`drizzle/0002`, `0006`, `0007`, `0009`, `0010`, `0012`, `0013`, `0015`) always pairs with an explicit Drizzle-schema-level `.default(...)`, which `drizzle-kit generate` then emits inline with no interactive prompt. Phase 2's `runMode: d.text(...).notNull()` has no `.default(...)` — a genuinely first-of-its-kind shape for this project. `drizzle-kit generate --help` (version `^0.31.11`, confirmed installed) has no flag for supplying a backfill default non-interactively, so an agent running `npm run db:generate` via Bash (no TTY) would hang or fail. The plan is also internally inconsistent: Phase 2 §1 says drizzle-kit "will prompt for a default when run interactively," while Migration Notes says the backfill is "applied automatically... not a separate manual step" — these contradict each other, and neither matches how the automated gate (`npm run db:migrate`) would actually run.
- **Fix**: Add `.default("client")` directly to the `runMode` column definition in the schema (matching every prior migration's pattern exactly) — this sidesteps the interactive-prompt question entirely, since the default becomes part of the schema `drizzle-kit generate` reads, not something it needs to ask about. Delete the now-contradictory sentence in Phase 2 §1 about an interactive prompt.
- **Decision**: FIXED

### F2 — Phase 1's headers() doesn't cover middleware-issued responses

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 1 §1 (Contract), Desired End State
- **Detail**: Confirmed via this Next.js version's own docs: middleware (`src/middleware.ts`) executes before routing, and `next.config.js`'s `headers()` applies through the page/route-rendering pipeline — not to a redirect response middleware itself issues. The very common case of a signed-out user hitting a protected page (middleware's own `auth()` redirect to `/login`) would NOT carry the new security headers, even though every page/route response would. The plan's Desired End State says "every response carries X-Frame-Options..." — this isn't literally true as scoped, and "What We're NOT Doing" doesn't call out this gap either.
- **Fix A ⭐ Recommended**: Explicitly scope this out, with the reason stated
  - Strength: The gap is narrow (short-lived 307 redirects, not attacker-controllable rendered content) and keeps Phase 1's risk at "purely additive, no middleware changes" as originally scoped.
  - Tradeoff: The Desired End State's "every response" wording needs correcting to be accurate, and the gap persists indefinitely unless revisited.
  - Confidence: HIGH — middleware redirects carry no body/rendered content for X-Frame-Options/CSP to meaningfully protect; the clickjacking/XSS risk these headers mitigate doesn't apply to a bare redirect the same way it does to a rendered page.
  - Blind spot: None significant.
- **Fix B**: Also set the headers inside `src/middleware.ts`'s own response
  - Strength: Closes the gap completely — truly every response carries the headers.
  - Tradeoff: Touches the one file that's already load-bearing for the entire app's auth gate — any mistake there risks breaking authentication for every page, not just the header behavior; raises this phase's risk profile significantly.
  - Confidence: MEDIUM — mechanically straightforward (clone headers onto the `NextResponse` middleware returns), but the blast radius of editing this specific file is real.
  - Blind spot: Haven't verified whether NextAuth's `auth()` wrapper exposes a clean way to attach headers to its own redirect response without reimplementing the wrapper.
- **Decision**: FIXED (Fix B — wrapped `src/middleware.ts`'s response with the shared `SECURITY_HEADERS` constant, authorization decision untouched)
