---
topic: "Refactor opportunities for sim-engine (10xArchitect M4L4 artifact)"
researcher: "Claude (Sonnet 5)"
change_id: refactor-opportunities-refresh
date: 2026-11-20
---

# Refactor opportunities — exploration (no code changes)

Source: `context/changes/sim-engine-feature-refresh/research.md` (2026-11-20). Hard limits observed: no code changes, no refactor, evidence before interpretation; "unknown" where data is missing rather than a guess.

## Candidates considered

### Candidate A — Deduplicate the three `wasEverXWritten` retry-write branches (server-run-registry.ts) — CANDIDATE

**Current shape** [evidence]: `src/server/simulation/server-run-registry.ts:781-852` has three structurally identical blocks — `wasEverThrottledWritten` (781-801), `wasEverFoodImbalancedWritten` (809-825), `wasEverPredatorTribeImbalancedWritten` (835-852) — each: check a per-tick boolean condition, guard on a write-once flag, fire-and-forget a DB update, latch the flag only on success (`.then`), log-and-swallow on failure (`.catch`) so the next throttled/imbalanced tick retries. None of the three branches has a test forcing the DB write to fail and verifying the retry actually happens (`grep -c` for all three names against `server-run-registry.test.ts` returns 0).

**Intentionality** [evidence, git history]: not a deliberate three-way duplication — the pattern was copy-paste-propagated across three separate feature changes. Git blame via `git log -S"wasEverFoodImbalancedWritten"` shows it was added in `per-tribe-food-config` (p5), and the third in `second-predator-tribe-prey-target` (p3); the code's own comments at each later site say "Mirrors finishRun's fire-and-forget posture" / "as `wasEverThrottledWritten` above" — each later author explicitly followed the established local pattern rather than extracting a shared helper. This is accidental complexity from organic feature growth (Brooks' term), not an essential/deliberate design choice — a genuine candidate for a guard-and-extract refactor, not a "leave it, it's intentional" case.

**Migration feasibility** [evidence]: low risk. A reusable `sabotagingDb` Proxy pattern already exists in this codebase (`src/server/api/routers/simulation.test.ts:899-930,1076-1106`) for forcing a DB write to fail in a test — the same fixture shape can characterize all three branches today before extracting, then verify the extracted helper against the same fixture. Target shape: **Transaction Script** — a small shared function `retryableLatchWrite(db, runId, column, condition)` (or similar), called three times with different column names/conditions, replacing the three hand-copied blocks. No schema change, no migration, no call-site change outside this one file.

### Candidate B — Client bundles a broad slice of `src/server/simulation/*` into the browser bundle (simulation-canvas.tsx) — CANDIDATE, larger/riskier, not recommended for "one safe change" this round

**Current shape** [evidence]: `simulation-canvas.tsx` imports `boids`, `color`, `parameter-ranges`, `rng`, `single-run-lifecycle` directly from `~/server/simulation/*` (confirmed via its own import list, `simulation-canvas.tsx:19-42` per the e2e trace sub-agent), plus `FOOD_SEED_COLOR` bypassing `theme-colors.ts` entirely. This is the client-staged ("staging") architecture's own documented design — the whole point of client-staged runs is running the same tick logic in the browser without a server round-trip per tick.

**Intentionality** [evidence]: deliberate, not accidental — `archive/2026-11-11-parallel-sim-switching/plan.md`'s own "duplicated, not shared" decision (cited in `repo-map.md`'s Risk #4) and the client-staged feature's whole premise require this. This is essential complexity for the feature as designed, not drift.

**Why not recommended this round**: fixing this would mean either (a) accepting that `src/server/simulation/*` is dual-purpose (server + client bundle) by design — the status quo — or (b) splitting it into a bundle-safe pure-logic package and a server-only package, which is a much larger, cross-cutting change touching every import site in both `simulation-canvas.tsx` and `server-run-registry.ts`. No evidence this is currently causing real harm (no bundle-size complaint, no accidental server-secret leak found). **Classified as a considered-and-rejected-for-now candidate**: real, but the cost of restructuring exceeds the currently-observed cost of leaving it, and the design is already documented as deliberate elsewhere.

### Non-candidate — the hand-synced composed-tick duplication (boids.ts `runTick` vs. simulation-canvas.tsx's inline sequence) — GUARD, not rebuild

Per the "guard, not rebuild" rule: this duplication is explicitly documented as deliberate (`boids.ts:1663-1673`'s own comment asserts the two sequences are "mirrors... exactly," by design, because the client-staged path can't call a server-only scheduler). The correct response is a **characterization/guard test** proving the two sequences stay in lockstep (e.g., a test that runs both paths with the same seed+params and asserts identical output), not a structural refactor. This is recorded here as a candidate the ranking explicitly rejected, with reasons, per the lesson's required "considered and rejected" list — not silently dropped.

### Non-candidates (test gaps, not refactor candidates)

`camera.ts`/`use-camera.ts` having zero test files, and `startServerRun`'s untested double-registration guard, are **test-coverage gaps**, not code-structure problems — nothing about their current shape needs to change, they need tests added. Out of scope for this refactor-opportunities ranking (which targets code *structure*); already logged in `sim-engine-feature-refresh/research.md` §2.2 for a future test-plan rollout phase.

## Refactor opportunities — ranked

1. **Candidate A: deduplicate the three `wasEverXWritten` retry-write branches.** Current shape → target shape: three hand-copied fire-and-forget blocks → one shared `retryableLatchWrite`-style helper, called three times. Why it earns #1: highest debt-cost-to-change-cost ratio found this pass — cheap, bounded (one file), no schema/migration impact, and directly closes a confirmed, already-tripled test gap as a side effect (one helper is trivially unit-testable with the existing `sabotagingDb` fixture, vs. three near-identical test cases needed today). Blast radius: `server-run-registry.ts` only (its 3 call sites + new helper), no external callers. Incremental path: characterize current behavior for all 3 branches first (via the existing sabotage fixture), extract the helper, swap each call site one at a time, confirm tests stay green after each swap. First prerequisite step: write the 3 characterization tests against *current* (duplicated) code before touching anything.
2. **Candidate B (watch, not this round): client-bundled server logic.** Real, deliberate, larger — worth a dedicated future analysis if bundle size or a security boundary ever becomes a concrete, measured problem; not actionable as "one safe change" today.

Considered and rejected: the hand-synced tick composition (guard, not rebuild — see above).

## ast-grep verification

Re-ran structural checks with `ast-grep` (installed fresh this session, v0.51.3) against the claims above:
- `ast-grep run -p '$X.then($$$).catch($$$)' -l ts server-run-registry.ts` returned 68 matches — too broad to isolate the 3 target chains specifically (the loose metavariable pattern matches sub-expressions throughout the file, a known limitation of this fallback tool for multi-line chained-call patterns). Per the rule "confirm every ast-grep zero with grep" (applied here in reverse — an implausibly broad non-zero result also needs a grep cross-check): `grep -n` directly confirms the three named booleans exist at exactly the line numbers cited above (`wasEverThrottledWritten`: 186,781,791,988,1203; `wasEverFoodImbalancedWritten`: 190,809,819,989,1204; `wasEverPredatorTribeImbalancedWritten`: 194,840,852,990,1205), and `grep -c` against the test file confirms 0 hits for all three names. The line-number claims in Candidate A are grep-verified exact matches, not estimates.
- `ast-grep run -p 'import { $$$ } from "~/styles/theme-colors"' -l ts boids.ts` and the re-export pattern check (from the sim-engine-feature-refresh research pass) both resolved cleanly with ast-grep and matched the grep cross-check exactly — no discrepancy there.
