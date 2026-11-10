# Gate Product Routes with Login and Roles (F-01) Implementation Plan

## Overview

Add NextAuth (GitHub OAuth) with a Drizzle-backed session store, gate every route behind login via Next.js middleware, and expose a `member`/`admin` role on the session so downstream tRPC procedures can check it. This is the first foundation slice in the roadmap (`F-01`) — nothing else in the product exists yet, so this plan only establishes the gate and the role, not any product UI.

## Current State Analysis

- No auth library is installed (`package.json` has no `next-auth` / `@auth/*` packages) despite `context/foundation/tech-stack.md` (frontmatter `has_auth: true`) planning NextAuth + Drizzle from day one.
- `src/server/db/schema.ts` only has the T3-starter example `post` table (prefixed `.bootstrap-scaffold_`); no user/session tables exist.
- `src/server/api/trpc.ts` exports only `publicProcedure` — no session-aware procedure builder exists yet.
- `src/app/layout.tsx` and `src/app/page.tsx` are the unmodified T3-starter scaffold; there is no `/login` route, no middleware, no session UI.
- `src/env.js` (T3 env validator, `~/env.js` throughout the codebase) currently validates only `DATABASE_URL` and `NODE_ENV` — any new secret must be added here per `AGENTS.md`'s hard rule or the app throws at startup.
- PRD (`context/foundation/prd.md`, Access Control section) specifies: login (email/OAuth), two roles (`admin`, `member`) from day one, `admin` defines parameter ranges/limits, `member` runs simulations within those ranges. Finer admin capabilities are an open PRD question — out of scope here.

### Key Discoveries:

- `src/server/api/trpc.ts:1-70` is the single file the lesson's hard-rule ("routers are not auto-discovered; register manually in `root.ts`") pattern pairs with — procedure builders live here, so `protectedProcedure`/`adminProcedure` belong beside the existing `publicProcedure`.
- `src/env.js` already uses `@t3-oss/env-nextjs` with `emptyStringAsUndefined: true` — new secrets follow the existing `server: {}` / `runtimeEnv: {}` pattern exactly.
- No `middleware.ts` exists anywhere in the repo — this plan creates the first one.

## Desired End State

A logged-out request to any route (except the sign-in page and its supporting NextAuth API routes) is redirected to `/login`. Signing in via GitHub creates a `users` row (via the Drizzle adapter) with `role` defaulted to `member`, except that any login whose email appears in the `ADMIN_EMAILS` env var is assigned `role: "admin"`. The session, available server-side and in tRPC context, carries `role`. `protectedProcedure` and `adminProcedure` exist in `trpc.ts` for future routers (S-01 onward) to import. A minimal `/login` page and a sign-out control exist so the gate is actually usable end-to-end.

**Verification:** `npm run typecheck` and `npm run check` pass; `npm run build` succeeds; manually, signing in with a GitHub account listed in `ADMIN_EMAILS` yields `role: "admin"` in the session (visible via a temporary debug render or `drizzle-kit studio`), any other GitHub account yields `role: "member"`, and an unauthenticated request to `/` redirects to `/login`.

## What We're NOT Doing

- No email/magic-link provider — GitHub OAuth only for this slice (open question for later providers).
- No admin UI for managing parameter ranges or other users — that's S-04 territory.
- No product routes to actually gate yet beyond the existing scaffold `/` — this slice gates whatever exists today and establishes the pattern; S-01+ routes inherit it automatically.
- No password reset / account linking UX — out of scope for a single-provider MVP.
- No change to the public landing page concept — per the PRD, the whole app is gated; there is no separate marketing page in this slice.

## Implementation Approach

Use `next-auth` (v5, the Next.js App Router-native version) with `@auth/drizzle-adapter` against the existing libsql/Drizzle setup, following the standard NextAuth Drizzle adapter schema (`users`, `accounts`, `sessions`, `verification_tokens`) plus a `role` column added to `users`. Sessions use the adapter's **database** strategy explicitly (not left implicit); role assignment happens once, in a NextAuth sign-in event/callback, by checking the authenticating email against a comma-separated `ADMIN_EMAILS` env var — no separate admin-promotion flow. Gating is enforced once, centrally, via `src/middleware.ts` running in the **Node.js middleware runtime** (required because database-session validation needs to open the local sqlite file, which the default Edge runtime cannot do), rather than per-page checks. `trpc.ts` gets `protectedProcedure` (session required) and `adminProcedure` (session + `role === "admin"` required) so every future router built in this project imports from one place.

