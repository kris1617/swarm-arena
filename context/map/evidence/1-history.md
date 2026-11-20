# Evidence: history
Window 2026-11-04..HEAD (whole 16-day history), buckets=week (3 weeks: W45 partial, W46, W47 partial), 800 non-merge commits counted, 0 excluded (no bots, no agent-authored-by-field commits; 688/800 carry human-author + Claude co-author trailer, counted as human per contract).

## Activity per capability
(commits where cap touched / file-changes attributed; cross-cutting commits counted once per cap)
- docs 723 commits / 1705 changes — mechanical, see below
- test 234 / 431
- sim 100 / 157
- stage 72 / 95
- infra 26 / 200 (heavy: `.claude/.10x-cli-manifest.json` ×10 toolkit churn)
- data 25 / 82
- shell 24 / 41
- auth 21 / 36
- ra 11, unmapped 10, ref 10, rc 9, admin 8, ks 7, dash 7, lead 5, fb 5, rev 2 (new module, low volume so far)
Unmapped file-changes: 262/3106 = **8.4%** (root dotfiles, `root.ts`, `env.js`, lockfiles) — under the 10% refine threshold. Agent-authored share: 0% by author field (contract); AI-assisted-by-trailer share: 86% (688/800) — evidence, not inference.

## Top files in top capabilities
- sim: `boids.ts` 45, `server-run-registry.ts` 41, `single-run-lifecycle.ts` 19, `parameter-ranges.ts` 11
- test: `routers/simulation.test.ts` 57, `server-run-registry.test.ts` 42, `boids.test.ts` 39, `test-plan.md` 29
- stage: `simulation-canvas.tsx` 44, `simulation/page.tsx` 32, `server-run-viewer.tsx` 16
- docs: `roadmap.md` 138, `lessons.md` 20 (rest spread across per-change-id plan.md files — expected, one-shot per change)
- infra: `.10x-cli-manifest.json` 10, `deploy.sh` 5, `docker-compose.yml` 5
- data: `schema.ts` 22, `drizzle/meta/_journal.json` 19
- auth: `auth/config.ts` 8, `login/page.tsx` 6, `middleware.ts` 6

## Trend (commits/week per cap; weeks W45→W47)
sim 0,54,46 (constant-high); test 1,111,122 (**rising**); stage 0,45,27 (fading, early-window burst); infra 1,19,6 (fading — front-loaded setup/deploy work); docs 1,332,390 (rising, mechanical); shell 1,12,11 (constant); auth 0,10,11 (constant); data 1,14,10 (constant); ks/ref/rc/lead/admin: low, flat; rev 0,0,2 (new, too new to label).
No commit-subject campaign spikes found beyond the toolkit's own change-id naming (no single burst subject dominates a week).

## Fix pressure
Heuristic: subject matches `fix|bug|hotfix|revert|regression|broken|incident`. **Zero revert commits** in-window (grep for "revert" in subject found none).
- test 59 fix-commits/234 (25%) — mostly `impl-review fixes` / flakiness hardening, cross-cutting with sim/stage, not a broken capability.
- sim 20/100 (20%) — reviewed sample: impl-review follow-ups and orphan-sweep hardening (`fix-default-start-failure`), not thrash.
- infra 6/26 (23%) — per false-signals rule 5 (trial-and-error fix ratio for infra/deploy): sample subjects are `fix(deploy): ...` iteration-to-green (Host header, migrate step, secrets passthrough) — **mechanical, not ranked as risk**.
- stage/shell fix samples (rule 5, UI): mostly `impl-review fixes` + one real bug (`energyThreshold min/step mismatch`, with its own regression test) — mixed, one genuine fix kept, rest mechanical polish.
- auth 7/21 (33%) highest ratio but low volume; sample includes a real fix (`close open-redirect bypass`) — worth flagging to the report, not mechanical.

## Co-change between capabilities
(support = co-occurring commits among the 281 eligible 2..9-cap commits; 0 commits dropped for touching >half of 18 caps)
- docs×test 194 (conf test→docs 0.83); docs×sim 92 (conf sim→docs 0.92); **sim×test 92 (conf sim→test 0.92)** — real signal: sim code and its tests move together; stage×test 58 (conf stage→test 0.81); sim×stage 37; data×docs 23, auth×docs 20, data×test 20 (conf data→test 0.80).
- Every cap pairs heavily with **docs** (conf cap→docs is 0.89–1.00 for most) — this is the toolkit's own change-folder convention (one commit = code + its `plan.md`/`change.md`), not a real cross-capability dependency. Applying false-signals rule 4 (shared cause counted once): attribute this to the 10x-toolkit workflow, not to 18 separate "docs" relationships.

## Hub files and freshness
All hub files below exist at HEAD (`git cat-file -e`, none stale/deleted):
- `src/server/api/routers/simulation.ts` — 14 distinct partner caps (≥2 commits each) — tRPC router shared by nearly every feature; **config/registry fan-in (rule 2)**, cheap coupling, not ranked as fragile.
- `src/server/api/routers/simulation.test.ts` — 11 partners — mirrors the router (rule 3, workflow lockstep, test runs in CI).
- `src/server/db/schema.ts` (10 partners) + `drizzle/meta/_journal.json` (8 partners) — schema + its generated migration snapshot, classic lockstep guarded by drizzle-kit (rule 3).
- `context/foundation/roadmap.md` (7 partners) — prose hub, expected (rule 8, not a code risk).
- `package.json`/`package-lock.json` (6 partners each) — dependency-bump fan-in, mechanical (rule 1/2).
- Feature files (`simulation-canvas.tsx`, `boids.ts`, `server-run-registry.ts/.test.ts`, `parameter-ranges.ts`, `admin-settings-form.tsx`, `reference/parameters/page.tsx`) all show the same 7-cap partner set {docs,sim,stage,test,data,ref,admin} — this is one underlying fact (simulation parameters are shared across sim engine, live UI, admin config, and reference docs) counted once, not 7 separate findings.

What co-change cannot show (unknown): whether `src/styles/theme-colors.ts` (hand-kept, per AGENTS.md) is actually edited in lockstep with `globals.css` — both are low-volume (shell, 5–6 changes) so no co-change signal either way; AGENTS.md itself flags this as a manual-sync risk nothing enforces.

## Mechanical signals
- docs' near-universal co-change and 90%-of-commits presence: toolkit convention (one commit = code + change-folder prose), not architecture (rule 4).
- infra and stage/shell fix ratios: iteration-to-green and polish, not instability (rule 5).
- Router/schema/package.json fan-in: config-as-code and dependency bumps (rules 1, 2).
- No bot/agent-authored commits to exclude (contract already states 0).

## Unknowns
- Whether `theme-colors.ts`/`globals.css` drift in practice (too low volume for co-change signal; AGENTS.md names it as a hand-sync risk).
- `rev` (ai-code-review tool) has only 2 commits — too new to trend or assess fix pressure.
- No way from git alone to tell if the 0.92 sim↔test confidence reflects true TDD discipline or same-commit convenience; direction only (sim commits almost always include tests; test commits only 39% include sim).

Commands run: `git -c core.quotepath=off` log already captured upstream; this pass parsed `.work/git-log.txt` directly with a Python script (no additional git log commands needed) plus `git cat-file -e HEAD:<path>` for each hub-file freshness check (17 paths, all exist).
