---
topic: "/simulation's Start button click produces no mutation, no error, no navigation visible to React"
researcher: claude-sonnet-5
change_id: simulation-start-button-not-submitting
date: 2026-11-19
---

# Research: /simulation Start button not submitting

## Question

Why does clicking `/simulation`'s "Start" button never call `simulation.start`
(no network request, no console/pageerror output, `startRun.isPending` never
flips), while the page silently settles back to the exact same unchanged
config form?

## Answer

**Confirmed**: React's `onSubmit` handler on the form at
`src/app/simulation/page.tsx:932-937` never executes, by any trigger method —
not via a click on the `type="submit"` button, and not via pressing Enter in
a focused form field (which triggers the browser's native implicit-submit
path independent of any button-click code). Both were tested directly against
the running production build (`next build && next start`, the exact target
Playwright's `webServer` config in `playwright.config.ts` uses) with full
`console`/`pageerror`/`request` event listeners attached from page load —
zero output in either case beyond the expected initial page-load network
calls.

**Not yet confirmed**: the exact mechanism causing the handler to never
attach/fire. The evidence is most consistent with a **hydration failure
specific to the production build** silently detaching or never attaching
React's event delegation on this page, but this is the leading hypothesis,
not a verified root cause — no hydration warning or error appeared in the
console in either test, which is itself notable (Next.js production builds
typically still log a recoverable-hydration-error message via
`console.error`, even with dev-only verbose detail stripped).

## Detailed findings

### The code itself is correct on inspection

- `src/app/simulation/page.tsx:932-937` — the form's `onSubmit` is exactly
  `(e) => { e.preventDefault(); startRun.mutate(buildStartInput()); }`. No
  syntax issue, no missing `e.preventDefault()`.
- `src/app/simulation/page.tsx:1211-1217` — the "Start" button is
  `type="submit"`, `disabled={startRun.isPending}`, with no `asChild` prop,
  so `src/components/ui/button.tsx`'s `Button` renders it as a plain native
  `<button>` (confirmed via `Button`'s own source: `asChild` defaults
  `false`, `Comp = "button"` in that branch).
- `src/app/simulation/page.tsx:573-603` — `startRun`'s `onSuccess` calls
  `setActiveRun(...)`, and the page's render ternary at line 909
  (`{activeRun ? <SimulationCanvas .../> : <form>...`) correctly swaps to
  the canvas once `activeRun` is set. This matches the plan's/test's
  expectation that `activeRun` being set is what makes "Stop" appear.
- `startRun`'s `onError` (`page.tsx:599-601`) logs via `console.error` — if
  the mutation had even been attempted and failed, this would have appeared
  in the captured console output. It did not.

### DOM structure at the moment of the failed click is correct

Confirmed via `page.evaluate()` against the live DOM immediately after
`page.goto("/simulation")`:
- Exactly 1 `<form>` on the page, exactly 1 `<button>` with text exactly
  "Start".
- That button's `.closest("form")` returns the form — it genuinely is
  inside it, not rendered outside via a portal or layout quirk.
- `button.type === "submit"`.

This rules out the "button isn't really inside the form" and "duplicate
stale DOM node" hypotheses.

### Both trigger paths fail identically

1. **Button click** (`startButton.click()` with `exact: true` to avoid the
   separate button-name-collision defect below): zero network request to
   any `simulation.start`-containing URL, zero console/pageerror output,
   button text never changes to "Starting...", and the page's own
   `simulation.listRunning`/`simulation.listSaved` polling requests abort
   with `net::ERR_ABORTED` within ~1s of the click (consistent with, but not
   conclusive proof of, an actual browser navigation/reload interrupting
   in-flight requests).
2. **Enter key in a focused form field** (`boidInput.press("Enter")`):
   identical zero-output result. This path does not involve clicking any
   button at all — the browser's native "Enter submits the form" behavior
   fires the form's `submit` event directly. If React's listener on the
   form were attached and working, this should trigger the exact same
   `onSubmit` handler as the button click. It did not, which argues against
   a button-specific defect (e.g. a broken click handler wiring on that one
   element) and toward something affecting the **form's own event
   delegation** more broadly.

### The separate, independent button-name-collision defect

`authenticated-simulation-run.spec.ts` (committed, existing spec,
`tests/e2e/authenticated-simulation-run.spec.ts:26`) uses
`page.getByRole("button", { name: "Start" })` with no `exact: true`. Running
that spec in isolation (`npx playwright test authenticated-simulation-run`)
now fails with a Playwright strict-mode violation: that locator resolves to
2 elements — the real "Start" submit button and the "Start on server" button
added later (`page.tsx:1221-1230`, `startServerMutation`), since
`"Start on server"` contains `"Start"` as a substring and Playwright's
default string-name matching is substring-based. This is a confirmed,
separate regression from the non-submitting form — it would need fixing
even if the form submitted correctly, and is why this research's own
reproduction scripts used `exact: true` throughout to isolate the two
defects from each other.

### Hypotheses for the actual root cause (unresolved — for `/10x-plan` to prioritize investigating)

1. **Production-build-specific hydration failure** (leading hypothesis). No
   non-determinism source (`Date.now()`, `Math.random()`, `crypto.*`,
   `useId()`) was found directly in `page.tsx`'s own render path via grep,
   but a mismatch could originate in a child component
   (`NumberField`, the per-tribe tab components, `useSearchParams`-adjacent
   code) or in conditional rendering keyed off something that legitimately
   differs between server and client (e.g. a query's `isPending` state at
   first paint). The fastest way to confirm/deny: reproduce the identical
   click-or-Enter test against `npm run dev` instead of the production
   build — `next dev` surfaces hydration mismatches far more verbosely. If
   it does NOT reproduce in dev, that confirms a production-build-specific
   cause and narrows the search to build-time differences (React's
   production error-recovery path, minification interacting with something
   fragile, or the `output: "standalone"` build specifically, per
   `next.config.js`'s own comment about this project's standalone-build
   quirks with forwarded-host handling in an unrelated but adjacent area).
2. **A higher-level error boundary or wrapper silently swallowing the
   event** — not yet checked: whether `AppShell` or any layout-level
   component wraps page content in something that could intercept or stop
   propagation of `submit` events before they reach this form. `layout.tsx`
   was not inspected in this research pass.
3. **React Query / tRPC client misconfiguration specific to this page** —
   less likely given `onError`'s own `console.error` never fired (which
   would require the mutation to have been *attempted*), but not fully
   ruled out if some wrapper around the mutation client swallows the call
   before it reaches the network layer.

