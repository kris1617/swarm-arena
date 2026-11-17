# Evidence: history

Window: since first commit (repo ~13 days old). Buckets: week. Commits counted: 542
(all, merges excluded — none exist). Excluded: 0 bots, 0 separate-agent-identity
commits (Claude assistance recorded via `Co-Authored-By` trailer, kept as human
commits per contract). `package-lock.json` changes dropped from counts.

## Activity per capability (evidence)
commits / file-changes, most-active first:
sim-engine 100/275, staging-live-view 52/106, testing-infra 21/35, data-model 17/50,
app-shell-design 15/27, platform-infra 12/16, run-analysis 11/12, run-comparison 7/7,
admin-governance 6/10, leaderboard 5/5, dashboard 5/5, legacy-scaffold 4/6,
auth-signin 4/4, reference-docs 3/7, feedback-module 1/2.
**docs-planning 511/1356 commits/changes — mechanical** (rule 8): nearly every
commit touches `context/foundation/roadmap.md` or a `context/changes/*/plan.md`
because the 10x workflow writes progress there on every step; excluded from
ranking, reported for completeness.
Unmapped: 137/2060 changes (6.7%, under contract's 10% fold-in threshold) — plumbing
(`package.json` 11, `vitest.config.ts` 8, `.env.example`/`src/env.js` 7 each,
`src/server/auth/config.ts` 6, `src/server/api/trpc.ts` 5, `src/components/app-shell.tsx`
4, `src/server/api/root.ts` 4, `biome.jsonc` 4) plus an uncovered feedback-module
slice (`src/server/feedback/retry-worker.ts`, `send-report.ts`, `elevation.ts` —
not in capabilities.tsv; **gap**, not noise).
Agent-assisted share: 493/542 commits (91%) carry a Claude co-author trailer.

## Top files in top capabilities
sim-engine: `simulation.ts` router (43), `simulation.test.ts` (42), `server-run-registry.ts`+test (23/22), `boids.ts` (22).
staging-live-view: `simulation-canvas.tsx` (31), `simulation/page.tsx` (17), `simulation-canvas.test.tsx` (13).
testing-infra: `scripts/corpus/harness.ts`+test (6/6), `generate-sweep.ts` family (5,5,4).
data-model: `schema.ts` (14), `drizzle/meta/_journal.json` (11, mechanical — rule 3, every migration regenerates it).

## Trend (inference — only 3 weekly buckets exist: W45 (repo birth, 3 commits), W46 (548 across caps, bootstrap+build-out week), W47 (partial, to date))
sim-engine: W45=0, W46=75, W47=25 — **fading** off a build-out spike, not yet enough data to call steady-state.
staging-live-view: W45=0, W46=51, W47=1 — **fading sharply**; UI build-out concentrated in W46.
testing-infra: W45=0, W46=2, W47=19 — **rising**; matches the M3-lesson test-plan rollout (`test-plan`, `testing-*` change-ids) landing in W47.
data-model/app-shell-design/platform-infra: all front-loaded in W46, near-zero W47 — consistent with scaffold-then-stabilize, not an ongoing trend.
**Caveat**: 3-point week series on a 13-day-old repo — label all of the above low-confidence, not a mature trend.

## Fix pressure (heuristic: subject matches `fix|bug|hotfix|revert|regression|broken|incident`, case-insensitive; 0 reverts found by subject text)
platform-infra 7/12 (58%) — mechanical per rule 5 (deploy/CI fixed by iteration: "make pipeline green", "pass auth secrets through", "placeholder DATABASE_URL at build time" — all deploy-env plumbing, not product defects).
testing-infra 8/21 (38%) — test-harness hardening (gzip writes, budget widening, flake cleanup), same iteration pattern as rule 5 for test infra.
admin-governance 2/6 (33%), dashboard 2/5 (40%) — small base, not meaningful.
run-analysis 3/11 (27%), sim-engine 22/100 (22%), staging-live-view 10/52 (19%) — real product fix volume; sim-engine subjects include genuine logic fixes (per-tick array growth, dense-clustering fallback, live-parameter field-set swap), staging-live-view subjects are UI-state bugs (stale viewer, stale error) plus some restyle "fix landmark" commits (rule 5-adjacent, UI polish).
Cross-cutting fix commits: 39/71 fix commits touch ≥2 capabilities, but 34 of those are only cross-cutting because `docs-planning` (plan.md) rides along — only **5** fix commits are genuinely cross-cutting between two product capabilities (shared-cause rule 4).
0 reverts by subject-text match.

## Co-change between capabilities (support ≥3, confidence = support ÷ less-active side's commits; docs-planning pairs are mechanical per rule 8 and excluded from ranking)
sim-engine <-> staging-live-view: support=28, confidence(vs staging-live-view)=54% — real coupling (shared router + canvas/live-param wiring).
data-model <-> sim-engine: support=10, confidence(vs data-model)=59% — schema changes mostly land with sim-engine work.
run-comparison <-> sim-engine 4 (57%), admin-governance <-> sim-engine 4 (67%), leaderboard <-> {run-comparison,sim-engine} 3 each (60%) — sim-engine is the hub every downstream read-surface change rides on.
All `docs-planning <-> X` pairs (sim-engine 92, staging-live-view 45, testing-infra 16, data-model 15, app-shell-design 15, run-analysis 11, etc.) are workflow lockstep (rule 3/8) — not reported as risk coupling.

## Hub files and freshness
Real hubs (excl. docs-planning/plumbing noise, partners seen ≥2 commits), all confirmed present at HEAD (`git cat-file -e HEAD:<path>` — no deleted/moved hot files):
- `src/server/api/routers/simulation.ts` / `.test.ts` — 9/8 distinct capability partners (leaderboard, run-comparison, staging-live-view, admin-governance, reference-docs, data-model, app-shell-design, testing-infra). This is the tRPC router for the whole simulation domain — genuine fan-in, not mechanical.
- `src/server/db/schema.ts` — 5 partners; expected (shared data model).
- `src/server/simulation/parameter-ranges.ts` — 5 partners (staging-live-view, admin-governance, reference-docs, data-model) — admin-set ranges feeding every surface that displays/validates parameters.
- `drizzle/meta/_journal.json` — mechanical (rule 3): regenerated by drizzle-kit on every schema migration, guarded by the toolchain.
- `.env.example`, `src/env.js`, `src/server/api/root.ts`, `src/server/auth/config.ts` — unmapped plumbing files that showed as apparent hubs because `match_cap()` returns none for them; real signal is "every new env var / router / auth config touches these", expected for a T3 app, not a risk.

## Mechanical signals
- `docs-planning` dominance (511/542 commits, 94%) — workflow-write lockstep (rule 8), excluded from activity/co-change ranking.
- `drizzle/meta/_journal.json` churn — generated snapshot, build-guarded (rule 3).
- Fix-ratio spikes in `platform-infra` and `testing-infra` — iteration-fix pattern (rule 5), not defect density.
- 2 author identities (same person) — concentration stats not meaningful (contract note); not reported as an ownership risk.
- Apparent hub status of `.env.example`/`src/env.js`/`root.ts`/`auth/config.ts` is an artifact of being unmapped in capabilities.tsv, not true architectural fan-in.

## Unknowns
- Co-change cannot show capability pairs that *should* move together but don't: no evidence either way on whether `admin-governance`'s parameter-range writes and `staging-live-view`'s client-side validation ever drift (no hand-kept frontend twin pattern detected, but absence-of-evidence here, not confirmed safe).
- `feedback-module` capability is under-specified in capabilities.tsv: `retry-worker.ts`, `send-report.ts`, `elevation.ts` (7 total changes) land as unmapped rather than attributed — true feedback-module activity is higher than the 1 commit / 2 changes reported above.
- 3-week trend window is too short to distinguish "fading after launch spike" from "between-phase lull before the next feature push" for sim-engine/staging-live-view.
- No revert-driven spillover found to trace (0 reverts by subject-text match) — cannot rule out revert-like fixes with non-matching subject wording.

## Commands run
- `wc -l` / `head` on `context/map/.work/git-log.txt`
- custom read-only Python parse of `git-log.txt` against `capabilities.tsv` (prefix+glob matching, weekly ISO-bucketing, fix/revert regex, co-change pair counting, hub-file partner counting) — no source files opened
- `git cat-file -e HEAD:<path>` for every file named above (freshness check)
