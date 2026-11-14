---
change_id: ci-quality-gates
title: Gate auto-deploy behind lint, typecheck, and test (test-plan Phase 5)
status: archived
created: 2026-11-12
updated: 2026-11-14
archived_at: 2026-11-14T10:03:52Z
---

## Notes

Open a change folder for rollout Phase 5 of context/foundation/test-plan.md: "Quality-gates wiring".
Risk covered: cross-cutting (§5 Quality Gates already identified that .github/workflows/deploy.yml auto-deploys on every push to master with zero lint/typecheck/test gating).
Test types planned: gates (CI configuration, not a new test).
Risk response intent: add a required lint + typecheck + test step to CI that must pass before the existing auto-deploy-on-merge workflow runs, closing the gap test-plan.md §5 identified from the start.
After creating the folder, follow the downstream continuation rule (continue to /10x-research, to ground the exact current GitHub Actions workflow structure and how to gate the existing deploy job on a new check job).