No further narrowing was attempted in this research pass — confirming
hypothesis 1 (dev vs. production build) is the natural next step and should
be the first action in the eventual plan, since it would immediately either
confirm or eliminate the leading theory with a single cheap test.

## Code References

- `src/app/simulation/page.tsx:909` — `activeRun ? <SimulationCanvas /> : <form>` render ternary
- `src/app/simulation/page.tsx:932-937` — the form's `onSubmit` handler
- `src/app/simulation/page.tsx:1211-1217` — the "Start" submit button
- `src/app/simulation/page.tsx:1221-1230` — the "Start on server" button (the separate name-collision defect)
- `src/app/simulation/page.tsx:573-603` — `startRun` mutation (`onSuccess`/`onError`)
- `src/components/ui/button.tsx:38-45` — `Button`'s `asChild`/native-button rendering
- `tests/e2e/authenticated-simulation-run.spec.ts:26` — the existing spec's non-`exact` locator, confirmed broken in isolation
- `next.config.js` — `output: "standalone"`, and an unrelated but adjacent standalone-build-specific quirk already documented there (forwarded-host handling)

## Architecture Insights

- This page is a single large `"use client"` component (`page.tsx:1`,
  1240 lines) rendering either the config form or `SimulationCanvas`,
  switched by local `activeRun` state — no server component boundary
  inside this file to suspect for an RSC-specific issue.
- Playwright's e2e suite (`playwright.config.ts`) deliberately tests the
  **production standalone build**, not `next dev` — this is why a
  production-build-specific defect could exist for a long time without
  being caught by any local development testing, and why `/10x-test-plan`'s
  existing quality gates (unit+integration only, no e2e, per
  `context/foundation/test-plan.md` §5) would never have caught this either.

## Historical Context (from context/changes and context/archive)

- `context/changes/test-plan-refresh-2026-11-18/` — this bug was discovered
  as a blocker while implementing that rollout phase's Phase 3
  (`/runs/[runId]` sweep test needs a real run, produced by driving this
  exact start/stop flow). That phase is paused pending this fix.
- `archive/2026-11-11-parallel-sim-switching/plan.md` (cited by
  `test-plan.md`'s own Risk #4) already documented that this page's
  render-loop lifecycle logic is duplicated, not shared, across
  single-run/multi-run — unrelated to this specific defect, but consistent
  with this file being a known area of accumulated complexity.

## Open Questions

- Does this reproduce under `npm run dev`? (Fastest next check — not yet
  run in this research pass.)
- When did this regress — is there a specific commit where the "Start on
  server" feature (or a later per-tribe-config change) introduced whatever
  broke the original form's event handling, or has the production build
  been silently broken since `start-server-run-simulation`'s own commit
  (`c02a9c5`)? `git bisect` against the production build would answer this
  but was not run here.
