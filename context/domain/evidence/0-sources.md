# Source inventory — code scope and stack

- repo_root: /home/kris/10xdevs
- head: eaede3c
- worktree: clean
- code_scope: whole repository (no `--root` narrowing; single application, no monorepo split needed)
- stack: Next.js 16 (App Router) + tRPC + Drizzle ORM (SQLite via libsql) + Tailwind + Biome, bootstrapped with create-t3-app. Standalone second module `tools/ai-reviewer/` (Claude Agent SDK, Zod) — a CI code-review tool, not part of the product's own domain (excluded from domain-language scanning as infrastructure/tooling, not business logic).

## Layers

- **Routes / pages**: `src/app/**/page.tsx` (App Router) — `simulation`, `dashboard`, `leaderboard`, `runs`, `runs/compare`, `reference/*`, `admin/*`, `login`, plus `*/kitchen-sink` design-showcase pages (excluded from domain language — internal QA tool, not product vocabulary).
- **API / business logic**: `src/server/api/routers/*.ts` (tRPC procedures) — `simulation.ts` (by far the largest), `user.ts`.
- **Simulation engine**: `src/server/simulation/*.ts` — `boids.ts`, `single-run-lifecycle.ts`, `server-run-registry.ts`, `parameter-ranges.ts`, `seed-colors.ts`, `spatial-grid*.ts`, `color.ts`, `rng.ts`.
- **Data model**: `src/server/db/schema.ts` (Drizzle table definitions), `drizzle/` (generated migrations).
- **Auth**: `src/server/auth/*.ts` (NextAuth/Auth.js config, actions), `src/middleware.ts`.
- **Client components**: `src/app/**/_components/*.tsx`, `src/components/*.tsx`, `src/components/ui/*.tsx` (shared design system, excluded from domain language — presentation primitives, not business vocabulary).
- **Feedback**: `src/server/feedback/*.ts`.

## Exclusions

- `tools/ai-reviewer/*` — CI tooling, not product domain.
- `src/components/ui/*` — shared shadcn-based design-system primitives (Button, Dialog, etc.) — UI framework vocabulary, not business vocabulary.
- `*/kitchen-sink/*` pages — internal component/token showcase pages, not product-facing.
- `node_modules/`, `.next/`, `drizzle/meta/*.json` (migration journal, mechanical) — generated/vendored.
- Test files (`*.test.ts(x)`) — read by the code-rules agent for *where a rule is guarded*, but not as a source of new domain vocabulary (they test vocabulary already defined elsewhere).

## File count

963 tracked files (git ls-files --cached --others --exclude-standard) — well under the 1,500-file split threshold; one code-rules agent suffices.
