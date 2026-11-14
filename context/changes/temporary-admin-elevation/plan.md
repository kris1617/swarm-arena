# Time-boxed, self-service admin elevation for any account Implementation Plan

## Overview

Add a reversible, time-boxed path to the `admin` role (FR-030): any logged-in user can self-elevate/self-revert anytime (no prerequisite, preventing lockout); elevating or reverting a *different* account requires the caller already be effectively admin. Elevation auto-expires via a stored timestamp, checked lazily at authorization time — no scheduled job needed.

## Current State Analysis

- `users.role` (`src/server/db/schema.ts:46-48`) is a `member`/`admin` enum, `default("member")`. `ADMIN_EMAILS` (`src/server/auth/config.ts:29-33,74-82`) permanently sets `role: "admin"` once, at account creation (`createUser` event) — an unrelated, pre-existing bootstrap mechanism this plan does not touch.
- `adminProcedure` (`src/server/api/trpc.ts:164-169`) gates on `ctx.session.user.role !== "admin"` → `FORBIDDEN`. The session's `role` field is set in NextAuth's `session` callback (`config.ts:87-94`), reading directly off the adapter-loaded `user` row — this runs on every session read under the `database` strategy (confirmed by the existing code comment explaining why `database` strategy was chosen: "role changes must apply immediately").
- `/admin/settings` (`src/app/admin/settings/page.tsx:9-12`) is the one existing admin-gated page, with its own direct `session?.user?.role !== "admin"` check (not going through `adminProcedure`, since it's a page, not a tRPC call) — this plan's authorization change must be reflected here too, not just in `adminProcedure`.
- No schema field or mechanism exists today for a time-boxed role — this plan adds one nullable column.
- User-confirmed decisions (via `/10x-plan`'s interview, 3 questions): time-boxed auto-expiring grant; any account can be targeted by email; self-elevation/revert needs no prerequisite, elevating/reverting another account requires the caller already be effectively admin.
- **Plan-review finding (F1, CRITICAL)**: GitHub OAuth sign-in has no allowlist or org-membership restriction (`src/server/auth/config.ts` has no `signIn` callback) — any internet stranger can sign up and become a `member`. Combined with `elevateSelf` having no prerequisite, this would let any such account immediately self-elevate to admin and mutate global `adminSettings` (parameter ranges, object-count cap). Resolved: `elevateSelf` is now gated behind a new `ALLOW_SELF_ELEVATION` environment flag, defaulting to disabled, so the escalation path is closed by default in any deployment that doesn't explicitly opt in.

## Desired End State

A logged-in user can self-elevate to `admin` for a chosen duration and self-revert early, with no admin prerequisite. An effectively-admin user can additionally elevate or revert any other account by email. Elevation lapses on its own once `elevatedUntil` passes — checked at every session read and every `adminProcedure` call — with no background job. `ADMIN_EMAILS`-seeded permanent admins (whose `elevatedUntil` is never set, staying `null`) are unaffected and never expire.

### Key Discoveries

- A single nullable `elevatedUntil` timestamp column on `users`, combined with the existing `role` enum, is sufficient — no new table. `elevatedUntil === null` means "not time-boxed" (either never elevated via this mechanism, or a permanent `ADMIN_EMAILS` admin); `elevatedUntil` in the future means "time-boxed, still valid"; in the past means "time-boxed, lapsed" (role column may still literally say `"admin"` until an explicit revert, but every authorization check must treat it as `member`).
- Because the check must be "effectively admin," not "role column says admin," a single shared helper (`isEffectivelyAdmin`) must be used in both the NextAuth `session` callback and `adminProcedure` — computing it in only one place would let the other drift.

## What We're NOT Doing

- Not touching `ADMIN_EMAILS` or the `createUser` bootstrap event — that mechanism is unrelated and permanent by design.
- Not adding a background job, cron, or scheduled task to physically revert an expired `role` column back to `"member"` — expiry is checked lazily wherever `isEffectivelyAdmin` is called; the stored `role` value may lag behind the effective state until an explicit revert, which is fine since nothing reads `role` directly without going through the helper.
- Not building a full user-management page (listing all accounts, pagination, search) — the target-account lookup is a single email input, not a browsable user list. A `listElevatedAccounts` query shows only currently-elevated accounts (expected to be zero or one in practice), not every user.
- Not changing any other admin-only capability's authorization path beyond `adminProcedure` and `/admin/settings`'s page-level check — both already exist and already gate on `role`; this plan only makes both expiry-aware.

## Implementation Approach

Three phases: the schema migration and shared effective-role helper first (everything else depends on it), then the tRPC mutations/query, then the UI.

## Phase 1: Schema migration and effective-role helper

### Overview

Add the `elevatedUntil` column and a shared helper function used by both the session callback and `adminProcedure`.

### Changes Required:

#### 1. Add `elevatedUntil` to `users`

**File**: `src/server/db/schema.ts`

**Intent**: Add a nullable timestamp column, following `simulationRuns.stoppedAt`'s exact style (`d.integer({ mode: "timestamp" })`, nullable, no default).

**Contract**: `elevatedUntil: d.integer({ mode: "timestamp" })` added to the `users` table definition. Run `npm run db:generate` to produce the migration SQL, then `npm run db:migrate` to apply it locally (both are existing `package.json` scripts, not new tooling).

#### 2. Add the effective-role helper

**File**: `src/server/auth/elevation.ts` (new file)

**Intent**: A plain, framework-free function computing whether a user is effectively admin right now, given their stored `role` and `elevatedUntil`. Framework-free so it's unit-testable without a DB/session, matching this project's established discipline (`parameter-suggestion.ts`, `run-optimization-suggestion.ts`).

**Contract**:
```ts
export function isEffectivelyAdmin(user: {
  role: "member" | "admin";
  elevatedUntil: Date | null;
}): boolean {
  if (user.role !== "admin") return false;
  if (user.elevatedUntil === null) return true; // permanent admin, never time-boxed
  return user.elevatedUntil.getTime() > Date.now();
}
```

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- Full suite still passes: `npm test`
- New unit tests for `isEffectivelyAdmin`: `role: "member"` → false regardless of `elevatedUntil`; `role: "admin", elevatedUntil: null` → true; `role: "admin", elevatedUntil` in the future → true; `role: "admin", elevatedUntil` in the past → false

#### Manual Verification:

- (none for this phase — the column and helper aren't wired into any request path yet; Phase 2 does that)

---

## Phase 2: Mutations, query, and wiring

### Overview

Add the four tRPC procedures (self-elevate, self-revert, elevate-another, revert-another, plus a list-elevated query), and wire `isEffectivelyAdmin` into `adminProcedure` and the NextAuth `session` callback.

### Changes Required:

#### 1. Wire the helper into `adminProcedure`

**File**: `src/server/api/trpc.ts`

**Intent**: Replace `adminProcedure`'s direct `ctx.session.user.role !== "admin"` check with `!isEffectivelyAdmin(ctx.session.user)` — the session's `role`/`elevatedUntil` fields (added in change 3 below) feed this same helper, so an expired time-boxed grant is rejected even if the DB row hasn't been explicitly reverted yet.

**Contract**: `adminProcedure`'s behavior for a permanent `ADMIN_EMAILS` admin or a currently-valid time-boxed grant is unchanged (still passes); a lapsed grant now correctly fails where it previously would have incorrectly passed (since nothing enforced expiry before this phase).

#### 2. Add the elevation mutations and query

**File**: `src/server/api/routers/user.ts` (new router file, following this project's one-router-per-domain convention — see `AGENTS.md`)

**Intent**:
- `elevateSelf({ durationMinutes })` — `protectedProcedure` (no admin *row* prerequisite, by design, to prevent lockout) but gated on the new `env.ALLOW_SELF_ELEVATION` flag (see change 4 below): throws `FORBIDDEN` when the flag is off. When enabled, sets the caller's own `role: "admin"`, `elevatedUntil: now + durationMinutes`.
- `revertSelf()` — `protectedProcedure`. Sets the caller's own `role: "member"`, `elevatedUntil: null`.
- `elevateAccount({ email, durationMinutes })` — `adminProcedure` (caller must already be effectively admin). Looks up the target by `email` (plan-review F2: lowercase both the input and the stored value before comparing — e.g. via SQL `lower()` or a `sql\`lower(${users.email}) = ${email.toLowerCase()}\`` predicate — matching `ADMIN_EMAILS`'s existing normalization, since `users.email` has no `COLLATE NOCASE`); if not found, throws `BAD_REQUEST`. Sets the target's `role: "admin"`, `elevatedUntil: now + durationMinutes`.
- `revertAccount({ email })` — `adminProcedure`. Looks up the target by `email` using the same case-insensitive comparison; sets `role: "member"`, `elevatedUntil: null`.
- `listElevatedAccounts()` — `adminProcedure`. Returns accounts where `role === "admin"` and `elevatedUntil` is non-null and in the future (i.e., currently time-boxed and still valid) — `id`, `email`, `elevatedUntil`. Permanent `ADMIN_EMAILS` admins (`elevatedUntil: null`) are intentionally excluded — there's nothing to revoke for them through this mechanism.

**Contract**: `durationMinutes` is a plain number (minutes), validated via Zod as a positive integer with a reasonable upper bound (e.g. max 1440 — one day) to prevent an accidental near-permanent grant. Register the new router in `src/server/api/root.ts` (per `AGENTS.md`'s "Routers... are not auto-discovered; register each one manually" rule).

#### 4. Add the `ALLOW_SELF_ELEVATION` environment flag (plan-review F1 fix)

**File**: `src/env.js` and `.env.example`

**Intent**: A new boolean-ish server env var, following `AUTH_TRUST_HOST`'s existing pattern (`z.string().optional().transform((v) => v === "true")`) — defaults to disabled when unset, so `elevateSelf` is closed by default in any deployment that doesn't explicitly opt in. Document it in `.env.example` per `AGENTS.md`'s hard rule that new environment variables must be added to both `env.js` and `.env.example`.

**Contract**: `env.ALLOW_SELF_ELEVATION: boolean`, read by `elevateSelf` (change 2 above) to gate the mutation.

#### 3. Make the session reflect effective state

**File**: `src/server/auth/config.ts`

**Intent**: The `session` callback must expose enough for `/admin/settings`'s page-level check (and any future page-level check) to call `isEffectivelyAdmin` itself, rather than trusting a raw `role` field that might be stale relative to `elevatedUntil`. Add `elevatedUntil` to the session's `user` object alongside the existing `role`, and update the type augmentation (`declare module "next-auth"`) to include it.

**Contract**: `session.user` gains `elevatedUntil: Date | null`. No change to the existing `role` field's presence — pages/procedures that need the *effective* status now call `isEffectivelyAdmin(session.user)` instead of reading `session.user.role` directly.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- Full suite still passes: `npm test`
- New integration/unit tests cover: `elevateSelf`/`revertSelf` succeed for any logged-in user when `ALLOW_SELF_ELEVATION` is enabled, and `elevateSelf` throws `FORBIDDEN` when it is not; `elevateAccount`/`revertAccount` succeed for an effectively-admin caller and fail (`FORBIDDEN`) for a non-admin caller; `adminProcedure` rejects a caller whose `elevatedUntil` has lapsed even though `role` still says `"admin"` in the DB; `elevateAccount` with an unknown email throws `BAD_REQUEST`; `elevateAccount` finds the target account when the input email's case differs from the stored value (plan-review F2)

#### Manual Verification:

- (none for this phase — no UI yet; Phase 3 adds it)

---

## Phase 3: Elevation UI

### Overview

Add a small admin-elevation section so the self-service and cross-account flows are actually usable, not just callable via raw tRPC.

### Changes Required:

#### 1. Add the elevation UI

**File**: `src/app/admin/elevation/page.tsx` (new page, under the existing `/admin` route grouping) and `src/app/admin/elevation/_components/elevation-form.tsx` (new component, following `admin-settings-form.tsx`'s existing client-component-with-mutation pattern)

**Intent**: A page reachable by any logged-in user (not gated — self-elevation needs no prerequisite) showing: a "Become admin for" duration picker + button calling `elevateSelf`, and, only when the viewer is currently effectively admin (checked via `isEffectivelyAdmin` server-side in the page component, same pattern as `/admin/settings`), an additional section with an email + duration input calling `elevateAccount`, plus a list (from `listElevatedAccounts`) of currently-elevated accounts each with a "Revoke" button calling `revertAccount`. A "Revert my elevation" button (calling `revertSelf`) is always visible once the viewer is currently elevated.

**Contract**: No change to `/admin/settings`'s own page or form — this is a new, separate page. `/admin/settings`'s existing `session?.user?.role !== "admin"` redirect check is updated to use `isEffectivelyAdmin` (per Phase 2's intent) so a lapsed time-boxed grant is correctly redirected away, matching `adminProcedure`'s server-side behavior.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- Full suite still passes: `npm test`
- Hardcoded-value scan on the new page/component returns zero hits (tokens only, matching `AGENTS.md`'s UI rules and the established `Button`/`Input` component usage)

#### Manual Verification:

- A fresh member account can self-elevate, immediately gains access to `/admin/settings` without re-login (confirming the `database`-strategy session reflects the change on the next request), and can self-revert
- An elevated account can elevate a different account by email, see it listed under "currently elevated," and revoke it — the revoked account immediately loses admin access
- A non-admin account attempting `elevateAccount`/`revertAccount` (e.g. via direct tRPC call in dev tools) receives `FORBIDDEN`
- Letting a short-duration grant (e.g. 1 minute) lapse naturally removes admin access on the next request, without any explicit revert action
- `/admin/settings` redirects a lapsed-elevation account to `/simulation`, matching its pre-existing behavior for a plain `member`

## Testing Strategy

### Unit Tests:

- `src/server/auth/elevation.test.ts` — `isEffectivelyAdmin`'s 4 cases (member regardless of timestamp; permanent admin; valid time-boxed; lapsed time-boxed).
- Router-level tests for the 4 mutations + query in a new `src/server/api/routers/user.test.ts`, following this project's existing `createCaller`-based router test pattern (see `simulation.test.ts` for the convention).

### Manual Testing Steps:

1. As a plain member, call `elevateSelf` with a short duration, confirm `/admin/settings` becomes reachable, then call `revertSelf` and confirm it's blocked again.
2. As an elevated account, call `elevateAccount` targeting a second test account's email, confirm that account's `/admin/settings` access, then `revertAccount` and confirm it's revoked.
3. Elevate with a 1-minute duration, wait past expiry, confirm `adminProcedure`-gated calls and `/admin/settings` both reject the request without any explicit revert.

## Performance Considerations

None — `isEffectivelyAdmin` is a constant-time comparison against an already-fetched row; no new queries beyond the mutations' own single-row lookups/updates.

## Migration Notes

One schema migration (`elevatedUntil` nullable column, `npm run db:generate` + `npm run db:migrate`) — purely additive, no backfill needed (existing rows get `NULL`, which `isEffectivelyAdmin` already treats correctly as "not time-boxed").

## References

- `src/server/db/schema.ts` (`users` table, `role` enum) and `src/server/auth/config.ts` (`ADMIN_EMAILS` bootstrap, `session` callback) — the existing mechanisms this plan extends without modifying their own behavior.
- `src/server/api/trpc.ts:164-169` (`adminProcedure`) and `src/app/admin/settings/page.tsx` — the two existing authorization check sites this plan must keep in sync via the shared helper.
- `src/server/simulation/parameter-suggestion.ts` and `run-optimization-suggestion.ts` — the established framework-free-helper-function discipline `isEffectivelyAdmin` follows.
- `AGENTS.md` — router registration rule (`src/server/api/root.ts`), the new-env-var rule (`src/env.js` + `.env.example`), and the UI token/component rules the new page follows.
- `context/changes/temporary-admin-elevation/reviews/plan-review.md` — F1 (CRITICAL, fixed via `ALLOW_SELF_ELEVATION`) and F2 (WARNING, fixed via case-insensitive email lookup).
- Roadmap `context/foundation/roadmap.md` S-22 — the Slice entry this plan implements.
- PRD `context/foundation/prd.md` FR-030 and Open Question #6 — the requirement and its resolved mechanism decision.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema migration and effective-role helper

#### Automated

- [ ] 1.1 Type checking passes: `npm run typecheck`
- [ ] 1.2 Linting passes: `npm run check`
- [ ] 1.3 Full suite still passes: `npm test`
- [ ] 1.4 New unit tests cover all 4 `isEffectivelyAdmin` cases

### Phase 2: Mutations, query, and wiring

#### Automated

- [ ] 2.1 Type checking passes: `npm run typecheck`
- [ ] 2.2 Linting passes: `npm run check`
- [ ] 2.3 Full suite still passes: `npm test`
- [ ] 2.4 New tests cover self-elevate/revert (flag on/off), cross-account elevate/revert (admin-only), lapsed-grant rejection, unknown-email error, and case-insensitive email matching

### Phase 3: Elevation UI

#### Automated

- [ ] 3.1 Type checking passes: `npm run typecheck`
- [ ] 3.2 Linting passes: `npm run check`
- [ ] 3.3 Full suite still passes: `npm test`
- [ ] 3.4 Hardcoded-value scan on the new page/component returns zero hits

#### Manual

- [ ] 3.5 Self-elevate/self-revert works end-to-end, no re-login needed
- [ ] 3.6 Cross-account elevate/revoke works end-to-end
- [ ] 3.7 Non-admin caller is rejected (FORBIDDEN) on cross-account mutations
- [ ] 3.8 A lapsed grant loses access automatically, no explicit revert needed
- [ ] 3.9 `/admin/settings` redirects a lapsed-elevation account like a plain member
