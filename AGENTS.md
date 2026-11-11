# Repository Guidelines

swarm-arena is a Next.js 16 app on the T3 stack (tRPC, Drizzle ORM over SQLite via libsql, Tailwind, Biome), bootstrapped with create-t3-app.

## Hard Rules

- New environment variables must be added to the schema in @src/env.js and documented in @.env.example — the T3 env validator throws at startup otherwise.
- Routers under `src/server/api/routers/` are not auto-discovered; register each one manually in @src/server/api/root.ts.
- `npm run check` / `check:write` (Biome) skip `CLAUDE.md`, `AGENTS.md`, `context/`, `skills-lock.json`, `.10x-cli.json`, and `.agents/` — see @biome.jsonc. Don't expect those paths to pass or be reformatted by Biome.
- See @CLAUDE.md for the 10xDevs AI-toolkit skill chain (`/10x-init` → `/10x-shape` → `/10x-prd`) and its rule that skills must never write to `context/archive/`.

## Project Structure

- `src/app/` — Next.js App Router pages and `_components/`.
- `src/server/api/` — tRPC: `trpc.ts` (context + procedures), `root.ts` (router aggregation), `routers/<name>.ts` per feature.
- `src/server/db/` — Drizzle schema (`schema.ts`) and client (`index.ts`); SQLite file at `db.sqlite`.
- `src/trpc/` — client/server tRPC wiring (`react.tsx`, `server.ts`, `query-client.ts`).
- `context/foundation/` — durable project docs (`prd.md`, `tech-stack.md`, `health-check.md`, `stack-assessment.md`) written by the `/10x-*` skills; see @context/foundation/README.md.

## Build, Test, and Development

- `npm run dev` — Next.js dev server with Turbopack.
- `npm run build` / `npm run start` — production build/serve.
- `npm run check` / `npm run check:write` — Biome lint + format (check vs. auto-fix).
- `npm run typecheck` — `tsc --noEmit`.
- `npm test` — Vitest (`vitest run`); test env sets `DATABASE_URL=file:./db.sqlite`, see @vitest.config.ts.
- `npm run db:push` / `db:generate` / `db:migrate` / `db:studio` — Drizzle Kit against @drizzle.config.ts.

## Coding Style & Naming

- Formatting and linting are enforced by Biome (@biome.jsonc); run `npm run check:write` before committing rather than hand-formatting.
- Import the `src/` tree via the `~/*` path alias (see @tsconfig.json), not relative `../../` chains.
- tRPC procedures are grouped by domain (e.g. `postRouter.hello`, `postRouter.create`); one router file per feature under `routers/`.

## Testing

- Tests live beside the code they cover (`*.test.ts`, e.g. @src/server/api/routers/post.test.ts), using Vitest's `describe`/`it`.
- Run a single file: `npx vitest run <path>`.
- No coverage threshold is currently enforced.

## UI

- Tokens live in `src/styles/globals.css` (`:root`, `@theme inline`). Canvas-only color values live in `src/styles/theme-colors.ts` and must be kept in sync with `globals.css` by hand — nothing enforces this automatically.
- Shared components live in `src/components/ui`. Check that directory before writing a new one; add missing ones via `npx shadcn@latest add <name>`.
- No literal colors or arbitrary Tailwind values in views — reference a token instead.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
