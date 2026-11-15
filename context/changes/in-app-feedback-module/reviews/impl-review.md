<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: In-App Feedback Module Implementation Plan

- **Plan**: context/changes/in-app-feedback-module/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-11-15
- **Verdict**: APPROVED (all findings fixed post-review)
- **Findings**: 2 critical, 2 warnings, 0 observations — all 4 FIXED

## Verdicts (as found; all 4 findings fixed immediately after review — see each finding's Decision)

| Dimension | Verdict (as found) |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — Success-path DB write failure misclassified as a send failure, risking duplicate GitHub issues

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/server/feedback/send-report.ts:55-94
- **Detail**: The `try` block covers both `createGithubIssue` (the external call) and the success-path `db.update` (lines 61-69). If the GitHub call succeeds but that `db.update` throws (e.g. a transient SQLite busy/lock error), control falls into the `catch` block, which treats it as a generic send failure: it increments `attemptCount` and sets `status` back to `"pending"`/`"abandoned"`, with `lastError` set to the DB error — even though the issue was already created on GitHub. The row never gets `githubIssueNumber`/`githubIssueUrl` persisted, and since `status` is `"pending"`, `retry-worker.ts` will pick the same row up again next tick and call `createGithubIssue` a second time — filing a duplicate issue for the same report with no idempotency guard against it.
- **Fix**: Narrow the `try` block to wrap only `createGithubIssue`. Treat the success-path `db.update` as a separate step after that try/catch resolves — if it throws, let the error propagate to the caller (an infrastructure failure, not a send failure) rather than reclassifying it as "GitHub rejected this."
  - Strength: Fixes the misclassification at its root — a DB write failure can no longer be confused with a GitHub API failure, eliminating the duplicate-issue risk.
  - Tradeoff: The caller (feedback.ts's mutation, retry-worker.ts's loop) must now handle this newly-possible propagated exception — see F2, whose fix covers exactly this.
  - Confidence: HIGH — straightforward control-flow fix, no behavior change on the already-correct paths.
  - Blind spot: None significant.
- **Decision**: FIXED — narrowed the try/catch to wrap only `createGithubIssue`; the success-path `db.update` now runs after it, outside the catch, so a DB write failure after a successful GitHub call propagates instead of being misclassified as a send failure.

### F2 — Unhandled exception from `attemptSendReport` can crash the server process via the retry worker's bare `void` call

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/server/feedback/retry-worker.ts:37-48; src/server/feedback/send-report.ts:37-49
- **Detail**: `attemptSendReport`'s two pre-`try` queries (`db.query.feedbackReports.findFirst`, `db.query.users.findFirst`) can throw (e.g. a DB connection blip) with nothing to catch them — the exception propagates straight out of the function. `retry-worker.ts`'s `startFeedbackRetryWorker` invokes the per-tick work as `void retryPendingReports()` with no `.catch()`, and `retryPendingReports`'s `for` loop has no try/catch around its `attemptSendReport` call either. A thrown exception from any row in that loop becomes an **unhandled promise rejection** inside a bare `setInterval` callback — not inside an HTTP request/response lifecycle tRPC or Next can convert into a 500. Node's default unhandled-rejection policy (since Node 15) terminates the process on this. A single transient DB hiccup during a background retry tick could crash the entire production server, taking down the whole app (simulation engine included), not just the feedback feature. No global `process.on("unhandledRejection", ...)` handler exists anywhere in this codebase to soften this.
- **Fix**: Wrap each `attemptSendReport` call inside `retryPendingReports`'s loop in its own try/catch, logging the error and continuing to the next row (mirroring `server-run-registry.ts`'s own tick()'s try/catch-and-log convention) rather than letting one bad row abort the batch or crash the process.
  - Strength: Matches this codebase's existing established pattern for a recurring background tick (server-run-registry.ts's `tick()` function already does exactly this for its own per-run work).
  - Tradeoff: A row that fails for an infra reason (not a GitHub API reason) won't have its `attemptCount`/`status` updated that tick — it's simply retried again next tick, which is the correct behavior for a transient failure anyway.
  - Confidence: HIGH — directly mirrors an existing, proven pattern in this same codebase.
  - Blind spot: feedback.ts's mutation call site still has no wrapping try/catch, but that path runs inside tRPC's own request lifecycle (caught by the adapter's `onError`/`logTRPCError`, surfaced to the client as a 500) rather than a bare interval callback — not a crash risk, left as-is.
- **Decision**: FIXED — wrapped each row's `attemptSendReport` call in `retryPendingReports`'s loop in its own try/catch, logging and continuing. Added a regression test (`retry-worker.test.ts`'s "continues to the next row when attemptSendReport throws for an earlier one") proving the fix — confirmed red (uncaught rejection crashing the test run) on the pre-fix code via the deliberate-break check, green after.

### F3 — User-controlled text could cosmetically spoof the issue body's "Reported from"/"Reporter" context

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/server/feedback/send-report.ts:51
- **Detail**: The issue body interpolates raw `report.description` directly before a literal `\n\n---\nReported from: ...\nReporter: ...` footer. A user could include their own fake `---\nReported from: ...\nReporter: someone-else@example.com` text inside their description to make a skimming maintainer believe the issue came from a different page or person. This is inert Markdown text (not executed, no XSS, no injection into app data) — the real, server-sourced `Reporter:` line still appears after any injected text, so it's a low-stakes, plausible-but-not-fully-convincing spoof, not a real security boundary violation.
- **Fix**: Move the auto-attached context (page/user-agent/reporter) to the top of the body, before the user's own description, so an attempted spoof reads as part of the user's own text rather than appearing where the real footer belongs.
- **Decision**: FIXED — context now leads the issue body, user's description trails after a separator.

### F4 — `retry-worker.ts`'s interval has no stored handle or stop path

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/server/feedback/retry-worker.ts:33-60
- **Detail**: `server-run-registry.ts` caches a `Map` on `globalThis` where each entry holds its own `intervalId`, so a specific run's interval can be `clearInterval`'d when that run stops. `retry-worker.ts` caches only a boolean flag and never retains the `setInterval` return value anywhere — there's no way to stop this interval short of killing the process. This is very likely intentional (a single background worker meant to run for the server's entire lifetime, not a per-entity resource like a run), but the divergence from the one existing precedent in this codebase is worth a one-line comment confirming it's deliberate.
- **Fix**: Add a one-line comment near the `setInterval` call noting that, unlike `server-run-registry.ts`'s per-run intervals, this one is meant to run for the life of the server process with no stop path by design.
- **Decision**: FIXED — comment added above the `setInterval` call.

## Automated Success Criteria (re-verified)

- `npm run typecheck` — PASS
- `npm run check` — PASS (1 pre-existing, unrelated warning in sidebar.tsx)
- `npm test` — PASS (261/261, 27 files)
- Hardcoded-value scan on all touched UI files — zero hits

## Manual Success Criteria

All 4 manual items (4.5-4.8) were verified live against a real browser session and the real GitHub API during implementation (see Phase 4's commit message for the full account): sidebar trigger works, a real submission created a correctly titled/labeled issue with reporter context, the 6th-submission rate limit was confirmed rejecting client-side, and the queue→retry path was confirmed end to end with a deliberately invalid then restored token. All test artifacts (issues #3-#9) were subsequently deleted from the repo.
