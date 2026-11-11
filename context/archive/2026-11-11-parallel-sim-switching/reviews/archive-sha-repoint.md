# Archive SHA Repoint — parallel-sim-switching

- **Date**: 2026-11-11
- **Target**: origin/master @ 145db9e4e6330a47bac683aa877cf34892fc986b
- **Integration commit**: 145db9e4e6330a47bac683aa877cf34892fc986b "Parallel simulation switching (S-05) (#2)"
- **Association**: GitHub PR #2 (https://github.com/kris1617/swarm-arena/pull/2), base `master`,
  squash-merged. `gh pr view 2 --json commits` lists all 3 original phase-commit SHAs below
  exactly among its commits; the merge commit is their squash.
- **Evidence**: all 3 original SHAs resolved to real commit objects but failed
  `git merge-base --is-ancestor <sha> origin/master` (exit 1) — not reachable from `master`,
  consistent with the feature branch `feature/parallel-sim-switching` having been
  squash-merged and then deleted. `145db9e` is confirmed an ancestor of `origin/master`
  (exit 0) — it is in fact `origin/master`'s current tip.
- **Decision**: User approved "Update and archive" via `/10x-archive`'s repoint prompt.
- **Affected rows**: 13 total.

| Row ID | Old suffix (resolved OID) | New SHA |
| --- | --- | --- |
| 1.1 | 1b68769 (1b68769952e97ba364e762db4ff2741725aecbef) | 145db9e |
| 1.2 | 1b68769 (1b68769952e97ba364e762db4ff2741725aecbef) | 145db9e |
| 1.3 | 1b68769 (1b68769952e97ba364e762db4ff2741725aecbef) | 145db9e |
| 1.4 | 1b68769 (1b68769952e97ba364e762db4ff2741725aecbef) | 145db9e |
| 1.5 | 1b68769 (1b68769952e97ba364e762db4ff2741725aecbef) | 145db9e |
| 1.6 | 1b68769 (1b68769952e97ba364e762db4ff2741725aecbef) | 145db9e |
| 1.7 | 1b68769 (1b68769952e97ba364e762db4ff2741725aecbef) | 145db9e |
| 1.8 | 1b68769 (1b68769952e97ba364e762db4ff2741725aecbef) | 145db9e |
| 2.1 | f6e5c1d (f6e5c1dcf7c9ef0cd2fc693cbcc536ec0366ebba) | 145db9e |
| 2.2 | f6e5c1d (f6e5c1dcf7c9ef0cd2fc693cbcc536ec0366ebba) | 145db9e |
| 3.1 | c5d851c (c5d851c7aecb4e4f46943e08db9fdd882f4ac49e) | 145db9e |
| 3.2 | c5d851c (c5d851c7aecb4e4f46943e08db9fdd882f4ac49e) | 145db9e |
| 3.3 | c5d851c (c5d851c7aecb4e4f46943e08db9fdd882f4ac49e) | 145db9e |

Rows 2.3, 2.4, 3.4–3.7 (manual verification) carry no SHA suffix by convention and are
unaffected.
