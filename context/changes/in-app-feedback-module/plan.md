# In-App Feedback Module Implementation Plan

## Overview

Let any signed-in user report a bug or feature idea from anywhere in the app via a slide-in form, which creates a real GitHub Issue in this project's own private repo (`kris1617/swarm-arena`) — persisting the report where the owner already works, not in a second disconnected inbox. Submission is rate-limited per user, and a submission that can't reach GitHub immediately (token invalid, GitHub outage) is queued in the database and retried automatically in the background rather than lost.

## Current State Analysis

- No feedback/bug-report mechanism exists anywhere in this app today — this is wholly new, additive functionality.
- **No third-party outbound HTTP call exists anywhere in this codebase** (`src/env.js`, `docker-compose.yml`, `.github/workflows/deploy.yml` confirmed) — GitHub OAuth (`AUTH_GITHUB_ID`/`AUTH_GITHUB_SECRET`) is inbound-only (NextAuth's own token exchange), not a pattern this code calls directly. This plan's `createGithubIssue` call is the first.
- **No rate-limiting/abuse-prevention pattern exists anywhere** — only Zod array-size caps (e.g. `simulation.ts`'s `.max(50_000)`), which bound payload *size*, never submission *frequency*.
- **No modal/Dialog component is in active use** — `src/components/ui/sheet.tsx` (a Radix-Dialog-based slide-in panel) exists but has zero consumers under `src/app/`. This plan is its first real usage.
- **No Textarea or Select UI primitive exists** in `src/components/ui/` (contents: `button, checkbox, input, number-field, separator, sheet, sidebar, skeleton, status-message, switch, tooltip`).
- Secrets reach production exclusively through an untracked `.env` file on the VPS, read by Docker Compose's standard auto-load — confirmed via `docker-compose.yml`'s `environment: AUTH_GITHUB_SECRET=${AUTH_GITHUB_SECRET}` etc. and `context/deployment/deploy-plan.md`'s "Known gap" note that there is no CI-to-VPS secret pipeline. A new secret follows the identical three-step path: `src/env.js` schema → `docker-compose.yml` passthrough → manually added to the VPS's `.env`.
- `protectedProcedure`/`adminProcedure` (`src/server/api/trpc.ts:146-179`) are the only two procedure tiers; `protectedProcedure` is the correct fit (any signed-in user, no shared-state blast radius, unlike `adminProcedure`-gated config mutations).
- Routers are registered manually in `src/server/api/root.ts` (AGENTS.md hard rule) — a `feedbackRouter` needs both an import and a `feedback: feedbackRouter` entry.
- The repo (`kris1617/swarm-arena`) is **private** and already has the standard `bug`/`enhancement` labels GitHub seeds by default — no new labels need to be created.
- `server-run-registry.ts`'s `setInterval`, cached on `globalThis` to survive dev HMR (`server-run-registry.ts:67-79`), is this codebase's only precedent for a recurring background process — the retry worker follows the identical caching discipline, but as a single global interval (not one per entity).
- `src/instrumentation.ts` already exists (currently only exporting `onRequestError`) — Next.js's `register()` export from this same file is the standard, stable (no feature flag needed on Next 16) hook for "run once when the server starts," and is where the retry worker's interval gets started.

### Key Discoveries:

- `src/components/ui/number-field.tsx:22-36` is the canonical "thin wrapper renders the shared `Input` with token classes" pattern (`bg-input text-foreground h-auto rounded-full border-0 px-4 py-2`) every new field primitive in this plan follows — new `Textarea`/`Select` wrappers mirror this shape exactly, not a divergent new pattern.
- `src/components/app-shell.tsx:50-54`'s `SidebarFooter` already holds exactly one utility action (the sign-out form) separate from the main nav list — the natural, already-established place for a second utility action ("Report feedback").
- `src/server/api/routers/user.ts:38-52` (`elevateSelf`) is the best server-side template for a small, single-purpose `protectedProcedure` mutation with Zod input validation and a plain return value.
- `src/app/_components/post.tsx:11-20` is the best client-side template for the submit flow shape (`useState` + `useMutation({onSuccess, onError})` + `isPending`-disabled submit) — smaller and more apt than `simulation/page.tsx`'s large staging form. Its literal styling is pre-token-system boilerplate and is NOT followed.

## Desired End State

A signed-in user clicks "Report feedback" in the sidebar footer (next to Sign out) from any page, fills in a title, a free-text description, and picks Bug or Idea, and submits. If GitHub is reachable, they see a confirmation with a direct link to the created issue within the same request. If not, they see a "received, we'll follow up" confirmation with no link, and a background worker retries the submission every few minutes until it succeeds or the retry budget is exhausted. A user cannot submit more than 5 reports in a rolling hour, enforced from the database (not in-memory), so the limit survives a deploy/restart.

Verification: a submitted report shows up as a real GitHub Issue in `kris1617/swarm-arena`, titled `[Bug] <title>` or `[Idea] <title>`, labeled `bug` or `enhancement` respectively, with the reporter's email, the page they reported from, and their browser's user-agent string in the body; a 6th submission within an hour is rejected client-side with a clear error; a submission made with a deliberately invalid token is queued, visible in the `feedback_reports` table as `status: "pending"`, and is picked up and sent by the retry worker without any further user action.

## What We're NOT Doing

- **Not building any in-app admin UI** to view/manage submitted feedback — GitHub Issues itself is the full review interface, per the roadmap's own resolved decision.
- **Not supporting attachments/screenshots** — text-only title + description.
- **Not making the GitHub owner/repo configurable** — hardcoded to this project's own `kris1617/swarm-arena`, since this app only ever deploys from this one repo.
- **Not building a generic job-queue system** — the retry worker is a single purpose-built interval over one table, not a reusable queue abstraction for future unrelated background work.
- **Not rate-limiting by IP** — only by signed-in user id, consistent with every other per-user limit in this codebase (`MAX_PARALLEL_RUNS`, `maxConcurrentObjectCount`).
- **Not notifying the user when a queued report is eventually sent** (e.g. no email/in-app notification) — they already got an acknowledgement at submit time; the GitHub issue existing is the durable record.

## Implementation Approach

Four phases, ordered by dependency: the data model and the pure, testable GitHub API client land first (nothing else can be tested without them); the tRPC router (rate limit + submit + immediate-send attempt) wires those together next; the background retry worker reuses the same send logic as a third, independent caller; the UI lands last, once the API it calls fully exists.

A single shared helper, `attemptSendReport(db, reportId)` (in `src/server/feedback/send-report.ts`), is called by both the router's immediate-attempt path and the retry worker's scheduled path, so the "call GitHub, then update the row" logic exists exactly once — not duplicated between the two callers.

## Phase 1: Data model + GitHub client core

### Overview

The `feedback_reports` table (the queue + rate-limit source of truth) and a pure, DOM-free, directly-testable `createGithubIssue` function — no router, no UI, fully unit-testable in isolation.

### Changes Required:

#### 1. `feedback_reports` table

**File**: `src/server/db/schema.ts`

**Intent**: One row per submission, doubling as both the retry queue and the rate-limit source (count rows by `userId`/`createdAt` rather than a separate counter).

**Contract**: `feedbackReports = createTable("feedback_report", (d) => ({ id: d.integer({mode:"number"}).primaryKey({autoIncrement:true}), userId: d.text().notNull().references(() => users.id, {onDelete:"cascade"}), category: d.text({enum:["bug","idea"]}).notNull(), title: d.text().notNull(), description: d.text().notNull(), pagePath: d.text().notNull(), userAgent: d.text().notNull(), status: d.text({enum:["pending","sent","abandoned"]}).notNull().default("pending"), githubIssueNumber: d.integer(), githubIssueUrl: d.text(), attemptCount: d.integer().notNull().default(0), lastError: d.text(), createdAt: d.integer({mode:"timestamp"}).default(sql`(unixepoch())`).notNull(), lastAttemptAt: d.integer({mode:"timestamp"}) }))`. New Drizzle migration (`drizzle-kit generate`, expected `0008_*.sql`) — no backfill needed, this is a brand-new table with no pre-existing rows.

#### 2. GitHub Issues API client (pure, testable)

**File**: `src/server/feedback/github-client.ts` (new)

**Intent**: A single function that POSTs to GitHub's Issues API and returns the created issue's number/URL, or throws a typed error with the response status/body — with no framework or DB dependency, so it's testable with an injected fake `fetch`, following this codebase's established testable-core discipline (`watchServerRun`, `computeSingleRunTick`).

**Contract**: `createGithubIssue(params: { token: string; owner: string; repo: string; title: string; body: string; labels: string[] }, fetchImpl: typeof fetch = fetch): Promise<{ issueNumber: number; issueUrl: string }>`. Calls `POST https://api.github.com/repos/{owner}/{repo}/issues` with headers `Authorization: Bearer ${token}`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`, and a `User-Agent` header (GitHub's API rejects requests without one) set to a fixed string identifying this app, e.g. `swarm-arena-feedback-bot`. On a non-2xx response, throws `new GithubApiError(response.status, await response.text())` (a small exported error class carrying `status`/`body`) rather than a generic `Error`, so `send-report.ts` can store a useful `lastError`. On success, returns `{ issueNumber: json.number, issueUrl: json.html_url }`.

Also exports `mapCategoryToGithubLabel(category: "bug" | "idea"): "bug" | "enhancement"` and `formatIssueTitle(category, title): string` (prefixes `[Bug] `/`[Idea] `) — small pure helpers kept alongside the client since they're part of "what gets sent to GitHub," directly unit-testable without a fetch mock.

#### 3. Determinism/unit tests

**File**: `src/server/feedback/github-client.test.ts` (new)

**Intent**: Prove the request shape (method, URL, headers, body) and both the success and error paths, using a fake `fetch` — no real network call, no real token.

**Contract**: Tests assert: (a) the request is sent to the exact expected URL with the exact expected headers/body for a given input; (b) a 2xx fake response resolves to the expected `{issueNumber, issueUrl}`; (c) a non-2xx fake response rejects with `GithubApiError` carrying the fake status/body; (d) `mapCategoryToGithubLabel`/`formatIssueTitle` produce the expected values for both categories.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npm run db:push`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- Full suite still passes: `npm test`
- New `github-client.test.ts` tests pass

#### Manual Verification:

- None for this phase — fully covered by automated tests; no router or UI surface yet.

## Phase 2: Feedback router (rate limit + submit)

### Overview

The `feedbackRouter.create` mutation: validates input, enforces the DB-backed per-user rate limit, inserts the report row, attempts an immediate send, and returns a result the UI can render either outcome from.

### Changes Required:

#### 1. Shared send helper

**File**: `src/server/feedback/send-report.ts` (new)

**Intent**: The single place that calls `createGithubIssue` for an existing `feedback_reports` row and updates that row's status/attempt bookkeeping accordingly — shared by both the router's immediate attempt (this phase) and the retry worker's scheduled attempts (Phase 3), so this logic exists exactly once.

**Contract**: `attemptSendReport(db: typeof dbSingleton, reportId: number, token: string): Promise<{ sent: true; issueUrl: string } | { sent: false }>`. Reads the row, builds the issue body (description + a "Reported from: `${pagePath}` · `${userAgent}` · `${userEmail}`" footer — the reporter's email is read from the row's `userId` via a join/lookup to `users.email`, not stored redundantly on the report row itself), calls `createGithubIssue`. On success: updates the row to `status: "sent"`, sets `githubIssueNumber`/`githubIssueUrl`, `lastAttemptAt`; returns `{sent: true, issueUrl}`. On failure: increments `attemptCount`, sets `lastError`/`lastAttemptAt`, and sets `status: "abandoned"` once `attemptCount` reaches `MAX_RETRY_ATTEMPTS` (5) — otherwise leaves it `"pending"` so the retry worker picks it up again; returns `{sent: false}`. Never throws — a failed send is an expected, handled outcome, not an exceptional one.

#### 2. `feedbackRouter`

**File**: `src/server/api/routers/feedback.ts` (new)

**Intent**: Validate the three user-supplied fields plus the two auto-attached context fields, enforce the rate limit, insert the row, and attempt an immediate send via the Phase 2.1 helper.

**Contract**: `create: protectedProcedure.input(z.object({ category: z.enum(["bug","idea"]), title: z.string().min(1).max(200), description: z.string().min(1).max(5000), pagePath: z.string().min(1).max(200), userAgent: z.string().max(500) })).mutation(...)`. Rate limit: count rows where `userId = ctx.session.user.id AND createdAt > (now - 1 hour)`; if `>= 5`, throw `new TRPCError({code: "TOO_MANY_REQUESTS", message: "..."})` before any insert. Insert the row (`status: "pending"`), then call `attemptSendReport` with `env.GITHUB_FEEDBACK_TOKEN`. Return `{status: "sent", issueUrl} | {status: "queued"}` based on the helper's result — never throws on a send failure, since that's the expected degrade-to-queued path.

#### 3. Secret + deploy wiring

**Files**: `src/env.js`, `.env.example`, `docker-compose.yml`

**Intent**: `GITHUB_FEEDBACK_TOKEN` follows the exact same three-step path `AUTH_GITHUB_SECRET` already established.

**Contract**: `src/env.js`'s server schema gains `GITHUB_FEEDBACK_TOKEN: z.string().min(1)` (required — no legitimate "unset in prod" state once shipped) plus the matching `runtimeEnv` mapping. `.env.example` documents it with a comment recommending a GitHub fine-grained PAT scoped to `kris1617/swarm-arena`, Issues: write-only. `docker-compose.yml`'s `app` service `environment:` block gains `GITHUB_FEEDBACK_TOKEN=${GITHUB_FEEDBACK_TOKEN}`. The real value still has to be added to the VPS's untracked `.env` by hand before deploy — this plan cannot automate that step, same gap `deploy-plan.md` already documents for every other secret.

#### 4. Router registration

**File**: `src/server/api/root.ts`

**Intent**: Register the new router — not auto-discovered (AGENTS.md hard rule).

**Contract**: Add `import { feedbackRouter } from "~/server/api/routers/feedback";` and `feedback: feedbackRouter` to the `createTRPCRouter({...})` call.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- Full suite still passes: `npm test`
- New router tests pass (rate-limit rejection at the 6th submission within an hour; successful immediate-send path with a mocked `createGithubIssue`; degrade-to-queued path when the mocked client throws)

#### Manual Verification:

- None for this phase — no UI surface yet; covered by automated router tests exercised via `createCaller`, same pattern as `simulation.test.ts`.

## Phase 3: Background retry worker

### Overview

A single global interval, started once at server boot, that retries every `pending`/`failed`-but-not-yet-`abandoned` report.

### Changes Required:

#### 1. Retry worker

**File**: `src/server/feedback/retry-worker.ts` (new)

**Intent**: Periodically re-attempt every report still in `"pending"` status (Phase 2's `attemptSendReport` leaves a row `"pending"` on failure until the attempt cap is hit) — the same recurring-process discipline `server-run-registry.ts` already established (interval cached on `globalThis` so dev HMR can't register a second one), but a single global interval, not one per entity.

**Contract**: `startFeedbackRetryWorker(): void` — idempotent (a second call while one is already registered on `globalThis` is a no-op, mirroring `server-run-registry.ts:67-79`'s exact caching shape). On each tick (`RETRY_INTERVAL_MS = 5 * 60_000`), selects up to 10 `feedback_reports` rows with `status = "pending"`, ordered by `createdAt` ascending, and calls `attemptSendReport` for each in sequence (not parallel — this is a low-volume hobby-project queue, and sequential avoids bursting GitHub's rate limit on a cold start with several queued rows).

#### 2. Start the worker once at server boot

**File**: `src/instrumentation.ts`

**Intent**: Next.js's `register()` export (stable in Next 16, no feature flag) is the standard "run once when the server process starts" hook — the natural place to start the retry worker, rather than inventing a new startup mechanism.

**Contract**: Add `export async function register() { const { startFeedbackRetryWorker } = await import("~/server/feedback/retry-worker"); startFeedbackRetryWorker(); }` alongside the existing `onRequestError` export. The dynamic import avoids pulling server-only DB/env code into any edge-runtime invocation of this file (Next calls `register()` once per runtime it starts, including edge, where `~/server/db` would fail to initialize).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- Full suite still passes: `npm test`
- New `retry-worker.test.ts` passes (fake-timer test, same pattern as `server-run-registry.test.ts`: a `"pending"` row is picked up and sent on the next tick; a row already `"sent"` or `"abandoned"` is left untouched; calling `startFeedbackRetryWorker` twice does not register two intervals)

#### Manual Verification:

- None for this phase — fully covered by the fake-timer automated test; no UI surface yet.

## Phase 4: UI (feedback form)

### Overview

The "Report feedback" trigger in the sidebar footer, the Sheet-based form itself, and the two new field primitives it needs.

### Changes Required:

#### 1. `Textarea` and `Select` primitives

**Files**: `src/components/ui/textarea.tsx`, `src/components/ui/select.tsx` (new)

**Intent**: Thin wrappers mirroring `number-field.tsx`'s established shape (a native element styled with this project's token classes), not new custom primitives — `Textarea` for the description field, `Select` for the bug/idea category.

**Contract**: `Textarea` renders a native `<textarea>` with `bg-input text-foreground rounded-2xl border-0 px-4 py-2` (a multi-line content box, so `rounded-2xl` — not `rounded-full`, which only fits single-line pills elsewhere in this codebase) plus the same `focus-visible`/`disabled` treatment `input.tsx` already applies. `Select` renders a native `<select>` with `bg-input text-foreground h-auto rounded-full border-0 px-4 py-2` (matching `NumberField`'s pill shape, since it's a single-line control), options `"bug"`/`"idea"`.

#### 2. Feedback sheet component

**File**: `src/components/feedback-sheet.tsx` (new)

**Intent**: The full form (title `Input`, description `Textarea`, category `Select`), its own `api.feedback.create.useMutation`, and the two post-submit UX states (sent-with-link vs. queued-no-link) — modeled on `post.tsx`'s submit-flow shape (`useState` + `useMutation({onSuccess, onError})` + `isPending`-disabled submit), not its literal (unstyled) markup.

**Contract**: Exports `FeedbackSheet()`, a client component rendering `<Sheet><SheetTrigger asChild>{/* SidebarMenuButton */}</SheetTrigger><SheetContent>{/* form */}</SheetContent></Sheet>`. On submit, reads `pagePath` from `usePathname()` and `userAgent` from `navigator.userAgent`, calls `create.mutate({category, title, description, pagePath, userAgent})`. On success, renders "Thanks — [view issue #N](url)" when `result.status === "sent"`, or "Thanks — we'll follow up" when `result.status === "queued"`. On error (e.g. the rate-limit `TOO_MANY_REQUESTS`), shows the error message and leaves the form's values intact so the user doesn't lose their text.

#### 3. Sidebar trigger

**File**: `src/components/app-shell.tsx`

**Intent**: Render the new trigger in the existing `SidebarFooter`, alongside Sign out — the one existing utility-action slot in the nav shell.

**Contract**: Add `<FeedbackSheet />` inside `SidebarFooter`, before or after the existing sign-out `<form>`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- Full suite still passes: `npm test`
- Hardcoded-value scan on touched files returns zero hits (tokens only, per AGENTS.md's UI rules)

#### Manual Verification:

- "Report feedback" is visible in the sidebar footer on every authenticated page and opens the slide-in form.
- Submitting a valid bug report creates a real GitHub Issue in `kris1617/swarm-arena`, titled `[Bug] <title>`, labeled `bug`, with the reporter's email/page/user-agent in the body, and the UI shows a working link to it.
- Submitting a 6th report within an hour as the same user is rejected with a clear error before any GitHub call is attempted.
- Submitting with a deliberately broken `GITHUB_FEEDBACK_TOKEN` (local only) shows the "we'll follow up" queued confirmation, and the row appears in `feedback_reports` with `status: "pending"`; restoring a valid token and waiting for the retry worker's next tick (or manually invoking it) sends it successfully.

## Testing Strategy

### Unit Tests:

- `github-client.test.ts`: request shape, success/error mapping, category→label/title formatting.
- `feedback.test.ts` (router): rate-limit rejection, immediate-send success, degrade-to-queued on send failure — via `createCaller`, mocking `createGithubIssue`/`attemptSendReport` the same way `simulation.test.ts` mocks `server-run-registry`.
- `retry-worker.test.ts`: fake-timer pick-up of pending rows, idempotent double-start guard — same pattern as `server-run-registry.test.ts`.

### Manual Testing Steps:

1. Submit a bug report from the Simulation page; confirm it creates a real GitHub issue titled `[Bug] ...`, labeled `bug`, with your email/page/user-agent in the body, and the UI shows a link to it.
2. Submit a 6th report within an hour; confirm it's rejected client-side with a clear message, no new GitHub issue created.
3. Temporarily point `GITHUB_FEEDBACK_TOKEN` at an invalid value locally, submit a report, confirm the "we'll follow up" (no-link) confirmation and a `status: "pending"` row in `feedback_reports`; restore the valid token and confirm the next retry-worker tick sends it.

## Performance Considerations

The retry worker runs at most once every 5 minutes and processes at most 10 rows sequentially — negligible load on this low-traffic hobby app, well below the concern threshold this project's own `capacity-limits.md` established for the simulation engine's tick loop (a completely separate, far hotter code path).

## Migration Notes

New `feedback_reports` table, brand new with no pre-existing data — no backfill needed.

## References

- `src/server/simulation/server-run-registry.ts:67-79` — the `globalThis`-cached recurring-interval pattern Phase 3's retry worker follows.
- `src/server/api/routers/user.ts:38-52` — the small single-purpose `protectedProcedure` mutation template.
- `src/app/_components/post.tsx:11-20` — the submit-flow shape template (not its styling).
- `src/components/ui/number-field.tsx` — the thin-wrapper primitive pattern `Textarea`/`Select` follow.
- `src/components/app-shell.tsx:50-54` — `SidebarFooter`, where the feedback trigger lands.
- `context/deployment/deploy-plan.md` — documents the existing (manual, no CI pipeline) secret-to-VPS path this plan's new secret follows.
- Roadmap `context/foundation/roadmap.md` S-26 — the Slice entry this plan implements.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Data model + GitHub client core

#### Automated

- [x] 1.1 Migration applies cleanly: `npm run db:push` — d27dd42
- [x] 1.2 Type checking passes: `npm run typecheck` — d27dd42
- [x] 1.3 Linting passes: `npm run check` — d27dd42
- [x] 1.4 Full suite still passes: `npm test` — d27dd42
- [x] 1.5 New `github-client.test.ts` tests pass — d27dd42

### Phase 2: Feedback router (rate limit + submit)

#### Automated

- [x] 2.1 Type checking passes: `npm run typecheck` — 02c33b0
- [x] 2.2 Linting passes: `npm run check` — 02c33b0
- [x] 2.3 Full suite still passes: `npm test` — 02c33b0
- [x] 2.4 New router tests pass (rate-limit rejection, immediate-send success, degrade-to-queued) — 02c33b0

### Phase 3: Background retry worker

#### Automated

- [x] 3.1 Type checking passes: `npm run typecheck`
- [x] 3.2 Linting passes: `npm run check`
- [x] 3.3 Full suite still passes: `npm test`
- [x] 3.4 New `retry-worker.test.ts` passes

### Phase 4: UI (feedback form)

#### Automated

- [ ] 4.1 Type checking passes: `npm run typecheck`
- [ ] 4.2 Linting passes: `npm run check`
- [ ] 4.3 Full suite still passes: `npm test`
- [ ] 4.4 Hardcoded-value scan on touched files returns zero hits

#### Manual

- [ ] 4.5 "Report feedback" visible in sidebar footer on every authenticated page, opens the form
- [ ] 4.6 Valid bug report creates a real labeled GitHub issue with email/page/user-agent in the body; UI shows a working link
- [ ] 4.7 A 6th report within an hour is rejected client-side before any GitHub call
- [ ] 4.8 A broken token shows the queued confirmation; a restored token + next retry tick sends it successfully
