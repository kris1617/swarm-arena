---
change_id: testing-render-loop-lifecycle
title: Test canvas render-loop lifecycle without a browser (test-plan Phase 2)
status: archived
created: 2026-11-12
updated: 2026-11-14
archived_at: 2026-11-14T10:03:52Z
---

## Notes

Open a change folder for rollout Phase 2 of context/foundation/test-plan.md: "Render-loop lifecycle safety net".
Risk covered: #4 (canvas tick-loop lifecycle regression — stop conditions, redraw-on-switch, no double-step — duplicated across simulation-canvas.tsx and multi-simulation-stage.tsx, zero tests in src/app/).
Test types planned: integration.
Risk response intent: prove the loop's lifecycle behaviors (stop-on-duration, stop-on-population-wipe, correct redraw on active-run switch, no double-step) hold for the composed loop, verified without a real browser frame (mocked RAF/canvas), not via e2e/Playwright.
After creating the folder, follow the downstream continuation rule (continue to /10x-research, since this needs real codebase grounding on how the two tick-loop closures could be made testable).
