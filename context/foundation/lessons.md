# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Side-fixes found mid-implementation ride along in the current commit

**Context**: .gitignore:39 (found during ui-simulation-tokens Phase 1)
**Problem**: Confirmed harmless and correctly scoped (.env_* requires an underscore, so .env.example stays tracked) — a real security fix from earlier in this session, just unrelated to this change-id's own stated scope.
**Rule**: When a genuine bug/gap is discovered while implementing an unrelated change, fix it immediately and document it clearly in the commit message rather than deferring — but call it out explicitly as a side-fix (not silently bundled) so a later review can distinguish it from the change's actual stated scope.
**Applies to**: All /10x-implement sessions — relevant whenever an agent notices something broken outside the current plan's file list.
