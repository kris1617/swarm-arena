# Archive SHA Repoint — predator-prey-dynamics

- **Date**: 2026-11-11
- **Target**: origin/master @ 145db9e4e6330a47bac683aa877cf34892fc986b
- **Integration commit**: 210dcf716e8be3011c7d848cd1451b747c02bad0 "Predator-prey dynamics (S-02) (#1)"
- **Association**: GitHub PR #1 (https://github.com/kris1617/swarm-arena/pull/1), base `master`,
  squash-merged. `gh pr view 1 --json commits` lists all 3 original phase-commit SHAs below
  exactly among its commits; the merge commit is their squash.
- **Evidence**: all 3 original SHAs resolved to real commit objects but failed
  `git merge-base --is-ancestor <sha> origin/master` (exit 1) — not reachable from `master`,
  consistent with the feature branch `feature/predator-prey-dynamics` having been
  squash-merged and then deleted. `210dcf7` is confirmed an ancestor of `origin/master`
  (exit 0).
- **Decision**: User approved "Update and archive" via `/10x-archive`'s repoint prompt.
- **Affected rows**: 14 total.

| Row ID | Old suffix (resolved OID) | New SHA |
| --- | --- | --- |
| 1.1 | 0cafe2f (0cafe2fb2d3a9eee9663667feab29cddeb81aca8) | 210dcf7 |
| 1.2 | 0cafe2f (0cafe2fb2d3a9eee9663667feab29cddeb81aca8) | 210dcf7 |
| 1.3 | 0cafe2f (0cafe2fb2d3a9eee9663667feab29cddeb81aca8) | 210dcf7 |
| 1.4 | 0cafe2f (0cafe2fb2d3a9eee9663667feab29cddeb81aca8) | 210dcf7 |
| 1.5 | 0cafe2f (0cafe2fb2d3a9eee9663667feab29cddeb81aca8) | 210dcf7 |
| 1.6 | 0cafe2f (0cafe2fb2d3a9eee9663667feab29cddeb81aca8) | 210dcf7 |
| 1.7 | 0cafe2f (0cafe2fb2d3a9eee9663667feab29cddeb81aca8) | 210dcf7 |
| 1.8 | 0cafe2f (0cafe2fb2d3a9eee9663667feab29cddeb81aca8) | 210dcf7 |
| 2.1 | de94ca4 (de94ca438773627c8c42efd1d9567d76628a7e7c) | 210dcf7 |
| 2.2 | de94ca4 (de94ca438773627c8c42efd1d9567d76628a7e7c) | 210dcf7 |
| 2.3 | de94ca4 (de94ca438773627c8c42efd1d9567d76628a7e7c) | 210dcf7 |
| 3.1 | 5e0a9d8 (5e0a9d89df20fa30fde5af86e4a8b802af9202ac) | 210dcf7 |
| 3.2 | 5e0a9d8 (5e0a9d89df20fa30fde5af86e4a8b802af9202ac) | 210dcf7 |
| 3.3 | 5e0a9d8 (5e0a9d89df20fa30fde5af86e4a8b802af9202ac) | 210dcf7 |

Rows 3.4–3.6 (manual verification) carry no SHA suffix by convention and are unaffected.
