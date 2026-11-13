---
date: 2026-11-11T09:17:07+01:00
researcher: Claude Sonnet 5
git_commit: b147d6045876874a1b7ffe8d8c4da8ce2a310e40
branch: master
repository: swarm-arena
topic: "Codebase state relevant to S-01 (basic-flocking-loop): F-01/F-02 foundations, tRPC/Drizzle conventions, existing sim/canvas scaffolding"
tags: [research, codebase, auth, rng, trpc, drizzle, simulation]
status: complete
last_updated: 2026-11-11
last_updated_by: Claude Sonnet 5
---

# Research: Codebase state relevant to S-01 (basic-flocking-loop)

**Date**: 2026-11-11T09:17:07+01:00
**Researcher**: Claude Sonnet 5
**Git Commit**: b147d6045876874a1b7ffe8d8c4da8ce2a310e40
**Branch**: master
**Repository**: swarm-arena

## Research Question

What's the current state of the codebase relevant to implementing S-01 (basic flocking loop)? Specifically: (1) how F-01 (auth/role gating) and F-02 (deterministic seeded PRNG) were implemented, so this slice can build on them correctly; (2) existing tRPC router and Drizzle schema conventions; (3) whether any flocking/boids logic, canvas/rendering setup, or simulation-loop scaffolding already exists; (4) relevant entries in `context/foundation/lessons.md`.

## Summary

Both prerequisite foundations (F-01, F-02) are implemented and committed on `master` as of this inspected commit. F-01 gates every route except `/login` and `/api/auth` via NextAuth v5 middleware plus a `role` column (`member`/`admin`) on `users`, and exposes `adminProcedure`/`protectedProcedure` at the tRPC layer — but no router anywhere in `src/server/api/routers/` yet calls either guard; `post.ts` only uses `publicProcedure`, so S-01 would be the first real consumer of auth-gated procedures (`src/server/api/routers/post.ts`, full file). F-02 is a self-contained mulberry32 PRNG module (`src/server/simulation/rng.ts`, 21 lines) with no dependents yet outside its own test file — S-01 is its first intended consumer per the archived F-02 plan. No flocking/boids logic, canvas/animation-loop code, or simulation-domain schema/router exists anywhere in `src/` today (confirmed by a full-repo grep for `boid`, `flock`, `predator`, `requestAnimationFrame`, `<canvas`, `simulation`, `canvas`, which matched only the RNG module and its test). `context/foundation/lessons.md` does not exist in this repository, so there are no recorded recurring-rule priors to apply.

## Detailed Findings

### F-01 — gate-product-routes (auth/role gating)

- Archived at `context/archive/2026-11-10-gate-product-routes/` (change.md, plan.md, plan-brief.md, reviews/).
- `src/server/auth/config.ts:46-95` — `authConfig: NextAuthConfig` uses `DrizzleAdapter` (lines 47-52), `session: { strategy: "database" }` (line 53), a single GitHub provider (lines 56-59), and a custom sign-in page at `/login` (line 62).
- `src/server/auth/config.ts:69-77` — `events.createUser` sets `role: "admin"` on first user creation only if the user's email is listed in the `ADMIN_EMAILS` env var (compared at lines 30-34); all other new users default to `role: "member"` via the schema default (see below).
- `src/server/auth/config.ts:82-88` — `callbacks.session` copies the adapter-loaded `user.role` onto `session.user.role`, which is what makes role visible at both the middleware and tRPC layers.
- `src/server/auth/config.ts:93` — `callbacks.authorized: ({ auth }) => !!auth?.user` is the switch that makes NextAuth's middleware wrapper actually redirect unauthenticated requests; this inspected codebase's comment at this line calls out that omitting it would default `authorized` to `true` (i.e., no gating).
- `src/server/auth/config.ts:22-28` — module augmentation adds `role` to `Session["user"]`'s TypeScript type.
- `src/server/auth/index.ts:1-5` — `NextAuth(authConfig)` instantiation exporting `auth`, `handlers`, `signIn`, `signOut`.
- `src/app/api/auth/[...nextauth]/route.ts:1-3` — wires NextAuth's `handlers` to Next's `GET`/`POST` route exports.
- `src/middleware.ts:1-13` — exports NextAuth's `auth` function itself as the named `middleware` export (required for NextAuth v5; this file's own comment at lines 1-4 states a default export would silently skip gating). Runs on the Node.js runtime (line 9, needed for the database session check). `matcher` (lines 11-13) excludes `/login`, `/api/auth`, static assets and favicon — every other route on this inspected matcher is gated.
- `src/server/db/schema.ts:36-48` — `users` table; `role` column at lines 45-48: `text("role", { enum: ["member", "admin"] }).notNull().default("member")`.
- `src/server/api/trpc.ts:28-36` — `createTRPCContext` calls `auth()` and attaches `session` (nullable) to `ctx`.
- `src/server/api/trpc.ts:110` — `publicProcedure` — no auth/role gating.
- `src/server/api/trpc.ts:118-127` — `protectedProcedure`: throws `TRPCError({ code: "UNAUTHORIZED" })` when `!ctx.session?.user` (lines 119-121), otherwise narrows `ctx.session.user` to non-nullable for downstream handlers.
- `src/server/api/trpc.ts:135-140` — `adminProcedure`: built on `protectedProcedure`, additionally throws `TRPCError({ code: "FORBIDDEN" })` when `ctx.session.user.role !== "admin"` (lines 136-137).
- `src/app/login/page.tsx:1-16` — the only UI sign-in entry point; a server action calls `signIn("github", { redirectTo: "/" })`. Comment at lines 10-13 documents that `redirectTo: "/"` is deliberate to avoid a redirect loop, since `/login` itself is excluded from the middleware's gate.
- **Gap for S-01**: in this inspected repository, no router file under `src/server/api/routers/` currently calls `protectedProcedure` or `adminProcedure` — `src/server/api/routers/post.ts` (full file) uses `publicProcedure` exclusively for all three of its procedures (`hello`, `create`, `getLatest`). Whichever simulation-run procedures S-01 adds will be the first to exercise these guards; this is new ground, not a pattern to copy from an existing call site.

