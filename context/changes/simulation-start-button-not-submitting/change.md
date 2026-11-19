---
change_id: simulation-start-button-not-submitting
title: /simulation's Start button click silently reloads instead of submitting
status: implemented
created: 2026-11-19
updated: 2026-11-19
archived_at: null
---

## Notes

/simulation's Start button click silently reloads the page instead of
submitting the start mutation - no network request, no console error,
isPending never flips; listRunning/listSaved polling requests abort
with ERR_ABORTED right after the click, matching a real page
navigation. Also breaks the existing authenticated-simulation-run.spec.ts
via a separate Start/"Start on server" button-name collision.

## Discovery context

Found while implementing `test-plan-refresh-2026-11-18` Phase 3 (a
page-smoke-sweep e2e test needing a real scored run to reach
`/runs/[runId]`). That rollout phase is **paused**, not abandoned —
`tests/e2e/page-smoke-sweep.spec.ts`'s `/runs/[runId]` test is left
uncommitted in the worktree, written against the intended UI flow; it
will be re-verified once this bug is fixed, not rewritten.

## Confirmed symptoms (not yet root-caused)

1. Clicking `/simulation`'s "Start" button (`src/app/simulation/page.tsx:1211-1217`,
   `type="submit"` inside the form at line 932 whose `onSubmit`
   calls `e.preventDefault(); startRun.mutate(buildStartInput())`)
   produces **zero** network request to `simulation.start`, **zero**
   console/pageerror output, and the button's own `isPending`-driven
   text ("Starting...") never appears — confirmed via a throwaway
   Playwright debug script with explicit `page.on("request"/"console"/"pageerror")`
   listeners.
2. Immediately after the click, the page's own `simulation.listRunning`
   / `simulation.listSaved` polling requests abort with
   `net::ERR_ABORTED` — the signature of an actual browser navigation
   (a real, unprevented native form submission / page reload), not a
   React-level failure.
3. After the click, the page settles back to the exact same unchanged
   config form (same URL, Start button re-enabled, no error text) —
   consistent with a full reload re-mounting the same component from
   scratch, losing whatever happened during the click.
4. Separately, `authenticated-simulation-run.spec.ts`'s existing
   `getByRole("button", { name: "Start" })` (no `exact: true`) now
   fails with a strict-mode violation — the page also renders a
   "Start on server" button (`page.tsx:1221-1230`) whose accessible
   name contains "Start" as a substring. This is a second, independent
   defect in the same area, confirmed by running that spec in
   isolation (`npx playwright test authenticated-simulation-run`).

## Not yet investigated (first job for /10x-research or /10x-frame)

- Why `e.preventDefault()` isn't suppressing the native submit — or
  whether the symptom is actually something else entirely (e.g. a
  stale/duplicate form element, a hydration mismatch silently
  discarding the real event handler, something about the production
  `next build`/`next start` target Playwright's `webServer` config
  runs against specifically, since this was only observed against that
  build, not dev).
- Whether this is a recent regression (check `git log` on
  `src/app/simulation/page.tsx` for what changed around the
  `startServerMutation`/"Start on server" addition — that's the most
  likely point this broke, per the hot-spot scan from
  `test-plan-refresh-2026-11-18`'s own research showing this file at
  41+31 commits/30d) or has been broken for longer than anyone noticed
  (`authenticated-simulation-run.spec.ts` itself may not have been run
  in CI recently — the project's quality gates per
  `context/foundation/test-plan.md` §5 require unit+integration, not
  e2e, on every PR).
