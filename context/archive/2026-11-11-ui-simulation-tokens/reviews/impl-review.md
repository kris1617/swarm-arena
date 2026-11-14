<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: UI simulation tokens

- **Plan**: context/changes/ui-simulation-tokens/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-11-11
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Automated success criteria (re-verified)

- `npm run typecheck` — PASS
- `npm run check` — PASS
- `AGENTS.md` contains `## UI` section — PASS
- `components.json`, `src/components/ui/button.tsx`, `src/components/ui/input.tsx` exist — PASS

## Drift detection summary

Zero DRIFT/MISSING/EXTRA across all 4 phases. Both explicitly-flagged in-flight deviations (className overrides reconstructing the original pill/translucent look via tokens instead of shadcn defaults; the hover-opacity bump from `/20` to `/35` after manual review) are applied consistently across all 15 Button/Input call sites in `page.tsx`, `simulation-canvas.tsx`, and `kitchen-sink/page.tsx`. The unplanned `htmlFor`/`id` a11y fix (5 pairs) is complete and correctly matched.

## Findings

### F1 — Kitchen-sink's 3 demo Inputs have no accessible name

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/app/simulation/kitchen-sink/page.tsx:59-89
- **Detail**: The focused/empty/error Input demos sit under `<h2>` headings, not `<label>` elements, with no `aria-label`/`aria-labelledby` — a screen-reader user gets no accessible name for any of the three. Contradicts the change's own a11y focus (the real view's 5 inputs all correctly got htmlFor/id pairs).
- **Fix**: Add `aria-label` matching each section's `<h2>` text to the three Input instances.
- **Decision**: FIXED

### F2 — .gitignore .env_* addition is unrelated scope riding this commit set

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Scope Discipline
- **Location**: .gitignore:39
- **Detail**: Confirmed harmless and correctly scoped (`.env_*` requires an underscore, so `.env.example` stays tracked) — a real security fix from earlier in this session, just unrelated to this change-id.
- **Fix**: None needed.
- **Decision**: ACCEPTED-AS-RULE: Side-fixes found mid-implementation ride along in the current commit

### F3 — autoFocus steals initial page focus on the kitchen-sink page

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality
- **Location**: src/app/simulation/kitchen-sink/page.tsx:61
- **Detail**: A keyboard/AT user landing on this page would have focus jump past the `<h1>`/earlier sections. Reasonable for a throwaway screenshot-gate page.
- **Fix**: None needed — accepted for this page's purpose.
- **Decision**: FIXED — removed `autoFocus`, added a comment instructing manual focus during the screenshot step (same pattern as the hover state).

### F4 — Kitchen-sink ships as a real route with no noindex

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Architecture
- **Location**: src/app/simulation/kitchen-sink/page.tsx (whole file)
- **Detail**: Not actually publicly reachable — gated by the same auth middleware as every other route in this app, so the reviewing agent's "public component-catalog URL" framing overstates the risk. Still worth a conscious decision on whether it stays permanent.
- **Fix**: None needed now — revisit if this view's design churns enough that the kitchen sink goes stale.
- **Decision**: SKIPPED
