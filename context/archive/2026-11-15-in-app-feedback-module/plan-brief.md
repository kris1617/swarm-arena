# In-App Feedback Module — Plan Brief

> Full plan: `context/changes/in-app-feedback-module/plan.md`

## What & Why

Roadmap S-26: let any signed-in user report a bug or feature idea from inside the app, persisted as a real GitHub Issue in this project's own repo so reports flow into the existing dev pipeline instead of a second, disconnected inbox.

## Starting Point

No feedback mechanism exists today. This is also the first third-party outbound HTTP call, the first new secret since auth, the first real use of the existing-but-unused `Sheet` modal primitive, and the first rate-limiting/background-retry logic anywhere in this codebase.

## Desired End State

A "Report feedback" trigger sits in the sidebar footer on every page. Submitting creates a real, labeled GitHub Issue with the reporter's email and page/browser context; the user sees a link to it immediately, or a "we'll follow up" message if GitHub couldn't be reached right away — in which case a background worker retries it automatically. A user can't submit more than 5 reports per rolling hour.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Mechanism | GitHub Issues in `kris1617/swarm-arena` | Flows into the existing dev pipeline, not a second inbox | Roadmap |
| Procedure type | `protectedProcedure` | Per-user action, no shared-state blast radius (unlike `adminProcedure`) | Plan (research) |
| Reporter identity | Included (email) in issue body | Lets the owner follow up on a hobby project with a handful of real users | User (AskUserQuestion) |
| Rate limit | 5/hour, DB-backed (persists across restarts) | Bounds abuse of the GitHub API/quota without being annoying; survives deploys | User (AskUserQuestion) |
| API-failure handling | Queue in DB + background retry worker | Feedback is never silently lost even if GitHub is briefly down | User (AskUserQuestion) |
| Post-submit UX | Link to the issue when sent immediately; plain "we'll follow up" when queued | Private repo, so a link is harmless and lets the user track it themselves | User (AskUserQuestion) |
| UI placement | Sheet modal from sidebar footer (next to Sign out) | Reuses the already-present-but-unused `Sheet` primitive; available from anywhere | User (AskUserQuestion) |
| Auto-attached context | Page path + user-agent appended to the issue body | Makes bug reports actionable without having to ask the reporter | User (AskUserQuestion) |
| Client testability | Plain injectable `createGithubIssue()` function | Matches this codebase's existing testable-core convention (`watchServerRun`, etc.) | User (AskUserQuestion) |

## Scope

**In scope:** feedback form (title/description/category), GitHub issue creation with labels, DB-backed per-user rate limiting, DB-backed submission queue + background retry worker, new `Textarea`/`Select` UI primitives.

**Out of scope:** any in-app admin view of submitted feedback (GitHub Issues is the full interface); attachments/screenshots; configurable owner/repo; a general-purpose job queue; IP-based rate limiting; notifying the user when a queued report is later sent.

## Architecture / Approach

Four phases, ordered by dependency: data model + pure GitHub client first (independently testable), then the tRPC router wiring rate-limit + insert + immediate-send, then the background retry worker (reusing the router's own send helper as a second caller), then the UI last. A single shared `attemptSendReport()` helper is called by both the router and the retry worker so the "call GitHub, update the row" logic exists exactly once.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Data model + GitHub client core | `feedback_reports` table/migration; pure, tested `createGithubIssue()` | Low — isolated, no other system depends on it yet |
| 2. Feedback router | Rate limit, insert, immediate-send attempt; secret + deploy wiring | Medium — first external API call + first new secret in this codebase |
| 3. Background retry worker | Single global interval retrying queued reports | Low-medium — new recurring-process pattern, but a direct precedent (`server-run-registry.ts`) exists |
| 4. UI | Sheet form, sidebar trigger, two new field primitives | Low-medium — first real `Sheet` usage, two new UI primitives |

**Prerequisites:** none — fully independent of S-24/S-25, as the roadmap already notes.
**Estimated effort:** ~1-2 sessions across 4 phases.

## Open Risks & Assumptions

- The GitHub PAT's exact scope/type (fine-grained, Issues: write-only on this one repo) is a deployment-time decision the plan recommends but can't enforce from code.
- Rate-limit/retry constants (5/hour, 5 max attempts, 5-minute retry interval) are reasonable defaults, not derived from real usage data — there is none yet for a brand-new feature.
- The real `GITHUB_FEEDBACK_TOKEN` value still has to be added to the VPS's untracked `.env` by hand before this ships to production — same manual gap every other secret in this project already has.

## Success Criteria (Summary)

- A submitted report becomes a real, correctly labeled/titled GitHub Issue with reporter context in the body.
- A 6th submission within an hour is rejected before any GitHub call.
- A submission GitHub can't immediately accept is queued and automatically retried to completion without user action.
