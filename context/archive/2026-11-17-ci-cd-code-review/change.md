---
change_id: ci-cd-code-review
title: AI code review pipeline for pull requests (10xChampion M5L2/M5L3)
status: archived
created: 2026-11-17
updated: 2026-11-18
archived_at: 2026-11-18T02:43:29Z
---

## Notes

Introducing a first CI/CD workflow for PR code reviews. Local Claude Agent SDK
reviewer already built and verified at `tools/ai-reviewer/` (M5L2 — confirmed
working against a seeded SQL-injection diff and a clean diff). This change
wires that reviewer into GitHub Actions: a composite action plus a workflow
that runs on every PR to `master`, comments the verdict, labels the PR
(`ai-cr:passed`/`ai-cr:failed`), gates merge on the verdict, and supports
on-demand retry via the `ai-cr:review` label (M5L3).

Requirements captured in `requirements.md` in this folder, adapted from the
course's M5L3 template for the Claude Agent SDK (not the generic
OpenRouter-flavored template default).
