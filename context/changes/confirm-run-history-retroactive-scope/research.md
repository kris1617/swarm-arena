---
change_id: confirm-run-history-retroactive-scope
topic: "Roadmap slice S-37 grounding — formally closing Open Roadmap Question #4"
researcher: Claude Sonnet 5
date: 2026-11-17
status: complete
---

# Research: Confirm per-run history scope is forward-only (roadmap slice S-37)

## Question

Open Roadmap Question #4: "Should F-05's per-run history persistence apply
retroactively to already-archived runs, or only to runs that complete
after it ships?" The roadmap's own text already states the default
resolution — forward-only — but this slice must verify that the shipped
UI actually reflects that intent accurately, not just that the backend
behaves that way.

## Summary

The forward-only behavior is confirmed safe and intentional: `history`
is a nullable column added via a bare `ADD COLUMN` migration with no
backfill, written only at the two terminal-stop call sites inside
`finishRun`, and read back with a guarded null-check everywhere it's
consumed server-side. Every UI surface that touches `history` has its
own accurate, specific empty-state message — **except one**: the run-
analysis page's "Final genetic diversity" scalar stat has no guard at
all and silently renders `0.000` for a history-less run, which misleads
a reader into thinking the run measured zero genetic diversity rather
than "no data was ever recorded for this run." This is a real, reachable
bug — 7 of 16 `status='stopped'` rows in the current dev database have
`history IS NULL` and would trigger it today (e.g. run ids 41, 42, 73,
74, 75, 12893).

## Detailed findings

### 1. Schema and write-site safety (confirmed forward-only)

`simulationRuns.history` (`src/server/db/schema.ts:140-150`) is
`d.text({ mode: "json" })` — nullable, no default. Its own in-file
comment already documents the forward-only intent: "null until a
terminal stop writes it... not backfilled for rows that stopped before
this column existed." The migration that added it,
`drizzle/0004_colorful_slyde.sql:1`, is a bare
`ALTER TABLE ... ADD "history" text;` with no backfill `UPDATE` —
confirmed as the only migration touching this column (grepped all of
`drizzle/*.sql`).

The only write site is `finishRun()` in
`src/server/simulation/server-run-registry.ts:382-443`
(`db.update(...).set({ ..., history: outcome.history ?? null })`,
lines 419-427), called from exactly two terminal-stop paths: `tick()`'s
natural-completion branch (`:508-520`) and `stopServerRun()` (`:617-629`).
A third call site, `tick()`'s catch block (`:527`), omits `history`
entirely, so it's written as `null` via the `?? null` fallback on the
tick-error path — matching the schema comment. No migration, seed
script, cron job, or lazy-write-on-read logic was found anywhere in
`src/server/` that would backfill an old row.

### 2. Server-side read sites are all null-safe

`getRunAnalysis` (`src/server/api/routers/simulation.ts:794-869`) casts
`run.history` and additionally validates its shape
(`Array.isArray(rawHistory.phaseHistory) && Array.isArray(rawHistory.survivorGenes)`,
`:814-841`) before trusting it — a malformed or legacy row collapses to
`history: null` rather than throwing. `getRunsComparison` (`:877+`,
history-dependent `breakdown` computed at `:925-956`) uses the same
guarded-cast pattern. `listLeaderboard` (`:714`) strips the raw column
from its response entirely, using it only to compute a boolean
(`scoredWithAreaFactor`) that defaults to `false` on null. No server-side
read site throws or returns `undefined` for a missing history.

### 3. UI empty-states — accurate everywhere except one scalar

`src/app/runs/[runId]/page.tsx` (the run-analysis view) handles a null
`history` with its own specific, accurate message in every section
except one:

