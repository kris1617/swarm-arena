# Evidence: discussion
Sources: gh usable (kris1617/swarm-arena, public) + git-only. Window 2026-11-04..HEAD (whole 16-day history). No limits hit (3 PRs, 0 issues total — small enough to read whole).

## Buzz per capability
| cap | PRs | human review | reverts | 2nd-attempt scopes (git) | plans (archive) | TODO/FIXME |
|---|---|---|---|---|---|---|
| test | 0 forge PRs | n/a | 0 | parameter-sweep-corpus-generation(14), vitest-parallel-flakiness(14), analytics-correctness-corpus-tests(14), ci-quality-gates fix×2, test-plan-refresh×4 | ~10+ change folders | 0 |
| sim | 1 forge PR (#2, merged, 0 reviews) | none | 0 | genetic-inheritance-crossbreeding(14, fix×2), per-tribe-behavior-weights(11) | several | 2 |
| stage | 0 | n/a | 0 | unwatched-run-tick-throttling(13), simulation-start-button-not-submitting fix×2 | several | 0 |
| infra | 0 | n/a | 0 | fix(deploy)×6, fix(security-hardening-pass)×2, fix(middleware-static-asset-exclusion)×2, fix(ci)×2 | — | 0 |
| admin | 0 | n/a | 0 | pre-existing-admin-settings-flakes(12), fix(admin-settings-range-backfill)×2 | several | 0 |
| data | 0 | n/a | 0 | full-score-save-resume(11) | several | 0 |
| fb | 0 | n/a | 0 | in-app-feedback-module(10) | several | 0 |
| auth | 0 | n/a | 0 | google-style-auth-ux impl-review 4+plan-review 3 verdicts | several | 0 |
| rev | 1 forge PR (#10, closed-unmerged, deliberate fail demo) | github-actions bot only | 0 | n/a | ci-cd-code-review impl-review: 5 verdict hits | 0 |

Forge is near-silent: 3 PRs total, 0 issues. PR #1 (predator-prey, merged, 9342/141 lines, 0 reviews) and PR #2 (parallel-sim-switching, merged, 959/24 lines, 0 reviews) are large, unreviewed, self-merged landings — not evidence of review, just a record of what landed. PR #10 is a deliberately-failing demo of `tools/ai-reviewer` itself (closed, not merged) — its "fail" comment is the tool under test reviewing itself, not product review.

## Friction
- **No reverts, no hotfix-labeled commits anywhere in 800 commits** (grep for `revert`/`fixup`/`hotfix` subjects: 0 hits). Team-size baseline: 1 human author (two git identities, same person) — a solo project; "no revert" here reads as small-batch fix-forward discipline, not absence of problems (false-signal rule 6: report relative to team of 1).
- **Second-attempt friction concentrates in `test` and `sim`**: `parameter-sweep-corpus-generation`, `vitest-parallel-flakiness`, `analytics-correctness-corpus-tests` each touched 14 times; `genetic-inheritance-crossbreeding` 14 times with 2 explicit `fix(...)` commits. `lessons.md` independently confirms both as *recurring* (not one-off): a named flaky test in `simulation.test.ts` (`adjustLivePopulation` off-by-one) and CI-runner timing variance hitting throttle-window tests across multiple unrelated phases.
- **`infra`/deploy drew 6 separate `fix(deploy)` commits** — per false-signal rule 5 (trial-and-error fix ratio), iterative deploy-pipeline fixing is how that work is normally done; not ranked as a broken capability on fix-count alone, but still the single largest same-scope fix cluster.
- **`admin` flakiness is pre-existing and acknowledged in its own commit scope name** (`pre-existing-admin-settings-flakes`, 12 touches) — admin-settings range backfill needed 2 explicit fixes plus a dedicated flake-cleanup pass.
- **Closed-unmerged PR**: #10, by design (deliberate "do not merge" demo) — not product friction, counted as mechanical.

## Planning attention
`context/archive/` holds 95 closed change folders, each with its own `plan.md`/`change.md`, and most carry both a `plan-review.md` and an `impl-review.md` — this is where real review lives (per the brief's substitution rule). Verdict-marker density (REJECTED/NEEDS ATTENTION/CRITICAL hits) ranks review attention, independent of commit-count:
- `ci-cd-code-review` (rev) — 5 hits in impl-review, the single highest.
- `google-style-auth-ux` (auth) — 4 (plan-review) + 3 (impl-review) = 7.
- `per-tribe-behavior-weights` (sim) — 4 + 3 = 7.
- `analytics-correctness-corpus-tests` (test) — 4 + 3 = 7.
- `in-app-feedback-module` (fb), `corpus-generation-harness` (test), `parameter-sweep-corpus-generation` (test), `genetic-diversity-trend` — 3–4 each.
- The 2026-11-20 UI-refresh batch (leaderboard, dashboard, admin-pages, reference-pages, runs-analysis-compare, login-page-oauth-polish) each carry 2 impl-review hits — a late, uniform restyle pass across nearly every user-facing capability, same day, same cause (the `/10x-ui` chain run repeatedly) — count once as a single restyle initiative, not per-capability signal (false-signal rule 4, shared cause).

`lessons.md` (143 lines, append-only) has independently recorded 2 confirmed-recurring entries so far: (1) bare `setInterval` jobs missing try/catch, caught twice (feedback retry-worker, then sim's orphan-sweep) — a cross-capability pattern, not one capability's debt; (2) CI-runner timing variance in `simulation.test.ts`/throttle-window tests, confirmed recurring same-day across two different phases.

## Debt markers
`rg -c 'TODO|FIXME|HACK|XXX'` over each capability's tracked source dirs: effectively zero everywhere — only `src/server/simulation` has any (2 hits), every other scanned capability (`stage`, `data`, `admin`, `fb`, `auth`, `shell`, `dash`, `lead`, `ra`, `ref`, `test`, `rev`) returned 0. Debt is not marked inline in this codebase; it lives in `lessons.md` and change-folder reviews instead (prose, per false-signal rule 8).

## Mechanical signals
- PR #1 and #2's "0 reviews" is not evidence of low scrutiny — this project's real review step is `/10x-impl-review`/`/10x-plan-review` writing to `context/changes/.../reviews/`, which both PRs' underlying change folders have; GitHub review count under-counts on principle here.
- PR #10's "fail" verdict and comment are from `github-actions` (the project's own `tools/ai-reviewer` bot being demoed) — excluded as non-human per false-signal rule 7.
- The 2026-11-20 same-day UI-refresh review cluster (6 capabilities, 2 hits each) is one initiative run across capabilities, not 6 independent friction signals (rule 4).
- `fix(deploy)` ×6 is iterative CI/deploy fixing, the normal shape for that work (rule 5), not demoted to risk.
- Change-id scope labels in commits (`p1`..`p5`, `epilogue`, `roadmap`, `archive`, `test-plan`) are this project's own 10x-toolkit phase/ritual vocabulary, not capability names — excluded from the friction ranking above even though they have very high raw counts (91, 86, 66, 64, 63...).

## Unknowns
- No production error tracker evidence found in this scan (Sentry/etc. not referenced in commits, PRs, or `context/foundation/*` read here) — out of scope per the brief, flagged per instruction.
- Issue tracking: `gh issue list` returned 0 — unknown whether bugs are tracked at all outside `lessons.md`/change folders, or simply not yet needed at this project age (16 days).
- Did not open any `plan.md`/`impl-review.md` file bodies beyond grep counts (per contract: counts only, no reading) — verdict density is a proxy, not a read of actual severity text.

Commands run: `gh pr list --state all --json ...`; `gh issue list --state all --json ...`; `git log --format=%s` greps for revert/fixup/hotfix and `fix(scope)` and `(scope)` frequency; `grep -rlE/-icE 'REJECTED|NEEDS ATTENTION|CRITICAL'` over `context/{archive,changes}/*/reviews/*.md`; `rg -c 'TODO|FIXME|HACK|XXX'` per capability dir; `wc -l`/`grep -n`/`sed -n` on `context/foundation/lessons.md`; `ls context/archive | wc -l`.
