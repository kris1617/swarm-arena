<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Shared app shell and extended design tokens

- **Plan**: context/changes/ui-design-system-foundation/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2
- **Date**: 2026-11-14
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Plan's Phase 2 Contract wording understates its own Intent

- **Severity**: OBSERVATION
- **Impact**: LOW — no action needed
- **Dimension**: Plan Adherence
- **Location**: context/changes/ui-design-system-foundation/plan.md (Phase 2, "Contract"), src/app/login/page.tsx:7-8
- **Detail**: Phase 2's Contract line says "No prop/structural change — ... purely a className/content change," but its own Intent line, one paragraph above, explicitly anticipates "add branding text (e.g. an `<h1>` or logo-style heading above 'Sign in')." The implementation added a new `<h1>Swarm Arena</h1>` + `<p>Sign in to continue</p>`, which is a new DOM node (structural) by a strict reading of "no structural change," but is exactly what Intent called for. This is a self-contradiction inside the plan text, not an implementation defect — the agent resolved it in favor of Intent, correctly.
- **Fix**: None needed. If the plan is revisited, loosen Contract's wording to match Intent ("content/branding additions are in scope; no prop signature change").
- **Decision**: ACCEPTED (no plan edit needed post-hoc; archived as-is)

### F2 — Sign-in button's literal-color fix not itemized in plan's Changes Required

- **Severity**: OBSERVATION
- **Impact**: LOW — no action needed
- **Dimension**: Plan Adherence
- **Location**: src/app/login/page.tsx:20 (`bg-white/10 ... hover:bg-white/20` → `bg-input text-foreground hover:bg-foreground/35`)
- **Detail**: The plan's Phase 2 Intent only names the `<main>` gradient classes as the restyle target. The sign-in button's own literal-color classes (`bg-white/10`/`bg-white/20`) were also replaced with the token pattern. This wasn't itemized, but it directly fulfills the plan's Current State Analysis, which states AGENTS.md's "no literal colors" rule is "already violated by both of the files above" and that "this plan brings them into compliance ... not as a separate concern." The fix is in scope by the plan's own stated rationale, just under-itemized.
- **Fix**: None needed — correct outcome, matches dashboard/simulation's existing button token pattern exactly.
- **Decision**: ACCEPTED

## Success Criteria Verification

**Automated** (re-run during implementation, both phases): `npm run typecheck` PASS, `npm run check` PASS (exit 0; one pre-existing vendor warning in generated `sidebar.tsx`, unrelated to this plan), `npm test` PASS (209/209).

**Manual** (Phase 2, performed via dev server + Playwright by the implementing session): login page shows "Swarm Arena" branding/tokens/no sidebar when signed out; dashboard and simulation render inside the new sidebar shell with working nav and sign-out; tab title reads "Swarm Arena"; `/runs/compare` renders correctly inside the shell (its own "could not load" state is pre-existing/unrelated — no runIds query param, no runs exist yet for this user); sign-out correctly redirects to `/login`. All Progress checkboxes recorded as `[x]` with commit SHAs.

## Notes

- No undisclosed scope creep. `src/server/auth/actions.ts` was not itemized as a new file in the plan but is a necessary, disclosed consequence of moving `signOut` into a Client Component (`AppShell`) per Next.js's Server Function requirements — documented in its own code comment and the Phase 1 commit message.
- Zero literal hex/`bg-white`/`bg-black` values remain across all 5 changed files (grep-verified) — AGENTS.md's token-only rule is fully honored.
- Authorization: `session?.user` gating in `layout.tsx` is presentational only (shell chrome); actual route authz lives in `src/middleware.ts`, unaffected by this change.