| Section | History-null behavior |
| --- | --- |
| Run optimization suggestion | "Not enough data in this run to suggest a change." (`:139-143`) |
| Population chart | "No population data recorded for this run." (`:148-180`) |
| Genetic-diversity chart | "No genetic-diversity data recorded for this run." (`:185-201`) |
| Phase-tally list | "No phase data recorded for this run." (`:206-225`) |
| Completed resilience cycles | "No completed crash→recovery cycles in this run." (`:230-240`) |
| **Final genetic diversity (scalar)** | **No guard at all** (`:244-246`) — always renders `{finalGeneticDiversity.toFixed(3)}`, which the backend (`simulation.ts:857-859`) computes as a literal `0` when `history` is falsy, so a history-less run displays `0.000` indistinguishable from a genuinely zero-diversity run. |

The backend's own null-safe-defaults pattern (`completedCycles: []`,
`finalGeneticDiversity: 0`, `runOptimizationSuggestion: { status:
"insufficient-data" }`, `:854-867`) is exactly why this one field slips
through: `0` is a plausible real value for genetic diversity, unlike an
empty array or a sentinel status string, so the frontend's existing
"check for empty/null and show a message" pattern — applied consistently
everywhere else on this page — was never applied here, because `0` isn't
falsy in the same way `null`/`[]` are for the other fields' guards.

No food-ratio chart exists anywhere in the codebase (confirmed via grep,
not assumed) — `foodRatioSamples` exists only in the backend type and is
never rendered, so it has no empty-state concern.

### 4. Other surfaces — none need the forward-only guard, confirmed by inspection

- **Dashboard** (`src/app/dashboard/page.tsx`): never reads `history`
  (confirmed via repo-wide grep — this file is not among the 3 files
  referencing `history`). Its own empty/error states are unrelated.
- **Run-comparison** (`src/app/runs/compare/page.tsx`): does not read
  `history` at all — `getRunsComparison`'s `OkRow` type (`:46-65`) has
  no history field. It has its own, unrelated legacy-run caveat (pre-
  area-factor scoring comparability, `:140-148`), but nothing calls out
  history-less runs specifically — nothing crashes or renders blank
  either, since the field is never touched.
- **Leaderboard** (`src/app/leaderboard/page.tsx`): confirmed (not
  assumed) to show only final scores; `history` never appears in this
  file via grep.
- **Run-export** (`src/server/simulation/run-export.ts`): JSON mode
  includes `history: null` verbatim for an old run (`:81-93`) — no
  crash, accurate representation. CSV mode omits `history` from
  `CSV_COLUMNS` entirely (`:32-52`, `:65-73`) — a permanent product
  decision per its own comment (cites PRD FR-017), not specific to old
  runs.

### 5. Real database evidence

Direct, read-only inspection of the local dev database
(`db.sqlite`, table `.bootstrap-scaffold_simulation_run`) confirms this
is not a theoretical edge case: of 16 rows with `status='stopped'`, **7
have `history IS NULL`** (ids 41, 42, 73, 74, 75, 12892, 12893) — real,
navigable examples of the "old run, no history" case this slice is
about. (Id 12892 is an unusual case where `stoppedAt` is also null;
41/42/73/74/75/12893 are clean "truly terminal, no history" examples.)

## Response guidance — verified / corrected

- **"Resolved by default: forward-only"** — confirmed accurate and safe;
  no backfill path exists anywhere, by design, matching the schema's own
  comment.
- **"Verify the empty-state is accurate, not misleading"** — this is
  where the real finding is: the roadmap question's framing assumed a
  binary "is there a bug or not," but the actual answer is "mostly no,
  with one specific, real bug" — the Final genetic diversity scalar.
  This is a concrete UI defect worth fixing as part of closing this
  question, not just a verification-only confirmation.

## Open items for `/10x-plan`

- Decide the exact fix for the Final genetic diversity display: an
  explicit `history ? value.toFixed(3) : "No data recorded"`-style guard
  (matching the page's own existing pattern for every other section), or
  a different presentation (e.g. an em-dash or a tooltip) — this is a
  small, low-risk UI fix, not a new feature.
- Decide whether to add a one-line note to Open Roadmap Question #4's
  entry in `roadmap.md` pointing at this research's finding (useful for
  anyone who reads the roadmap question text alone without opening this
  change folder).