## Critical Implementation Details

**Session strategy and middleware runtime**: This plan deliberately keeps database sessions (role changes apply immediately — no JWT staleness) at the cost of a DB read on every gated request. That tradeoff only works because `src/middleware.ts` explicitly opts into `runtime = "nodejs"` (Next 16) — forgetting that line, or any future refactor that reverts to the default Edge middleware runtime, breaks the gate outright since Edge can't reach `db.sqlite`. Phase 4 must verify this explicitly, not just "it compiled."

## Phase 1: Dependencies and env schema

### Overview

Install the auth packages and make the new secrets known to the T3 env validator, without wiring any auth logic yet. This isolates "can the app still build and start" from "does auth actually work."

### Changes Required:

#### 1. Package dependencies

**File**: `package.json`

**Intent**: Add `next-auth` and `@auth/drizzle-adapter` as runtime dependencies.

**Contract**: `npm install next-auth@beta @auth/drizzle-adapter` (NextAuth v5 is required for the App Router `auth()` helper and middleware integration used in later phases; v5 is still tagged `beta` upstream, which is expected and current T3-stack convention).

#### 2. Env schema

**File**: `src/env.js`

**Intent**: Register the new server-side secrets so `createEnv` validates them at startup, per the hard rule in `AGENTS.md`.

**Contract**: Add to the `server` schema: `AUTH_SECRET: z.string().min(1)`, `AUTH_GITHUB_ID: z.string().min(1)`, `AUTH_GITHUB_SECRET: z.string().min(1)`, `ADMIN_EMAILS: z.string().default("")`. Add matching entries to `runtimeEnv`.

#### 3. Env example

**File**: `.env.example`

**Intent**: Document the new variables so a fresh clone knows what to populate, per the same hard rule.

