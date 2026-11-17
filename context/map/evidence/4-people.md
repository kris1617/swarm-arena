# Evidence: people

2 human author identities in the window (`kris1617`, `Krzysztof Tatarczyk`) — baseline per
false-signals rule 6, not a finding. `kris1617` appears only on 2 commits total (both
2026-11-11, both squash-merge PRs: #1 "Predator-prey dynamics (S-02)", #2 "Parallel
simulation switching (S-05)"), each touching many files/capabilities at once. All other 540
commits (2026-11-04 .. 2026-11-17) are `Krzysztof Tatarczyk`. Evidence: the two identities
are almost certainly the same person using a GitHub squash-merge PR flow early, then direct
commits for all later (agent-assisted) work — not two work contexts. 0 commits cross-cutting
dropped (none touched >half of all capabilities).

## Areas (high/medium criticality + top-5 by counted changes)
- docs-planning (511 commits) — not in the inventory's business-capability ranking, but by
  far the largest churn source (toolkit/context prose); confirms scan-contract's §Coverage note.
- sim-engine (100) — high criticality, core engine; largest *code* capability.
- staging-live-view (52) — high criticality, primary user-facing entry to sim-engine.
- testing-infra (21) — shared foundation.
- data-model (17) — shared foundation, high dependency fan-in.
- admin-governance (6), auth-signin (4) — high criticality but low volume (identity/access
  gating built once, touched rarely since).

## People per capability
All work (99%+ per capability) is `Krzysztof Tatarczyk`. One person, by topic group and period:

- **sim-engine** (98 commits, 2026-11-10..11-17): throttling/tick-loop mechanics
  (`unwatched-run-tick-throttling`), concurrent-load capacity scenarios
  (`testing-concurrent-load-capacity`), live-parameter adjustment, predator-prey/genetics rules.
- **staging-live-view** (50, 11-11..11-16): staged-vs-server-owned run controls (live boid
  count, crossbreeding toggle, area/camera view), per-tick genetics sampling.
- **data-model** (16, 11-04..11-17): schema migrations for nearly every new feature
  (admin elevation column, feedback table, world-size threading, capacity ceilings) — one
  person owns every migration.
- **app-shell-design** (14, 11-04..11-15): design-token/shadcn restyles across dashboard,
  analysis, comparison, login views; AppShell mount.
- **platform-infra** (12, 11-09..11-15): deploy/CI fixes (forwarded-host header,
  AUTH_TRUST_HOST, CI DB migration, build-env fixes), feedback rate-limiting.
- **run-analysis** (11, 11-14..11-17): corpus-correctness tests, null-history guards,
  genetic-diversity chart, changelog overlay.
- **admin-governance** (6, 11-14..11-15): temporary self-elevation feature end-to-end
  (schema → mutations → UI), parameter-range admin settings.
- Smaller capabilities (run-comparison 7, leaderboard 5, dashboard 5, legacy-scaffold 4,
  auth-signin 4, reference-docs 3, feedback-module 1): same person, single-sitting features.

`kris1617`'s 2 commits land in docs-planning, sim-engine, staging-live-view, data-model and
app-shell-design simultaneously (squash-merged PR content) — not a distinct topic group, just
the bootstrap-era PR flow before the agent-commit convention started.

## Concentration — against the baseline
2 humans in window → baseline per false-signals rule 6: "small team — concentration is the
baseline," no bus-factor language. Every capability listed above has in practice been
touched by exactly one person end-to-end (the `kris1617` commits are incidental/squashed, not
a second contributor's independent work). So: **every capability in this repo has only ever
been touched by one person** — stated as the baseline fact, not a risk.

## Agent co-authorship (context, not a filter)
High and fairly uniform across capabilities — most capabilities sit at 90-100% agent-coauthored
commits (sim-engine 94/100, staging-live-view 50/52, testing-infra 21/21, data-model 16/17,
app-shell-design 15/15, platform-infra 12/12, run-comparison 7/7, run-analysis 10/11,
leaderboard 5/5, legacy-scaffold 4/4, admin-governance 6/6, reference-docs 3/3,
feedback-module 1/1). docs-planning is 463/511 (~91%). dashboard is the outlier at 3/5 (60%)
— its early commits (post-login dashboard, run-analysis link) predate consistent
`Co-authored-by` trailer use. auth-signin is 3/4 (75%). Per the brief's rule, all of this
stays as human commits — the human steered every one.

## Implications
- Whom to ask before any change: one person, `Krzysztof Tatarczyk` (git identity), for every
  capability — there is no second human source to triangulate with.
- Read the per-change-id commit trail (`type(change-id): ...`) and the matching
  `context/changes/` or `context/archive/<change-id>/` folder rather than asking a person —
  that's the de facto design-doc trail this project already produces per change.
- `kris1617`'s two early squash-merge PRs (#1, #2) are the only GitHub PR-review surface in
  this repo's history; everything since is direct-to-`master` commits with no PR/review step.

## Unknowns
- No `CONTRIBUTING.md` or `CODEOWNERS` file exists (checked: absent at repo root and
  `.github/`). `gh api repos/kris1617/swarm-arena/collaborators` returns exactly one
  collaborator (`kris1617`, role `admin`), and `gh repo view` confirms the repo is private,
  owned by `kris1617`. So there is currently no formal ownership surface and no second team
  member to onboard — if a team forms later, both are needed from scratch (no existing
  convention to extend).
- Cannot confirm from git alone whether `kris1617` and `Krzysztof Tatarczyk` are literally the
  same person (git/GitHub identity only, no out-of-band confirmation) — treated as "almost
  certainly" per the scan contract's own framing, not verified identity.

Commands run: `python3 -I` parse of `.work/git-log.txt` against `.work/capabilities.tsv`
(per-capability author/date/subject aggregation, agent-coauthor share, cross-cutting-commit
check); `ls CONTRIBUTING.md CODEOWNERS .github/CODEOWNERS`; `gh api
repos/kris1617/swarm-arena/collaborators`; `gh repo view kris1617/swarm-arena --json
isPrivate,owner`.