### F-02 — deterministic-seed-strategy (seeded PRNG)

- Archived at `context/archive/2026-11-10-deterministic-seed-strategy/` (change.md, plan.md, plan-brief.md, reviews/plan-review.md, reviews/impl-review.md).
- Chosen approach per that archived `plan.md`'s "Implementation Approach" section: an in-house mulberry32 algorithm with zero external dependency, chosen explicitly so a given seed's output sequence cannot drift from an upstream library version bump. No PRNG package (`pure-rand`, `seedrandom`, etc.) is present in `package.json` in this inspected repository.
- `src/server/simulation/rng.ts` (21 lines, full file) — exported API: `export function createRng(seed: number): () => number` (line 9). Lines 10-12 throw `RangeError` if `seed` is not an integer (covers `NaN` and non-integer floats). Lines 13-20 are the mulberry32 body; the returned closure has the same call signature as `Math.random()` — it returns a float in `[0, 1)` with no arguments.
- `src/server/simulation/rng.test.ts` — three cases inspected: same seed produces an identical 10-value sequence (lines 6-14), a different seed produces a different sequence (lines 16-23), a non-integer seed throws `RangeError` (lines 26-28).
- **Usage today**: a grep for `simulation/rng`, `createRng`, `SeededRng` across `src/` in this inspected repository matches only `rng.ts` and `rng.test.ts` themselves — no other file imports this module yet. The archived `plan.md` explicitly scopes F-02 as a pure foundation slice and names S-01 as its first intended consumer.
- One unrelated `Math.random()` call exists at `src/server/api/trpc.ts:91` (artificial dev-mode latency in the T3 timing middleware); the archived F-02 `plan.md` calls this call site out of scope — it is not meant to use `createRng`.

### tRPC router conventions

