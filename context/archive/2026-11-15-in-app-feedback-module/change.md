---
change_id: in-app-feedback-module
title: In-app feedback module (GitHub Issues integration)
status: archived
created: 2026-11-15
updated: 2026-11-15
archived_at: 2026-11-15T13:03:53Z
---

## Notes

Roadmap S-26 (M-4, "Area, camera, and ops limits"). Independent of S-24/S-25
— no shared deps. Already `ready` on the roadmap (unknowns resolved
2026-11-15).

**Outcome**: User reports a new functionality idea or a bug from within the
app itself (not an external tool), and it's persisted somewhere the owner
can review it when scoping a future milestone.

**Resolved decisions (from roadmap planning, 2026-11-15)**:
- Mechanism: GitHub Issues integration — reports get created as real issues
  in this project's own GitHub repo (`kris1617/swarm-arena`), specifically
  so they flow into the existing dev pipeline (the same repo this app's
  CI/CD already deploys from) rather than into a second, disconnected
  inbox.
- Visibility: moot — GitHub Issues' own visibility model (repo-level, not
  app-level) applies as-is.

**Roadmap's own risk note**: Low-medium — fully additive to the simulation
engine, but carries a real external dependency (GitHub's API, auth for
creating issues — likely a personal access token or GitHub App, not yet
decided). `/10x-plan` needs to settle how the app authenticates to GitHub
without leaking a token client-side.
