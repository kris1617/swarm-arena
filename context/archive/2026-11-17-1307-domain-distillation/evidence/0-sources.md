# Sources: code

- repo_root: /home/kris/10xdevs
- code_scope: .
- head: a9b5abe (clean except for an in-progress toolkit install: `.claude/.10x-cli-manifest.json` and 4 new `.claude/prompts/`/`.claude/skills/` paths from installing this very skill — not product code)
- path_alias: none needed (single-package repo, `~/*` tsconfig alias maps to `src/*`)

## Stack

- TypeScript, Next.js (App Router), single npm package at repo root.
- tRPC for the API layer (routers under `src/server/api/routers/`).
- Drizzle ORM over SQLite (via libsql).
- NextAuth for session/auth.
- Vitest for tests; Playwright for E2E (referenced in toolkit docs, not yet installed as a dependency at this commit).
- Deployed via Docker + GitHub Actions + Caddy to a self-hosted VPS (not part of the product domain).

## Layers

| layer | path patterns | notes |
|---|---|---|
| entry points | `src/app/**/page.tsx`, `src/app/api/**/route.ts`, `src/server/api/routers/*.ts` (tRPC procedures) | Next.js App Router pages + 2 custom Route Handlers (`/api/auth/[...nextauth]`, `/api/runs/[runId]/export`) + tRPC router procedures |
| application logic | `src/server/simulation/*.ts` (non-test), `src/server/api/routers/*.ts` (procedure bodies, not just routing) | the bulk of business logic lives here, not in a separate "service" layer |
| domain types | `src/server/db/schema.ts` (Drizzle table definitions double as the type source), `src/server/simulation/boids.ts` (in-memory state types: `BoidGenes`, `BoidState`, `PredatorGenes`, `PredatorState`), `src/server/simulation/server-run-registry.ts` (`LiveRun`, `ServerRunParams`, `ServerRunSnapshot`) | no dedicated `models/` or `domain/` directory — types live next to the logic that uses them |
| persistence | `src/server/db/schema.ts`, `drizzle/*.sql` (migrations), `src/server/db/index.ts` (client) | single schema file, 9 migrations as of this commit |
| UI | `src/app/**/_components/*.tsx`, `src/components/ui/*.tsx` (shared design-system primitives) | App Router convention: `_components` folders colocated with their route |
| tests | `*.test.ts`/`*.test.tsx` colocated next to the file under test (no separate `tests/` or `__tests__/` tree); `*.corpus.test.ts` for seeded-fixture integration tests | 38 test files at this commit |

## Excluded

| path | reason |
|---|---|
| `context/domain/`, `context/archive/*-domain-distillation/` | this distillation's own output and prior runs |
| `.claude/`, `.agents/`, `.10x-cli.json`, `skills-lock.json` | agent tooling configuration, not the product |
| `scripts/` | dev/CI/benchmark tooling (corpus generation, perf baseline) — not product code, though `scripts/corpus/*` touches domain data shapes and is noted where relevant |
| `.github/workflows/`, `Dockerfile`, `docker-compose.yml`, `Caddyfile`, `deploy.sh` | deployment infrastructure, not the product domain |
| `drizzle/meta/*.json` | generated migration metadata snapshots |
| `AGENTS.md`, `CLAUDE.md` | agent instruction files — but these DO describe business flows/conventions, so listed as *reference* documents for the docs agent, per this skill's own carve-out |
| `node_modules/`, `.next/` | vendored/generated, not tracked anyway |
