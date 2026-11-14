---
date: 2026-11-11T14:20:12+01:00
researcher: Claude Sonnet 5
git_commit: 107d53ce679b2d65834f9ca78b7102a0f20016ed
branch: master
repository: swarm-arena
topic: "/10x-ui two-way audit of src/app/simulation/page.tsx (ui-simulation-tokens)"
tags: [research, ui, tokens, components, simulation]
status: complete
last_updated: 2026-11-11
last_updated_by: Claude Sonnet 5
---

# Research: /10x-ui audit of the simulation view

**Date**: 2026-11-11T14:20:12+01:00
**Researcher**: Claude Sonnet 5
**Git Commit**: 107d53ce679b2d65834f9ca78b7102a0f20016ed
**Branch**: master
**Repository**: swarm-arena

## Research Question

Two-way design-system audit of `src/app/simulation/page.tsx` (+ `src/app/simulation/_components/simulation-canvas.tsx`) per `/10x-ui`: (1) source → views — where do token/component values live and which views actually read them; (2) view → source — for every literal in the view, which token/component should have covered it; (3) what do the repo's agent-rules files say about UI.

## Summary

This repository has **no design system at all**: `src/styles/globals.css` defines only `--font-sans`, there is no `src/components/` directory, no shadcn, no `components.json`. Every view (`src/app/page.tsx`, `src/app/login/page.tsx`, and the simulation view under audit) independently copy-pastes the same literal Tailwind values — most visibly a `bg-gradient-to-b from-[#2e026d] to-[#15162c]` page background (verbatim in 3 files) and a `rounded-full bg-white/10 ... hover:bg-white/20` pill-button class string (verbatim or near-verbatim in 5 locations). The simulation view additionally introduces two raw hex colors inside `<canvas>` drawing code that no Tailwind token could ever reach. `AGENTS.md`/`CLAUDE.md` contain no UI section — there is no existing rule to extend or to blame for the drift; it's simply never been written.

## Detailed Findings

### Source → views (where values/components live, who reads them)

- `src/styles/globals.css` (full file, 7 lines) — defines exactly one custom property, `--font-sans`, published via `@theme`. No color, spacing, or radius tokens exist anywhere in this repository.
- No `src/components/` directory exists (confirmed: `find src/components` returns nothing). No shared `Button`, `Input`, `Card`, or any other primitive.
- `components.json` does not exist — shadcn/ui was never initialized in this project.
- Because no token or shared component exists, **zero views read from a shared source** — every view's styling is independently authored, literal Tailwind utility strings.

### View → source (literals in the audited view, what should have covered them)