- `src/server/api/root.ts` (24 lines, full file) — `appRouter` is built via `createTRPCRouter({...})` at lines 9-11, currently registering exactly one sub-router in this inspected file: `post: postRouter` (line 10), imported from `~/server/api/routers/post` at line 1. A comment at lines 6-7 states routers under `src/server/api/routers/` must be added here manually (not auto-discovered — consistent with `AGENTS.md`'s "Hard Rules").
- `createCaller` (line 23) is built via `createCallerFactory(appRouter)` (imported at line 2) for server-side calling; adding a router requires no change to this factory itself.
- `src/server/api/routers/post.ts` (30 lines, full file) is the only router file in this inspected repository and the template for procedure shape:
  - `hello` query (lines 7-13): `publicProcedure.input(z.object({ text: z.string() })).query(({ input }) => {...})`.
  - `create` mutation (lines 15-21): `publicProcedure.input(z.object({ name: z.string().min(1) })).mutation(async ({ ctx, input }) => { await ctx.db.insert(posts).values({ name: input.name }); })` — mutations are `async` and write via `ctx.db` (the Drizzle instance on context).
  - `getLatest` query (lines 23-29): no input schema; uses the Drizzle relational query builder — `ctx.db.query.posts.findFirst({ orderBy: (posts, { desc }) => [desc(posts.createdAt)] })`.
- `src/server/api/trpc.ts` (141 lines, full file): `t = initTRPC.context<...>().create({ transformer: superjson, errorFormatter: ... })` (lines 45-57) — superjson transformer; zod validation errors are surfaced via `shape.data.zodError` (lines 52-53). `timingMiddleware` (lines 86-101) logs execution time and adds an artificial dev-mode delay; it's applied to `publicProcedure` (line 110), and since `protectedProcedure`/`adminProcedure` build on `publicProcedure`, they inherit it too.

### Drizzle schema conventions

- `src/server/db/schema.ts` (91 lines, full file). Table-name prefix helper: `createTable = sqliteTableCreator((name) => \`.bootstrap-scaffold_${name}\`)` (lines 13-15) — every table in this inspected file is created through `createTable(...)`, which applies this prefix; a new table should follow the same call.
- `posts` table (lines 17-29) is the clearest template for a simple new table: `id` integer PK autoincrement (line 20), `name` text length 256 (line 21), `createdAt` integer `mode: "timestamp"` with `default: sql\`(unixepoch())\`` and `.notNull()` (lines 22-25), `updatedAt` integer timestamp with `$onUpdate(() => new Date())` (line 26), and an index `index("name_idx").on(t.name)` via a second config-function argument returning an array (line 28) — i.e. the `createTable(name, (d) => ({...columns})), (t) => [...indexes])` two-argument shape.
- `users` table (lines 37-50, NextAuth/Auth.js adapter contract): `id` text PK via `$defaultFn(() => crypto.randomUUID())` (lines 38-41), `name`, unique `email`, `emailVerified` (timestamp_ms), `image`, and the app-specific `role` enum column described above (lines 46-49).
- `accounts` table (lines 52-71): composite PK via `primaryKey({ columns: [t.provider, t.providerAccountId] })` (line 70) — pattern for composite-key tables; `userId` references `users.id` with `onDelete: "cascade"` (lines 56-58) — pattern for cascading foreign keys.
- `sessions` table (lines 73-80): `sessionToken` text PK, `userId` FK to `users.id` cascade, `expires` integer timestamp_ms not null.
- `verificationTokens` table (lines 82-90): composite PK on `(identifier, token)`, no FK to `users`.
- No `relations()` helper calls exist anywhere in this inspected file — relations are expressed only through `.references()` FK columns; joined/reverse queries go through `ctx.db.query.<table>.findFirst({...})` as seen in `post.ts:23-29`, not through a `relations()` export. A new "simulation run" or "score" table in this inspected codebase would need to follow the same FK-only convention if it needs to be joined.

### Flocking/boids logic, canvas, and simulation-loop scaffolding

- **None exist in this inspected repository.** A grep across `src/` (`.ts`/`.tsx`, case-insensitive) for `boid`, `flock`, `predator`, `requestAnimationFrame`, `<canvas`, `simulation`, `canvas` returned matches only inside the RNG module/test (`src/server/simulation/rng.ts`, `rng.test.ts`) and this research's own search terms — no hits for canvas elements, animation-frame loops, or boid/predator domain logic anywhere else.
- Full `src/` file listing confirms the above (21 files total, inspected directly): `src/middleware.ts`, `src/env.js`, `src/app/page.tsx`, `src/app/layout.tsx`, `src/trpc/query-client.ts`, `src/trpc/react.tsx`, `src/trpc/server.ts`, `src/styles/globals.css`, `src/app/login/page.tsx`, `src/app/_components/post.tsx`, `src/server/api/trpc.ts`, `src/server/api/root.ts`, `src/server/simulation/rng.test.ts`, `src/server/simulation/rng.ts`, `src/server/db/index.ts`, `src/server/db/schema.ts`, `src/server/auth/config.ts`, `src/server/auth/index.ts`, `src/server/api/routers/post.test.ts`, `src/server/api/routers/post.ts`, `src/app/api/trpc/[trpc]/route.ts`, `src/app/api/auth/[...nextauth]/route.ts`.
- `src/app/page.tsx` and `src/app/_components/post.tsx` exist beyond the default T3 starter wiring but were not diffed line-by-line against the stock create-t3-app template in this pass; `_components/post.tsx` is the standard T3 "create post" client component wired to `postRouter`.

### Lessons / recurring rules

- `context/foundation/lessons.md` does not exist in this inspected repository (confirmed via direct file read attempt). There are no recorded recurring-rule priors to apply to S-01's research or plan.

## Code References

- `src/server/auth/config.ts:46-95` — NextAuth config: adapter, session strategy, provider, authorized callback.
- `src/server/auth/index.ts:1-5` — NextAuth instantiation and exports.
- `src/middleware.ts:1-13` — route-gating middleware (named `middleware` export required).
- `src/server/db/schema.ts:17-29` — `posts` table, template for a new simple table.
- `src/server/db/schema.ts:36-48` — `users` table and `role` enum column.
- `src/server/api/trpc.ts:110` — `publicProcedure`.
- `src/server/api/trpc.ts:118-127` — `protectedProcedure`.
- `src/server/api/trpc.ts:135-140` — `adminProcedure`.
- `src/server/api/routers/post.ts:1-30` — full router/procedure pattern (whole file).
- `src/server/api/root.ts:1-24` — router registration pattern (whole file).
- `src/server/simulation/rng.ts:1-21` — seeded PRNG module (whole file).
- `src/server/simulation/rng.test.ts` — determinism tests for the RNG module.

## Architecture Insights

- Auth and role-awareness are already fully wired end-to-end (middleware → NextAuth config → tRPC context → `protectedProcedure`/`adminProcedure`), but zero procedures consume the gated variants yet in this inspected repository — S-01 is free to pick whichever guard its design calls for without fighting an existing inconsistent pattern.
- The RNG foundation is deliberately minimal (one function, one closure, no class/state object exposed beyond the returned `next()` closure) — any simulation state that needs to persist or be serialized (e.g., for save/resume in a later slice) will need its own wrapper, since `rng.ts` itself does not expose the internal seed/state for persistence.
- Drizzle schema conventions in this inspected file consistently avoid the `relations()` helper in favor of FK columns plus ad hoc relational-query-builder calls; a new simulation-run/score table should follow that same no-`relations()` convention for consistency, per `schema.ts`'s existing four tables.
- There is no existing router that gates by role yet, so S-01 (or whichever slice first needs it) is also effectively setting the project's first real-world precedent for protected/admin procedure usage — this is worth flagging explicitly in the plan rather than treated as "just like the others."

## Historical Context (from prior changes)

- `context/archive/2026-11-10-gate-product-routes/plan.md` — F-01's implementation plan; source for the auth/middleware/role design summarized above.
- `context/archive/2026-11-10-deterministic-seed-strategy/plan.md` — F-02's implementation plan; source for the "in-house mulberry32, zero dependency" decision and for naming S-01 as the RNG's first intended consumer.
- `context/archive/2026-11-10-deterministic-seed-strategy/reviews/impl-review.md` — post-implementation review of the RNG module; not read in full this pass, flagged here as available if S-01's plan needs more detail on accepted/rejected findings for that module.

## Related Research

- None found. No other `research.md` exists yet under `context/changes/**/` or `context/archive/**/` in this inspected repository.

## Open Questions

- **Flocking/boids algorithm choice** — this research deliberately did not investigate external boids algorithms (classic Reynolds separation/alignment/cohesion vs. alternatives) or canvas-rendering library choices (raw `<canvas>` + `requestAnimationFrame` vs. a library). That is external research scope, not internal codebase research, and per the roadmap's PRD refs (FR-001, FR-002 partial, FR-003, FR-004 partial, FR-010 partial, FR-018, US-01 partial) the plan will need to make an explicit, source-backed choice rather than default to the model's training-data memory of "boids."
- **Where simulation state lives for S-01** — no simulation-run/score table exists yet; the plan needs to decide whether S-01's run state is client-only (ephemeral, no persistence) or needs a new Drizzle table now versus deferring persistence to S-04 (`full-score-save-resume`), which owns "stop/save/resume with exact fidelity" per the roadmap's `At a glance` table.
- **Whether S-01's procedures need `protectedProcedure`** — F-01 gates every page route via middleware already, but S-01 is the first router to potentially call `protectedProcedure`/`adminProcedure` from a tRPC procedure; the plan should state explicitly which (if any) of S-01's procedures require this and why, since there is no existing call site to copy.
