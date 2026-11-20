# Evidence: people

1 distinct human in window: Krzysztof Tatarczyk (798 commits, ktatar1@wp.pl) +
kris1617 (2 commits, GitHub UI identity) — confirmed same person per contract.
688/800 commits carry `Co-authored-by: Claude` (AI-assisted, still human-authored).
Baseline: single-person repo — every "who owns X" answer is the same person;
no bus-factor/concentration risk exists to find.

## People per capability
- All high/medium capabilities (sim, stage, data, admin, fb, auth, shell,
  dash, lead, ra/rc, test, rev, infra) are authored entirely by Krzysztof
  Tatarczyk. No second author anywhere in window. Topic groups come from
  commit-subject vocabulary already in capabilities.tsv (per-tribe-*,
  admin-ranges-*, test-plan-*, etc.) — same person across all of them,
  active continuously 2026-11-04..2026-11-20 (whole window).

## Recency check (evidence, last touch per path, window=2026-11-04..HEAD)
- Actively churning right now (commits dated 2026-11-20, i.e. today):
  sim, stage, admin, login/auth-ux, shell (ui), dash, lead, ra, tests, infra.
- Cooling but not cold: data-model (2026-11-19), auth core (2026-11-19).
- Coldest capability: feedback-module — last touch 2026-11-16 17:53, 6
  commits total in-window, none since. In a 16-day-old repo a 4-day gap is
  not evidence of abandonment, just lower churn than the rest; flag as the
  one capability with no recent activity, not as a risk.
- `tools/ai-reviewer` (new module): exactly 2 commits, 2026-11-17 14:32 and
  2026-11-18 03:42 — built as one concentrated ~13-hour burst (feat then a
  same-day-ish fix for security/robustness: prompt injection, job timeout,
  stale plan text), not spread over the window. Same single author.

## Concentration — against the baseline
Team size = 1 (false-signals rule 6: ≤3 humans → concentration is the
baseline, not a finding). Every capability is "only one person has ever
touched" — that is the whole team, not a gap. No capability is more or less
concentrated than any other; skip bus-factor language entirely.

## Agent co-authorship
688/800 commits (86%) repo-wide carry a Claude co-author trailer. No
capability-level split was computed (would require per-path trailer
grep beyond this budget) — treat 86% as a repo-wide baseline applying
roughly evenly; no capability stood out as human-only or agent-only in the
commit subjects sampled (sim, admin, test, infra, auth, ai-reviewer all show
the trailer pattern in recent subjects).

## Implications
- There is exactly one person to ask about any capability: Krzysztof
  Tatarczyk. "Whom to ask" reduces to "what has this person already tried" —
  read their own change folders in `context/changes/` and `context/archive/`
  for the relevant capability before proposing a change, since they are both
  author and institutional memory.
- For `tools/ai-reviewer`, read both of its two commits (feat + fix) — the
  whole module's history fits in one sitting.
- `feedback-module` is the one area with no very-recent commit; worth a
  freshness check (does it still match the current GitHub API, token scopes)
  before extending it, precisely because nothing has touched it in 4 days.

## Unknowns
- No formal ownership doc exists (CODEOWNERS, team roster) — team size and
  "who's still on the project" inferred from git authorship only, not from
  any HR/roster source.
- Per-capability agent-co-authorship percentage not computed (only repo-wide
  86%); if the synthesis needs a precise per-capability split, re-run with a
  per-path `--grep` pass.

Commands run:
- `git log --since=2026-11-04 -1 --format=%ad --date=format:%Y-%m-%d\ %H:%M -- <path>` per capability path
- `git log --since=2026-11-04 --format=%ad --date=format:%Y-%m-%d\ %H:%M -- tools/ai-reviewer`
- `git log --since=2026-11-04 --oneline -- src/server/feedback src/components/feedback-sheet.tsx | wc -l`
- read `context/map/.work/{scan-contract.md,capabilities.tsv,git-log.txt}`