- `src/app/simulation/page.tsx:48` — `bg-gradient-to-b from-[#2e026d] to-[#15162c] ... text-white` — the exact same string (modulo one view's extra `gap-8 p-8`) appears at `src/app/page.tsx:13` and `src/app/login/page.tsx:5`. No token covers it because none exists.
- `src/app/simulation/page.tsx:81,92,102,112,122` — five form `<input>` elements, each independently styled `rounded-full bg-white/10 px-4 py-2 text-white` — no shared `Input` component exists to have covered this.
- `src/app/simulation/page.tsx:130` and `src/app/simulation/_components/simulation-canvas.tsx:204,222` — three `<button>` elements styled `rounded-full bg-white/10 px-10 py-3 font-semibold transition hover:bg-white/20` — byte-identical across all three. The same exact class string also appears at `src/app/login/page.tsx:19` and `src/app/_components/post.tsx:41` (grep count: 5 occurrences of this pattern repo-wide, 14 occurrences of the shorter `bg-white/10` substring repo-wide). No shared `Button` component exists to have covered this.
- `src/app/simulation/page.tsx:130-132` — the Start button has `disabled={startRun.isPending}` wired, but **no visual disabled styling** (no `disabled:opacity-*`, no `disabled:cursor-*`, nothing) anywhere in its class string — a user double-clicking it while the mutation is in flight gets zero visual feedback that the control is inert, the same gap a shared `Button` component with a disabled variant would have closed once, for every button, instead of per-instance.
- `src/app/simulation/page.tsx:137` — `<p className="text-red-300">{startRun.error.message}</p>` — a raw palette class (`red-300`), not a semantic `destructive` token; no token exists to reference instead.
- `src/app/simulation/_components/simulation-canvas.tsx:52` (`ctx.fillStyle = "#1e293b"`) and `:54` (`ctx.fillStyle = "#38bdf8"`) — raw hex colors inside imperative `<canvas>` drawing code. These **cannot be fixed by a Tailwind class at all** — canvas drawing needs the actual color *values* available in JS, not CSS classes — so even after a Tailwind token layer is introduced for the surrounding DOM, these two literals would remain disconnected from it unless the token values are also exported as plain JS constants.

### Agent rules

- `AGENTS.md` (full file) and `CLAUDE.md`'s non-toolkit section contain no UI-specific instructions anywhere — no rule says "use arbitrary values for precise designs" (the anti-pattern the skill warns about), but also no rule points an agent at tokens or a components directory, because neither exists yet. There is nothing to rewrite here, only something to add once the contract exists (see "Make it stick" in the `/10x-ui` skill).

## Code References

- `src/styles/globals.css:1-7` — the entire token source (font only).
- `src/app/simulation/page.tsx:48` — page background gradient literal.
- `src/app/simulation/page.tsx:81,92,102,112,122,130` — six duplicated input/button literals in this file alone.
- `src/app/simulation/page.tsx:137` — error text using a raw palette class.
- `src/app/simulation/_components/simulation-canvas.tsx:52,54` — raw canvas hex colors.
- `src/app/simulation/_components/simulation-canvas.tsx:197,204,222` — three more duplicated literals (canvas border, two buttons).
- `src/app/page.tsx:13,20,31` — the landing page's copies of the same gradient and pill-button literals.
- `src/app/login/page.tsx:5,19` — the login page's copies of the same two literals.
- `src/app/_components/post.tsx:34,41` — the T3-starter demo component's copies.

## Architecture Insights

- The duplication is exact and cross-view (not just within the simulation view), confirming this is systemic drift from the unmodified T3/create-t3-app starter defaults, not a one-off in this view. Fixing only the simulation view's literals without introducing a real token source would just add a fourth independent copy of the same values.
- Canvas-drawn content and DOM-rendered content need two different fix mechanisms for the same underlying problem (Tailwind classes for DOM, JS constants for canvas) — a plan here needs to account for both, or the canvas will silently diverge from whatever token values get chosen for the DOM.

## Historical Context (from prior changes)

- `context/changes/basic-flocking-loop/plan.md` (Phase 3) — built this view's original markup; its plan explicitly scoped styling as "same utility-class-direct style as `src/app/page.tsx`... do not reach for a design system or component library here," i.e. the duplication was a deliberate, documented deferral at the time, not an oversight — this change is the deferred work now coming due.

## Related Research

- None found under `context/changes/**/research.md` or `context/archive/**/research.md` that covers UI/design-system topics.

## Open Questions

- None blocking — the "no design system" variant's three conditions (flagged as a dependency decision, scoped to this view's tokens + components, loses to anything already in the repo) are all satisfiable since nothing currently exists to lose to; whether to add shadcn/ui vs. a lighter hand-rolled token+component set is a planning-time decision for `/10x-plan`, not a research gap.

## Charges

1. **[Missing tokens]** Page background/text color scheme (`bg-gradient-to-b from-[#2e026d] to-[#15162c] ... text-white`) is a literal Tailwind arbitrary-value string duplicated verbatim across 3 views (`src/app/simulation/page.tsx:48`, `src/app/page.tsx:13`, `src/app/login/page.tsx:5`), with zero token definitions anywhere in the repo to have covered it — a user sees an inconsistent app the moment any one view's color is tweaked without the other two, since nothing connects them.

2. **[Missing shared component]** The pill-button class string (`rounded-full bg-white/10 px-10 py-3 font-semibold transition hover:bg-white/20`) is duplicated byte-for-byte across 5 locations (`simulation/page.tsx:130`, `simulation-canvas.tsx:204,222`, `login/page.tsx:19`, `_components/post.tsx:41`), and the simulation view's own Start button (`page.tsx:126-132`) wires a `disabled` prop with **no disabled styling at all** — a user double-clicking "Start" while it's submitting gets no visual sign the button is inert, a gap a single shared `Button` component would close once for every instance instead of requiring every copy to remember it independently.

3. **[Missing tokens, canvas-specific]** `<canvas>` drawing colors (`#1e293b` background, `#38bdf8` boid fill — `simulation-canvas.tsx:52,54`) are raw hex literals that no Tailwind class can reach — a token layer introduced for the surrounding DOM would leave these two values silently disconnected unless the same values are also exported as JS constants the canvas code reads directly.

4. **[Missing tokens]** The error message (`simulation/page.tsx:137`, `text-red-300`) uses a raw palette class instead of a semantic `destructive` role — if the chosen token set's error color ever changes, this line won't follow it the way a `text-destructive` class would.

No accidental-architecture charge found for this view: unauthenticated access correctly redirects to `/login` (middleware-gated, not raw JSON or a blank frame), and the view's "no prior run" state correctly shows the parameter form rather than an empty list or placeholder — both of the explicit architecture questions the skill asks ("logged out", "no data") are already handled correctly by this view's existing entry-point design.
