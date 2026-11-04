---
project: swarm-arena
assessed_at: 2026-11-03T20:00:00Z
agent_readiness: ready-with-compensation
context_type: brownfield
stack_components:
  language: typescript
  framework: next.js (app router) + trpc + drizzle-orm
  build_tool: biome (lint/format) + next build
  test_runner: null
  package_manager: npm
  ci_provider: null
  deployment_target: null
gates_passed: 5
gates_failed: 3
---

## Stack Components

**Language**: TypeScript 5.8, strict mode. `tsconfig.json` sets `strict: true` and
`noUncheckedIndexedAccess: true` — above-default strictness, not just the TS baseline.

**Framework**: Next.js 15 (App Router) as the meta-framework, tRPC 11 for the typed
client/server RPC layer, Drizzle ORM 0.41 over SQLite (via `@libsql/client`) for persistence.
This is the T3 Stack combination. File layout follows T3/App Router convention:
`src/app/` (routes), `src/server/api/` (tRPC routers), `src/server/db/` (schema + client),
`src/trpc/` (client wiring).

**Build tool**: Biome 2.2 (bundled dev dependency, pinned `^2.2.5`, installed `2.6.4`) handles
both linting and formatting in one tool, replacing the ESLint+Prettier pair T3 used to ship.
`next build` / `next dev --turbo` handle the actual bundling.

**Test runner**: none configured. No `vitest.config.*`, `jest.config.*`, or `playwright.config.*`
on disk, and no `test` script in `package.json`.

**Package manager**: npm (`package-lock.json` present; `package.json` pins
`"packageManager": "npm@9.2.0"`).

