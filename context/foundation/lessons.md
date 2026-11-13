# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Side-fixes found mid-implementation ride along in the current commit

**Context**: .gitignore:39 (found during ui-simulation-tokens Phase 1)
**Problem**: Confirmed harmless and correctly scoped (.env_* requires an underscore, so .env.example stays tracked) — a real security fix from earlier in this session, just unrelated to this change-id's own stated scope.
**Rule**: When a genuine bug/gap is discovered while implementing an unrelated change, fix it immediately and document it clearly in the commit message rather than deferring — but call it out explicitly as a side-fix (not silently bundled) so a later review can distinguish it from the change's actual stated scope.
**Applies to**: All /10x-implement sessions — relevant whenever an agent notices something broken outside the current plan's file list.

## Verify a claimed commit-message fix is actually in that commit's diff

**Context**: commit aa5e0cf's message vs. src/server/simulation/boids.ts (basic-flocking-loop plan review, 2026-11-13)
**Problem**: A commit message claimed 5 bug fixes (unnormalized cohesion/alignment, no overlap floor, no cruise-speed floor, weak steering, duplicate distance computation) that weren't actually present in that commit's diff. The bugs were real and did eventually get fixed — just later, uncredited, as a side effect of an unrelated rewrite (S-02's predator-prey work), not by the commit that claimed them.
**Rule**: Before trusting a commit message's claimed fix (in a review, a changelog, or when deciding a bug is closed), verify the fix is actually present in that commit's diff — not just described in the message. A commit message is a claim, not evidence.
**Applies to**: /10x-impl-review and /10x-archive (when checking whether a plan's manual-verification claims hold); anyone writing a commit message — only describe a fix as done if its diff is in that same commit.
