# Swarm Arena

A boids + predator-prey simulation lab: configure a flocking/evasion simulation, run it, score the outcome against explicit criteria, and compare variants side by side. Built as a learning exercise in both swarm behavior and agentic development (10xDevs course project).

## What it does

- **Configure and run simulations** — boid count, predator count, per-tribe behavior weights (separation/alignment/cohesion), food/energy dynamics, world size, and more, run either client-side or as a server-owned process.
- **Score and compare** — every finished run gets a score; the dashboard, leaderboard, and a bounded 2-4-run comparison view let you tell whether a parameter change actually helped.
- **Pause and resume** — save a running simulation's full live state and pick it back up later instead of losing a long-running experiment.
- **Live parameter tuning** — adjust weights, tribe configs, and population counts on a running simulation, with soft range warnings rather than hard rejection.
- **Full lifecycle, including delete** — start, read, update, and delete your own runs (soft-delete for regular users; an admin can hard-delete, gated behind the app's self-elevation flow).

## Tech stack

Next.js 16 (App Router, Turbopack) on the T3 stack — tRPC, Drizzle ORM over SQLite (libsql), NextAuth (GitHub OAuth), Tailwind + shadcn/ui, Biome for lint/format. See `AGENTS.md` for repo conventions and `context/foundation/tech-stack.md` for the full rationale.

## Getting started

```bash
npm install
npm run db:push     # apply the schema to a local db.sqlite
npm run dev          # Next.js dev server with Turbopack
```

See `.env.example` for required environment variables (GitHub OAuth app credentials, `AUTH_SECRET`, etc.) — the app refuses to start without them (validated in `src/env.js`).

One-time per clone: `git config core.hooksPath .githooks` enables a local pre-push gate (lint + typecheck + build) that mirrors deploy CI, so a break never reaches `origin/master`.

## Testing

- `npm test` — Vitest unit/integration suite (`src/**/*.test.ts`).
- `npx playwright test` — Playwright E2E suite (`tests/e2e/`); `tests/e2e/visual-regression.spec.ts` is the deploy-blocking visual gate in CI.
- `npm run typecheck` / `npm run check` — `tsc --noEmit` / Biome lint.

See `context/foundation/test-plan.md` for the project's risk-first test strategy and `context/foundation/lessons.md` for recurring gotchas (including known test-flakiness patterns and their fixes).

## Project context

This repo uses the [10xDevs AI-toolkit](https://przeprogramowani.pl) skill chain for planning and implementing changes — see `CLAUDE.md` for the chain and `context/foundation/` for durable project docs (PRD, roadmap, infrastructure, test plan). `context/changes/` and `context/archive/` hold per-change plans and their history.

## Deployment

Deploys to a VPS via GitHub Actions (`.github/workflows/deploy.yml`) on every push to `master`, gated by lint, typecheck, the unit suite, and the visual-regression E2E check. See `context/foundation/infrastructure.md` for the platform choice and setup.