**CI/CD**: none detected — no `.github/workflows/`, `.gitlab-ci.yml`, or equivalent. (The
tech-stack hand-off records `ci_provider: github-actions`, but no workflow file was generated —
CI scaffolding is explicitly out of scope for the bootstrapper's v1.)

**Deployment**: none detected — no `Dockerfile`, `fly.toml`, `vercel.json`, etc. (The hand-off
records `deployment_target: fly`, same caveat as CI/CD above.)

**Instruction files**: `CLAUDE.md` exists at the repo root, but it is the 10xDevs toolkit's own
workflow-router file (skill descriptions, chain hand-offs) — it carries no stack-specific
conventions for this codebase yet.

**Note**: `package.json`'s `name` field still reads `.bootstrap-scaffold` — a leftover from the
bootstrapper's temp-directory scaffold step. Not a quality-gate finding, but worth a one-line
rename to `swarm-arena` before this ships anywhere public (npm metadata, lockfile headers, etc.
will otherwise carry the scaffold's internal name).

## Quality Gate Assessment

| Component                        | Typed | Convention | Training Data | Documented | Verdict               |
| -------------------------------- | ----- | ---------- | ------------- | ---------- | --------------------- |
| Language (TypeScript)            | ✓     | —          | —             | —          | pass                  |
| Framework (Next.js+tRPC+Drizzle) | —     | ✓          | ✓             | ✓          | pass                  |
| Build tool (Biome)               | —     | ✓          | ✗             | ✗          | fail                  |
| Test runner                      | —     | —          | —             | —          | fail (not configured) |

Legend: ✓ = pass, ✗ = fail, ~ = partial, — = not applicable

### Gate Details

**Typed — pass.** `tsconfig.json` sets `strict: true`, `noUncheckedIndexedAccess: true`,
`checkJs: true`. tRPC propagates types end-to-end between `src/server/api/` and
`src/trpc/react.tsx` with no manual re-declaration. Drizzle's `schema.ts` is the single source
of truth for both the DB shape and the inferred TS types used elsewhere. An agent can read
function signatures and trust them without running the program.

**Framework convention — pass.** Next.js App Router enforces file-based routing
(`src/app/layout.tsx`, `src/app/page.tsx`); tRPC enforces a router-registration pattern
(`src/server/api/root.ts` composing sub-routers); Drizzle enforces schema-as-code
(`src/server/db/schema.ts`). A stranger — or an agent — can predict where a new route, a new
tRPC procedure, or a new table definition belongs without reading the whole tree first.

**Framework training-data popularity — pass.** Next.js is a top-tier framework in JS/TS training
data; tRPC and Drizzle are both widely represented in modern TypeScript full-stack examples
(T3 Stack itself is a well-known, frequently-referenced combination). Assessed within the JS/TS
family, not against other language ecosystems.

**Framework documentation — pass.** Next.js, tRPC, and Drizzle each ship current, versioned
official docs (`nextjs.org/docs`, `trpc.io/docs`, `orm.drizzle.team`) that match the installed
major versions (Next 15, tRPC 11, Drizzle 0.41).

**Build tool convention — pass.** Biome is single-config, single-tool (`biome.jsonc`) covering
both lint and format, which is itself a convention win over juggling separate ESLint +
Prettier configs with potentially conflicting rules.

**Build tool training-data popularity — fail.** Biome is newer and less represented in LLM
training data than the ESLint + Prettier pair it replaces. An agent is more likely to default to
ESLint/Prettier idioms or syntax when asked to "add a lint rule" unless steered explicitly toward
Biome's own configuration shape.

**Build tool documentation — fail.** Direct evidence from this bootstrap run: the scaffolded
`biome.jsonc` referenced a linter rule key (`useSortedClasses` with an `options.functions`
sub-key) that the installed Biome engine (2.6.4) no longer recognizes — the generator's template
had drifted out of sync with the current schema. Fixing it required running `biome migrate`
(Biome's own self-healing tool), not just reading the docs. This is concrete evidence of
version/schema churn outpacing the generated config, independent of Biome's docs quality in
general.

**Test runner — fail (absent).** No test runner is configured at all. There is no convention,
training-data, or documentation question to score — the gap is that nothing exists yet.

## Gaps & Compensation

### Gap 1: No test runner configured

Why it matters for agent workflows: without a test runner, an agent (or you) has no fast
feedback loop to verify a change didn't break the simulation scoring logic, the tRPC routers, or
the Drizzle schema migrations. Given this project's determinism requirement (NFR: "the same
parameters + seed produce the same score"), tests are especially load-bearing here — that's
exactly the kind of property that regresses silently without a test suite.

**Compensation**: add Vitest (the T3/Next.js ecosystem's de facto standard, and the option
`create-t3-app` itself offers when `--trpc` is selected) rather than Jest — it shares Vite's
config style, runs faster, and has first-class TypeScript support with no extra transform config.

### Gap 2: Biome's generated config drifted from the installed engine's schema

Why it matters: an agent asked to "add a Biome rule" may write a key shape that matches outdated
examples (from its training data or from stale docs) and silently produce a config that errors
out exactly like the one this bootstrap run just fixed.

**Compensation**: document the installed Biome version and the self-healing command in the
project's instruction file, so an agent (or you) reaches for `biome migrate` first instead of
hand-editing rule keys from memory.

### Recommended Instruction File Additions

Paste into `CLAUDE.md` (or `AGENTS.md`):

```markdown
## Testing

This project uses Vitest. Test files live next to the code they test, named `*.test.ts`
(e.g. `src/server/api/routers/simulation.test.ts`). For tRPC routers, test via the router's
`createCaller` pattern rather than spinning up an HTTP server:

\`\`\`ts
const caller = appRouter.createCaller(createContext());
const result = await caller.simulation.score({ runId });
\`\`\`

Any change to scoring logic (src/server/api/routers/_score_) or to simulation determinism
(seeded RNG, population update order) must land with a test that pins the expected output for a
fixed seed — this project's core guardrail is "same parameters + seed = same score."

## Biome (lint/format)

This project uses Biome `^2.2.5` (installed: check `node_modules/@biomejs/biome/package.json`
for the exact resolved version) for both linting and formatting via `biome.jsonc`. Before adding
or editing a rule key in `biome.jsonc`:

1. Run `npx biome migrate --write` first — it will auto-correct any rule keys that have been
   renamed or had their options schema changed between Biome releases.
2. If you still get a `deserialize` / "unknown key" error after migrating, check
   `node_modules/@biomejs/biome/configuration_schema.json` for the exact accepted shape of that
   rule's `options` object before guessing from memory or older examples — Biome's nursery rules
   in particular change shape between minor versions.

Do not add ESLint or Prettier config files alongside Biome — this project intentionally uses
Biome as the single lint+format tool.
```

## Summary

**Overall readiness: ready-with-compensation.** The core of the stack — TypeScript, Next.js App
Router, tRPC, Drizzle — clears all four agent-friendly criteria cleanly: it's typed end-to-end,
strongly conventional in file layout, mainstream within the JS/TS ecosystem, and well-documented
with versioned docs matching the installed majors. The two gaps found are narrow and both have
concrete compensation already drafted above: no test runner is configured yet (add Vitest,
anchored on this project's scoring-determinism guardrail), and Biome's generated config has
already shown schema drift once this session (compensate by always running `biome migrate`
before hand-editing rule keys). Neither gap requires revisiting the stack choice itself.

Key strength worth calling out: the project's hardest requirement — deterministic, resumable,
parallel long-running simulations — was already the reason T3 (not the registry's edge-runtime
default) was picked during stack selection; nothing in this assessment contradicts that choice.

Next: run `/10x-health-check` to audit dependencies, confirm the missing CI/CD and deployment
config (both deferred by the bootstrapper's v1, not yet addressed), and get a prioritized fix
list before writing the first feature code.
