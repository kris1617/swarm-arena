# Gate Product Routes with Login and Roles (F-01) — Plan Brief

> Full plan: `context/changes/gate-product-routes/plan.md`

## What & Why

swarm-arena has zero auth today despite the tech-stack decision assuming NextAuth from day one. Every user-visible slice in the roadmap (starting with S-01, the north star) requires "a logged-in user," and the PRD's role split (`admin` sets parameter ranges, `member` runs simulations within them) needs a real role to mean anything. This slice builds that foundation: login, route gating, and a role on the session — nothing product-specific yet.

## Starting Point

The app is the unmodified T3-stack scaffold: tRPC wired with only the example `post` router, Drizzle/SQLite with only the example `post` table, no auth library installed, no middleware, no `/login` route. The production deployment at `swarmarena.hopto.org` is live but has no users.

## Desired End State

Any request to the app redirects to `/login` unless the visitor is signed in via GitHub. Once signed in, their session carries `role: "member"` by default, or `role: "admin"` if their email is in the `ADMIN_EMAILS` env var. Future routers (S-01 onward) import `protectedProcedure` / `adminProcedure` from `trpc.ts` instead of building their own auth checks.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Login method | GitHub OAuth only | No email-sending infra needed for a solo/few-user hobbyist app; PRD's "email/OAuth" wording doesn't mandate both. | Plan |
| Admin assignment | Env-var email allowlist (`ADMIN_EMAILS`) | Survives a DB wipe, no manual DB editing needed, matches the single-real-admin MVP shape. | Plan |
| Gate scope | Everything except `/login` | The whole app is the product per FR-001 — there's no separate public marketing page. | Plan |
| tRPC enforcement | Add `protectedProcedure`/`adminProcedure` now | S-01's "Unlocks" note already says it needs the role distinction; cheaper to add once than retrofit per router. | Plan |
| Auth schema | Standard `@auth/drizzle-adapter` tables + `role` column on `users` | Matches the adapter's documented contract exactly; no custom session handling to maintain. | Plan |
| Session strategy | Database sessions + Node.js middleware runtime | Role changes apply immediately (no JWT staleness); caught in plan review (F1) that the default Edge middleware runtime can't reach the local sqlite file, so `middleware.ts` explicitly opts into `runtime: "nodejs"`. | Plan review |
| Migration command | `npm run db:push` | Production already applies schema this way per `deploy-plan.md`; no need to re-decide at implementation time (plan review F2). | Plan review |

## Scope

**In scope:** NextAuth v5 + GitHub provider, Drizzle adapter schema + `role` column, `ADMIN_EMAILS`-based role assignment, `src/middleware.ts` gating all routes, `protectedProcedure`/`adminProcedure` in `trpc.ts`, a minimal `/login` page and sign-out control.

**Out of scope:** email/magic-link provider, admin UI for managing ranges or other users, any product routes (those arrive in S-01+), password reset/account linking, unit/integration tests (no business logic yet to test).

## Architecture / Approach

NextAuth v5's App Router-native `auth()` helper backs both the middleware (central gate, one `src/middleware.ts`, running under the Node.js runtime) and the tRPC context (`protectedProcedure`/`adminProcedure`). The Drizzle adapter persists users/sessions in the existing SQLite DB using the project's established `createTable` prefixing convention, with **database sessions** as the explicit strategy — middleware reads the session straight from the DB rather than decoding a JWT. Role assignment happens once, at sign-in, by checking the login email against `ADMIN_EMAILS` and writing it to the `users` row — no separate promotion flow or admin UI needed for this slice.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Dependencies and env schema | `next-auth` + `@auth/drizzle-adapter` installed, new secrets registered in `env.js`/`.env.example` | Missing env var silently breaks startup if `env.js` isn't updated — mitigated by the T3 validator throwing loudly |
| 2. Auth data model | NextAuth adapter tables + `users.role` column, migration applied | Must confirm which of `db:push`/`db:migrate` production actually uses before deploying |
| 3. NextAuth config and tRPC procedures | `auth.ts`, GitHub provider, role callback, `protectedProcedure`/`adminProcedure` | Session/role type narrowing in tRPC context must typecheck cleanly for future routers to rely on it |
| 4. Route gating and minimal UI | `middleware.ts`, `/login` page, sign-out control | Middleware matcher must exclude `/api/auth/*` or the sign-in flow itself gets blocked |

**Prerequisites:** none (F-01 has no roadmap prerequisites) — but a real GitHub OAuth app (client ID/secret) must be registered before Phase 3/4 can be manually verified.
**Estimated effort:** ~1 session across 4 phases.

## Open Risks & Assumptions

- Database sessions put a DB read on every gated request (every page load hits `db.sqlite` via the Node.js middleware). Accepted for this MVP's low traffic; revisit if request volume grows enough for this to matter.
- Assumes a GitHub OAuth app will be registered by the user before manual verification in Phase 3/4 — this plan doesn't create the OAuth app itself (external to the repo).
- `next-auth@beta` (v5) is still pre-1.0 upstream; this is current T3-stack convention, not a one-off risk unique to this slice.

## Success Criteria (Summary)

- An unauthenticated visitor is redirected to `/login` from any route.
- Signing in via GitHub assigns `role: "admin"` for allowlisted emails and `role: "member"` otherwise, persisted in the DB.
- `protectedProcedure` and `adminProcedure` exist and typecheck, ready for S-01 to import.
