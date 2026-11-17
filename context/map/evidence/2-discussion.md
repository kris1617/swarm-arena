# Evidence: discussion
Sources: gh usable (kris1617/swarm-arena, PRIVATE) but near-empty; primary source is git-only + this project's own planning-artifact convention (`context/changes/`, `context/archive/`). Window: whole history (13 days, 542 commits, 2 author identities = same person).

## Buzz per capability
| capability | plans (archive dirs) | impl-review verdicts | plan-review verdicts | debt markers (TODO/FIXME/HACK/XXX) |
|---|---|---|---|---|
| sim-engine | ~9 (flocking-loop, predator-prey, parallel-sim-switching, genetic-inheritance, spatial-hash-perf, spatial-grid-dense-clustering, phase-quality-scoring, server-side-sim-engine, admin-ranges-and-hook-flakes) | 9 approved, 2 NEEDS ATTENTION (parallel-sim-switching, genetic-inheritance) | mostly approved | 2 (only non-zero capability checked) |
| staging-live-view | ~6 (staging-live-view-restyle, live-parameter-adjustment, live-crossbreeding-toggle, live-boid-count-adjustment, client-staged-live-parameter-parity, correct-live-parameter-field-set) | all approved | approved | 0 |
| run-analysis / run-comparison / leaderboard | ~5 combined (run-analysis-view, compare-runs-side-by-side, leaderboard, area-aware-population-insight, genetic-diversity-trend) | area-aware-population-insight = REJECTED (impl-review); rest approved | approved | 0 |
| admin-governance | ~4 (temporary-admin-elevation, admin-ranges-and-hook-test-flakes, pre-existing-admin-settings-flakes, confirm-admin-elevation-mechanism-resolved) | approved, but 2 follow-on "flake"/"confirm resolved" changes opened against it | approved | 0 |
| testing-infra | ~9 (corpus-generation-harness [REJECTED], parameter-sweep-corpus-generation, testing-full-lifecycle-regression, analytics-correctness-corpus-tests [NEEDS ATTENTION], suggestion-quality-corpus-test, vitest-parallel-flakiness, testing-concurrent-load-capacity [NEEDS ATTENTION], testing-perf-baseline, testing-wallclock-optimization-guardrail) | 2 REJECTED/NEEDS-ATTENTION-heavy clusters here | mixed | n/a (fixtures, not scanned) |
| full-score-save-resume (persist-run-history / run-export area) | 1 (full-score-save-resume) | NEEDS ATTENTION | approved | 0 |
| docs-planning (toolkit itself) | dominant by commit count: `archive` 57, `roadmap` 42, `test-plan` 16, `epilogue` 46, `p1/p2/p3/p4` (plan-phase commits) 60/41/31/14 | n/a — this is process, not product | n/a | n/a |

## Friction
- **7 of 68 total review verdicts are not clean APPROVED**: 5 NEEDS ATTENTION, 2 REJECTED. REJECTED verdicts land on `area-aware-population-insight` (run-analysis/leaderboard cluster) and `corpus-generation-harness` (testing-infra) — both had to be redone after rejection (evidence: archived successfully, meaning a later pass passed review).
- **Second attempts, by naming convention, not reverts**: no literal `git revert` commits exist (0 in 542). Instead this repo's "second attempt" signal is a fresh change folder that explicitly targets a prior one: `2026-11-16-pre-existing-admin-settings-flakes` and `2026-11-16-admin-ranges-and-hook-test-flakes` (both against admin-governance/sim-engine), `2026-11-16-vitest-parallel-flakiness` (testing-infra), `2026-11-16-spatial-grid-dense-clustering-fallback` (sim-engine), and `2026-11-17-confirm-admin-elevation-mechanism-resolved` / `2026-11-17-confirm-run-history-retroactive-scope` (confirmation-only follow-ups, admin-governance / persist-run-history). That is 6 follow-on/retry change folders concentrated in **sim-engine + admin-governance + testing-infra**.
- `fix-production-trpc-error-logging` (2026-11-13) is the one phase-heavy remediation change: 6 separate `impl-review-phase-N.md` files for one change-id — unusually fragmented verification, suggesting this fix went through 6 distinct phases/attempts rather than one pass.
- Fix-commit share: 45 commits with a `fix` subject token across 542 total (~8%) — in line with normal iteration, not flagged as anomalous per false-signal rule 5 (not CI/deploy-only).
- No forge friction signal available: only 2 PRs exist total (`#1` predator-prey, `#2` parallel-sim-switching), both merged in the same minute window on 2026-11-11, almost certainly a one-time branch-protection experiment, not ongoing workflow. No open/closed-unmerged PRs, no issues (`gh issue list` returned empty).