**Contract**: Append a new section (after the existing `# Drizzle` block) listing `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `ADMIN_EMAILS` with placeholder values and a one-line comment on how to generate `AUTH_SECRET` (`npx auth secret`) and register a GitHub OAuth app.

### Success Criteria:

#### Automated Verification:

- `npm run typecheck` passes
- `npm run check` passes
- `npm run build` fails fast with a clear env-validation error if `.env` is missing the new vars (confirms `env.js` wiring), then succeeds once a local `.env` has placeholder values

#### Manual Verification:

- None for this phase — fully covered by automated checks

---

## Phase 2: Auth data model

### Overview

Add the NextAuth Drizzle-adapter tables and the `role` column, and generate/apply the migration.

### Changes Required:

#### 1. Drizzle schema

**File**: `src/server/db/schema.ts`

**Intent**: Add the four tables the Drizzle adapter requires (`users`, `accounts`, `sessions`, `verification_tokens`), following the adapter's documented column contract, and add a `role` column to `users`.

**Contract**: Use the existing `createTable` helper (so new tables also get the `.bootstrap-scaffold_` prefix, consistent with the existing `post` table) for each adapter table. `users.role` is a `text` column with a check/enum constraint limited to `"member" | "admin"`, `notNull().default("member")`. Table and column names otherwise follow `@auth/drizzle-adapter`'s SQLite schema contract exactly (this is a hard adapter requirement, not a style choice — do not rename columns the adapter reads/writes).

#### 2. Migration

**File**: `drizzle/` (generated)

**Intent**: Generate and apply the migration for the new tables/column.

**Contract**: `npm run db:generate` then `npm run db:push` — production already applies schema this way (`context/deployment/deploy-plan.md:13`: "Schema pushed via `drizzle-kit push`"), so this change follows the same path, not `db:migrate`.

### Success Criteria:

#### Automated Verification:

- `npm run db:generate` produces a migration with no manual edits needed
- `npm run db:push` (or `db:migrate`) applies cleanly against the local `db.sqlite`
- `npm run typecheck` passes (Drizzle schema types compile)

#### Manual Verification:

- Open `drizzle-kit studio` and confirm the four new tables exist with the expected columns, and `users.role` defaults to `member`

---

## Phase 3: NextAuth configuration and tRPC procedures

### Overview

Wire NextAuth itself (GitHub provider, Drizzle adapter, role-assignment callback) and extend `trpc.ts` with session-aware procedure builders.

### Changes Required:

#### 1. NextAuth config

**File**: `src/server/auth/config.ts` (new)

**Intent**: Configure NextAuth with the GitHub provider and the Drizzle adapter, using **database sessions** (the adapter's default), and assign `role` once, at sign-in, by checking the authenticating email against `ADMIN_EMAILS` — not on every session read.

**Contract**: Export a `NextAuthConfig` object with `session: { strategy: "database" }` set explicitly (not left implicit) so the choice is visible and intentional, not an accident of adapter presence. Do the `ADMIN_EMAILS` check in the `events.createUser` / `events.signIn` hook (or equivalently, the `signIn` callback before the adapter persists the row) — compare the email case-insensitively against `env.ADMIN_EMAILS.split(",").map(s => s.trim())`, and if it matches, write `role: "admin"` directly to the `users` row via Drizzle. This runs once per sign-in event, not once per request. The `session` callback itself only *reads* `role` off the DB user record returned by the adapter and copies it onto `session.user.role` — it performs no writes.

#### 2. NextAuth route handler

**File**: `src/server/auth/index.ts` (new) and `src/app/api/auth/[...nextauth]/route.ts` (new)

**Intent**: Export the `auth`, `signIn`, `signOut` helpers from the config, and expose the NextAuth route handlers.

**Contract**: Follows NextAuth v5's documented App Router setup (`NextAuth(config)` → `{ handlers, auth, signIn, signOut }`); the route file re-exports `handlers.GET` / `handlers.POST`.

#### 3. tRPC context and procedures

**File**: `src/server/api/trpc.ts`

**Intent**: Make the session available in tRPC context, and add `protectedProcedure` (throws `UNAUTHORIZED` if no session) and `adminProcedure` (throws `FORBIDDEN` if `role !== "admin"`) beside the existing `publicProcedure`.

**Contract**: `createTRPCContext` gains a `session` field (from the new `auth()` helper). `protectedProcedure = publicProcedure.use(...)` middleware that checks `ctx.session?.user` and narrows the context type so downstream procedures get a non-nullable `session.user`. `adminProcedure = protectedProcedure.use(...)` middleware checking `ctx.session.user.role === "admin"`.

### Success Criteria:

#### Automated Verification:

- `npm run typecheck` passes, including that `adminProcedure`/`protectedProcedure` narrow `ctx.session.user` to non-nullable
- `npm run check` passes
- `npm run build` succeeds

#### Manual Verification:

- None for this phase — no UI touches it yet; covered in Phase 4's manual check

---

## Phase 4: Route gating and minimal sign-in UI

### Overview

Gate every route behind login and add just enough UI (a `/login` page, a sign-out control) to actually exercise the gate end-to-end.

### Changes Required:

#### 1. Middleware

**File**: `src/middleware.ts` (new)

**Intent**: Redirect any unauthenticated request to `/login`, except requests to `/login` itself and the NextAuth API routes (which must stay reachable for the sign-in flow to work). Because this project uses database sessions (Phase 3), the middleware must run in the Node.js runtime — the default Edge runtime cannot open the local sqlite file the adapter needs to validate a session.

**Contract**: Export NextAuth's `auth` as the middleware function (per NextAuth v5's documented middleware pattern), with a `matcher` config excluding `/login`, `/api/auth/*`, and Next.js internals (`/_next/*`, static assets). Add `export const runtime = "nodejs"` (Next 16's stable Node middleware runtime) so the database-session check in `auth()` can actually reach `db.sqlite`. This puts a DB read on every gated request by design — see Open Risks in the brief for the accepted tradeoff.

#### 2. Login page

**File**: `src/app/login/page.tsx` (new)

**Intent**: A minimal page with a "Sign in with GitHub" button calling the `signIn` helper.

**Contract**: Server component or client component per NextAuth v5 convention for a sign-in button; no styling requirements beyond the existing Tailwind setup.

#### 3. Sign-out control and session surfacing

**File**: `src/app/layout.tsx`

**Intent**: Surface the current session (at minimum, a sign-out button) so the gate is visibly working, not just enforced invisibly.

**Contract**: Read the session server-side via the `auth()` helper and render a sign-out control when a session exists. Does not need to change the existing page content beyond this.

### Success Criteria:

#### Automated Verification:

- `npm run typecheck` passes
- `npm run check` passes
- `npm run build` succeeds

#### Manual Verification:

- An unauthenticated browser request to `/` redirects to `/login`
- `src/middleware.ts` runs under the Node.js runtime and successfully reads a database session (confirm no Edge-runtime DB error in server logs on a gated request)
- Signing in with a GitHub account listed in `ADMIN_EMAILS` results in a session with `role: "admin"` (confirm via a temporary console log or by inspecting the `users` table in `drizzle-kit studio`)
- Signing in with a GitHub account NOT listed in `ADMIN_EMAILS` results in `role: "member"`
- Sign-out returns the user to `/login` and subsequent requests to `/` redirect again

## Testing Strategy

### Unit Tests:

- None planned — this slice is almost entirely framework wiring (NextAuth config, middleware, Drizzle schema) with no custom business logic to unit-test yet. The role-assignment comparison (`ADMIN_EMAILS` matching) is simple enough to verify manually in Phase 4; revisit with a unit test once S-04 adds admin-capable UI that depends on it.

### Integration Tests:

- None planned for this slice — no domain routers exist yet to integration-test against the new `protectedProcedure`/`adminProcedure`.

### Manual Testing Steps:

1. Start the dev server with a local `.env` populated with a real GitHub OAuth app's credentials and your own email in `ADMIN_EMAILS`.
2. Visit `/` while logged out — confirm redirect to `/login`.
3. Sign in with the admin-listed GitHub account — confirm session has `role: "admin"`.
4. Sign out, sign in with a different GitHub account not in `ADMIN_EMAILS` — confirm `role: "member"`.
5. Confirm sign-out redirects back to `/login` and the gate re-applies.

## Performance Considerations

None — this is low-traffic auth wiring on a hobbyist single/few-user app; no caching or rate-limiting concerns in scope.

## Migration Notes

The production DB at `swarmarena.hopto.org` currently has no users. Phase 2's migration must be applied to production via `npm run db:push` before this change is deployed, matching the existing documented deploy flow.

## References

- PRD Access Control section: `context/foundation/prd.md`
- Roadmap F-01: `context/foundation/roadmap.md`
- Tech-stack auth decision: `context/foundation/tech-stack.md`
- Existing tRPC setup: `src/server/api/trpc.ts`
- Existing env schema: `src/env.js`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Dependencies and env schema

#### Automated

- [x] 1.1 npm run typecheck passes — da1a2b2
- [x] 1.2 npm run check passes — da1a2b2
- [x] 1.3 npm run build succeeds with populated .env — da1a2b2

### Phase 2: Auth data model

#### Automated

- [x] 2.1 npm run db:generate produces a clean migration — f691d1b
- [x] 2.2 npm run db:push (or db:migrate) applies cleanly — f691d1b
- [x] 2.3 npm run typecheck passes — f691d1b

#### Manual

- [x] 2.4 drizzle-kit studio shows the 4 new tables and users.role defaulting to member — f691d1b

### Phase 3: NextAuth configuration and tRPC procedures

#### Automated

- [x] 3.1 npm run typecheck passes with non-nullable ctx.session.user narrowing — 860af59
- [x] 3.2 npm run check passes — 860af59
- [x] 3.3 npm run build succeeds — 860af59

### Phase 4: Route gating and minimal sign-in UI

#### Automated

- [x] 4.1 npm run typecheck passes — 03f9466
- [x] 4.2 npm run check passes — 03f9466
- [x] 4.3 npm run build succeeds — 03f9466

#### Manual

- [x] 4.4 Unauthenticated request to / redirects to /login — 03f9466
- [x] 4.5 Middleware runs under Node.js runtime and reads a database session with no Edge DB error — 03f9466
- [x] 4.6 GitHub account in ADMIN_EMAILS gets role: admin — 03f9466
- [ ] 4.7 GitHub account not in ADMIN_EMAILS gets role: member
- [x] 4.8 Sign-out returns to /login and gate re-applies — 03f9466