## Planning attention
- `docs-planning` (the `context/` + `.claude/` toolkit) is the single largest discussion surface by raw commit-subject-token count — `archive` (57), `roadmap` (42), plan-phase tokens `p1`/`p2`/`p3`/`p4` (60/41/31/14), `epilogue` (46), `test-plan` (16). This is process bookkeeping (closing/archiving changes, roadmap maintenance), not code debate — reported per false-signal rule 8, not ranked as a hot *code* area.
- Two `test-plan-refresh-*` changes exist (2026-11-12, 2026-11-16) — the test strategy itself was revisited twice in 13 days, both closed/archived.
- Product capabilities with the most dedicated change folders: sim-engine and testing-infra (~9 each), staging-live-view (~6) — matches the "core value + its test harness" criticality already assigned in capabilities.tsv.
- `legacy-scaffold`, `reference-docs`, `run-export`, `feedback-module` have zero planning-attention follow-ups beyond their single initial change — consistent with their low/low-medium criticality rating; no discussion signal contradicts that.

## Debt markers
- Only `src/server/simulation` carries any TODO/FIXME/HACK/XXX markers at HEAD (2 total). Every other sampled capability (staging-live-view, run-analysis/runs, leaderboard, admin, routers, UI, dashboard) has zero. Too sparse to normalize meaningfully per 1000 lines — reported as raw counts; absence elsewhere is itself a (weak) finding, not proof of cleanliness, since debt can also hide as an unflagged shortcut.

## Mechanical signals
- `archive`/`roadmap`/`epilogue`/`p1`-`p4`/`test-plan` commit-subject volume (false-signal rule 8: prose/planning churn, not code activity) — excluded from "hot capability" ranking, attributed instead to docs-planning's own process overhead.
- The 2 merged PRs on 2026-11-11 are a one-time tooling trial (both same minute), not sustained forge-based review workflow — treated as a non-finding, per rule 4 (shared cause: branch-protection test, not ongoing practice).
- 0 reverts is expected given 0 bot/mass-commit exclusions and a single contributor with full history edit control (no shared-branch pressure forcing revert-over-amend) — not evidence of unusual stability.

## Unknowns
- No GitHub Issues used for dev tracking at all (`gh issue list --state all` empty) — bug/debt tracking lives entirely in `context/changes/`→`context/archive/` planning artifacts and `lessons.md`, not the forge.
- No production error tracker visible in this evidence pass (one archived change is literally titled `fix-production-trpc-error-logging`, implying a prior gap in production error visibility — but confirming whether a tracker now exists requires reading that change's body, out of scope here).
- Whether the 6 "flake"/"confirm resolved" follow-up changes fully closed their underlying issue, or just reduced the trigger (per `lessons.md`: "admin-ranges cross-process race is mitigated, not eliminated"), is not verifiable from headings alone.
- `lessons.md` has 13 recorded recurring-mistake entries project-wide (not one scanned per capability here) — several (tRPC subscriptions via createCaller, SQLite busy_timeout, ctx.db vs module singleton) imply sim-engine/testing-infra friction beyond what review-verdict counts alone show.

Commands run: `gh pr list --state all --limit 5`, `gh issue list --state all --limit 5`, `git log --oneline --all | grep -iE 'revert|hotfix'`, `git log --oneline | grep -icE 'revert'`, `git log --oneline | grep -icE '^[a-f0-9]+ fix'`, `git log --format='%s' | grep -oE '\([a-z0-9-]+\)' | sort | uniq -c | sort -rn`, `ls context/changes/`, `ls context/archive/`, loop over `context/archive/*/reviews/*.md` + `context/changes/*/reviews/*.md` with `grep -m 1 -oE 'APPROVED...|NEEDS ATTENTION|REJECTED'`, `grep -c '^## ' context/foundation/lessons.md`, `ls -d context/archive/*test-plan-refresh*`, `ls context/archive | sed -E 's/^[0-9]{4}-[0-9]{2}-[0-9]{2}-//' | sort | uniq -c`, `git ls-files <dir> | xargs grep -c 'TODO\|FIXME\|HACK\|XXX'` per capability sample.
