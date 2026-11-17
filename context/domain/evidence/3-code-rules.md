# Code rules inventory (evidence)

Scope read (per brief): `src/server/api/routers/simulation.ts`, `src/server/simulation/server-run-registry.ts`,
`src/server/simulation/boids.ts`, `src/server/simulation/parameter-ranges.ts`, `src/server/api/routers/user.ts`,
`src/server/db/schema.ts`. All line numbers verified against the files as read in this session.

Legend: **layer** = DB constraint | application-code guard | type-level | comment-only (no enforcement).
**strictness** = hard (throw/reject) | soft (clamp/warn/default) | none (documented only).

---

## Ownership / authorization (application-code guard, hard, unless noted)

1. `stop` requires caller owns the run — `simulation.ts:511-513`: `if (run.userId !== ctx.session.user.id) { throw new TRPCError({ code: "FORBIDDEN" }); }`. Evidence.
2. `stop` requires run status `"running"` — `simulation.ts:515-517`: `if (run.status !== "running") { throw ... BAD_REQUEST }`. Evidence.
3. `stop` forbids stopping a server-owned run via this path — `simulation.ts:527-532`: `if (isServerRunActive(input.runId)) { throw ... "Run is server-owned — use savePause instead of stop" }`. Evidence.
4. `updateRunParams` requires ownership — `simulation.ts:1033-1035`: `if (run.userId !== ctx.session.user.id) throw FORBIDDEN`. Evidence.
5. `updateRunParams` requires `status === "running" && isServerRunActive(runId)` — `simulation.ts:1036-1041`. Evidence.
6. `adjustLivePopulation` requires ownership — `simulation.ts:1090-1092`. Evidence.
7. `adjustLivePopulation` requires `status === "running" && isServerRunActive(...)` — `simulation.ts:1093-1098`. Evidence.
8. `savePause` requires ownership — `simulation.ts:1175-1177`. Evidence.
9. `savePause` requires `status === "running" && isServerRunActive(...)` — `simulation.ts:1178-1183`. Evidence.
10. `resume` requires ownership — `simulation.ts:1237-1239`. Evidence.
11. `resume` requires `status === "saved" && run.savedState` present — `simulation.ts:1240-1245`. Evidence.
12. `getRunAnalysis` requires ownership + `status === "stopped"` — `simulation.ts:818-826`. Evidence.
13. `getRunsComparison`: per-row ownership/status check, but failures become a data marker (`"not-found"|"forbidden"|"not-completed"`) rather than throwing — `simulation.ts:931-942`. Note: deliberately *not* hard-fail; it's a soft per-row rule by design (comment at `simulation.ts:885-890`).
14. `watch` subscription requires caller `userId` match via `watchServerRun` — `server-run-registry.ts:858-861`: `if (row.userId !== opts.userId) throw FORBIDDEN`.
15. `watchServerRun` also requires the run be active — `server-run-registry.ts:862-867`: `if (!isServerRunActive(opts.runId)) throw BAD_REQUEST`.
16. All `listRunning`/`listSaved`/`listCompleted`/`listLeaderboard`/`getParameterSuggestion` scope queries by `eq(simulationRuns.userId, userId)` — e.g. `simulation.ts:635-639`, `659-663`, `687-691`, `723-729`, `779-784`. Application-code guard, hard (query-level isolation, not a throw).
17. `start`/`startServer` require a session user id — `simulation.ts:347-350`, `360-363`: `if (!userId) throw UNAUTHORIZED`. (Redundant with `protectedProcedure`'s own guard — see gap note below.)

## Admin authorization (application-code guard, hard)

18. `updateParameterRanges` is `adminProcedure` — `simulation.ts:1298` (gate itself lives in `trpc.ts`, not read this session — **unknown**, not verified here).
19. `getParameterRanges` is `protectedProcedure` (any logged-in user may read ranges; only admin may write) — `simulation.ts:1294`, comment `1291-1293`.
20. `user.elevateAccount`/`revertAccount`/`listElevatedAccounts` are `adminProcedure` — `user.ts:66`, `93`, `116`.
21. `user.elevateSelf` requires `ctx.allowSelfElevation` (sourced from `env.ALLOW_SELF_ELEVATION`, not read this session) — `user.ts:41-43`: `if (!ctx.allowSelfElevation) throw FORBIDDEN`. Application-code guard, hard; gate is env-driven, default-disabled per comment `user.ts:33-37` (not verified against env.js in this pass — **inference** from comment).
22. `elevateSelf`/`elevateAccount` cap elevation duration — `user.ts:15-19`: `z.number().int().positive().max(MAX_DURATION_MINUTES)` where `MAX_DURATION_MINUTES = 1440` (`user.ts:13`). Type-level (zod), hard.
23. Email matching for admin target lookup is case-insensitive via `lower()` SQL, deliberately (comment explains `users.email` has no `COLLATE NOCASE`) — `user.ts:25-30`. Application-code guard.
24. `listElevatedAccounts` excludes permanent `ADMIN_EMAILS`-sourced admins (`elevatedUntil` null) by filtering `isNotNull(users.elevatedUntil) AND elevatedUntil > now()` — `user.ts:118-121`. Application-code guard; comment at `112-115` states the intent explicitly.

## Concurrency / race-safety guards (application-code guard, hard)

25. `insertRunningSimulation`: pre-insert count check against `MAX_PARALLEL_RUNS` — `simulation.ts:268-283`, then a **post-insert recheck** that reverts (`status: "stopped"`) and throws if the race let the count exceed the cap — `simulation.ts:320-338`. Hard reject (eventually consistent via compensating update, not a transaction).
26. `startServer`: if `assertWithinConcurrentObjectCeiling` throws after the row was inserted, the row is rolled back to `status: "stopped"` — `simulation.ts:376-385`. Hard.
27. `startServer`: if `startServerRun` throws after DB insert, same rollback — `simulation.ts:388-408`.
28. `stop`'s update is conditioned on `status === "running"` at write time (`and(eq(id,...), eq(status,"running"))`), so a losing race on a second concurrent `stop` call throws `"Run already stopped"` instead of silently double-writing — `simulation.ts:578-592`. Hard, comment explains intent at `547-550`.
29. `savePause`'s update is likewise conditioned on `status === "running"` — `simulation.ts:1197-1209`; failure path logs loudly (`console.error`) rather than silently swallowing — `1211-1219`.
30. `resume`'s update is conditioned on `status === "saved"` — `simulation.ts:1267-1276`; failure path logs loudly — `1278-1286`.
31. `startServerRun` throws if called twice for the same `runId` (double-registration guard) — `server-run-registry.ts:602-607`: `if (registry.has(params.runId)) throw new Error(...)`.
32. `resumeServerRun` throws if called for an already-active `runId` — `server-run-registry.ts:759-763`.
33. Live-edit throttling: `applyLiveParams` rejects (returns `{status:"throttled"}`) if called again within `PARAM_UPDATE_THROTTLE_MS = 500`ms of the last update for that run — `server-run-registry.ts:200`, `224-233`. Surfaced as `TOO_MANY_REQUESTS` in `simulation.ts:1061-1066`.
34. `adjustLivePopulation` (registry fn) shares the identical 500ms throttle, same field (`lastParamUpdateAt`) — `server-run-registry.ts:307-316`. Surfaced in `simulation.ts:1151-1156`.
35. `adjustLivePopulation`'s zero-delta is a true no-op (skips changelog + throttle update) — `server-run-registry.ts:319-324`.

## Population / object-count ceilings

36. `MAX_PARALLEL_RUNS` — the number of simultaneously `"running"` rows per user — enforced in `insertRunningSimulation` (`simulation.ts:268-283`, recheck `316-338`). Value defined in `run-slots.ts` (not read this session — **unknown** exact number, but confirmed used as a hard per-user cap, not per-run population).
37. Per-run combined cap `boidCount + predatorCount <= maxObjectCount` (admin-configurable, default `DEFAULT_MAX_OBJECT_COUNT = 500`, `parameter-ranges.ts:71`) — enforced **hard** at `start`/`startServer` time via `checkAgainstAdminRanges`, `simulation.ts:242-247`: `if (input.boidCount + input.predatorCount > maxObjectCount) throw BAD_REQUEST`.
38. Same per-run cap enforced **soft** (warning only) for live population edits via `checkPerRunObjectCapSoft` — `simulation.ts:162-172`, called at `simulation.ts:1121-1128`.
39. Cross-run concurrent-object ceiling (sum of boidCount+predatorCount across all of a user's server-ticking runs) `<= maxConcurrentObjectCount` (default `150`, `parameter-ranges.ts:107`) — enforced **hard** at `startServer`/`resume` via `assertWithinConcurrentObjectCeiling`, `simulation.ts:125-155` (throws `BAD_REQUEST` at `149-154`), called at `370-375` and `1247-1252`.
40. Same cross-run ceiling enforced **soft** (warning) for live population edits via `checkConcurrentObjectCapSoft` — `simulation.ts:182-222`, called at `1129-1138`.
41. In-tick combined population cap (`params.populationCap`, i.e. FR-018 ceiling across both species) enforced inside `reproducePopulation` — `boids.ts:862-869`: loop breaks (`capped = true`) once `population.length + offspring.length + totalOtherPopulationCount >= populationCap`. **Soft, silent no-op per decision #7** (comment `boids.ts:816-819`): blocked pairs are marked paired but produce no offspring — not a throw, a documented design choice.
42. `stop` mutation input caps every sample array at `.max(50_000)` elements (`cohesionSamples`, `foodRatioSamples`, `phaseHistory`, `survivingBoidGenes`, `populationCountSamples`, `populationDensitySamples`, `geneticDiversitySamples`, `parameterChanges`) — type-level (zod), hard; e.g. `simulation.ts:419`, `425`, `437`, `461`, `468`, `472`, `481`, `499`.
43. `listCompleted`/`listLeaderboard`/`getParameterSuggestion` bound result set sizes via `.limit(50)` / `.limit(500)` — `simulation.ts:693`, `731`, `785`. Application-code guard against unbounded reads (not a correctness invariant, a resource bound).
44. `getRunsComparison` input bounded `z.array(z.number()).min(2).max(4)` — `simulation.ts:892`. Type-level, hard.

## Parameter-range validation

45. `startInputSchema` enforces type/sign sanity only (positive/nonnegative/finite/int, `flockCount` in `[2,4]`, `mutationChance`/`mutationMagnitude` in `[0,1]`) — `simulation.ts:60-79`. Type-level (zod), hard. Numeric ceilings themselves are NOT static (per comment `54-59`) — moved to admin-configurable ranges.
46. `checkAgainstAdminRanges` enforces every `RANGED_PARAMETER_NAMES` field against the admin's stored `{min,max}` at `start`/`startServer` time — `simulation.ts:224-248`: `if (value < range.min || value > range.max) throw BAD_REQUEST`. Hard. Booleans are skipped (`crossbreedingEnabled`) via `typeof value === "boolean"` short-circuit, `simulation.ts:231-233` — matches the "structurally inert" note in `parameter-ranges.ts:50-57`.
47. `updateRunParams` validates the same ranges but only **soft** (warns, still applies) via `checkLiveParamRangesSoft` — `parameter-ranges.ts:80-97`, called `simulation.ts:1049`.
48. `adjustLivePopulation` validates the resulting count against ranges, also **soft** — `simulation.ts:1117-1120`.
49. `updateParameterRanges` (admin-only) validates `min <= default <= max` for every ranged parameter before writing — `simulation.ts:1314-1322`: `if (!range || range.min > range.default || range.default > range.max) throw BAD_REQUEST`. Hard.
50. `updateParameterRanges` also requires `maxObjectCount`/`maxConcurrentObjectCount` to be positive integers — type-level (zod) at `simulation.ts:1309-1310`. No cross-check enforced that `maxConcurrentObjectCount <= maxObjectCount` or vice versa — **no guard found, searched: `updateParameterRanges` body (`simulation.ts:1298-1340`) and `checkAgainstAdminRanges`** — these two ceilings can be set admin-side into any relative order.
51. Default parameter ranges themselves, `parameter-ranges.ts:39-69`, are comment-documented (not enforced in code) to "match the pre-S-04 hardcoded zod bounds exactly" — comment-only cross-reference, not re-verified against any removed zod schema (that schema no longer exists in this file).

## Lifecycle states and legal transitions

52. `simulationRuns.status` is a DB-level enum `["running","stopped","saved"]` with `notNull().default("running")` — `schema.ts:130-133`. DB constraint (SQLite CHECK-via-enum through Drizzle), hard at the type/migration level — not verified whether Drizzle enforces this as an actual SQL CHECK constraint or only at the TS type layer (**unknown** — would need to inspect generated migration SQL, not in scope read).
53. Legal transitions observed in code (no explicit state-machine table; inferred from guards):
    - `running -> stopped` via `stop` (`simulation.ts:578-592`) or `finishRun` (`server-run-registry.ts:443-451`).
    - `running -> saved` via `savePause`, only for server-owned runs (`simulation.ts:1197-1209`).
    - `saved -> running` via `resume` (`simulation.ts:1267-1276`).
    - No transition out of `stopped` exists anywhere in this file (`stopped` is terminal) — **no guard found, searched: every mutation in `simulation.ts`** for a write setting status away from `"stopped"`; absence is structural (nothing targets a stopped row), not an explicit rejection.
    - `saved -> stopped` or `saved -> saved` direct writes: not found in this file.
    This is an application-code convention (inferred/evidence mix), not a single enforced state-machine; each transition is independently guarded per-procedure rather than centrally.
54. A server-owned run's "liveness" (registry membership) must agree with DB `status: "running"` but the two are NOT atomically coupled — e.g. comment at `simulation.ts:118-124` explicitly notes a client-staged `"running"` row never appears in the registry, and `assertWithinConcurrentObjectCeiling`'s filter `row.id !== excludeRunId && isServerRunActive(row.id)` (`simulation.ts:146`) exists specifically to distinguish the two. This is a documented invariant ("DB status alone does not imply server-ownership") enforced by always pairing a DB status check with `isServerRunActive(...)` at every server-run-specific procedure (`updateRunParams` 1036, `adjustLivePopulation` 1093, `savePause` 1178, `stop`'s negative check 527).

## Physics / simulation invariants (boids.ts)

55. Hard minimum separation distance enforced by direct positional correction (not a steering force) — `boids.ts:91-95` constant, enforced in `resolveOverlaps` `boids.ts:426-461`: any pair closer than `MIN_SEPARATION_DISTANCE` (4) is pushed apart until exactly that far. Comment explicitly: "This is a hard constraint, not a tunable force — it cannot be outweighed by cohesion regardless of weights" (`421-425`). Application-code guard, hard (geometric correction, not a throw).
56. Cruise speed is clamped every tick to `[genes.minSpeed, genes.maxSpeed]` for boids — `boids.ts:666-670`, and to fixed `[PREDATOR_MIN_SPEED, PREDATOR_MAX_SPEED]` for predators — `boids.ts:734-737`. Soft clamp (`Math.min(Math.max(...))`), not a rejection.
57. Lifespan decays every tick (`lifespan - dtSeconds`) and death is enforced by filtering `lifespan > 0` after every step — boids: `boids.ts:683-689`; predators: `boids.ts:750-754`. Hard filter (dead individuals removed from the array that tick).
58. Hunger accelerant: when `nextFoodStock < 0`, an *additional* lifespan decay (`HUNGER_EXTRA_DECAY_RATE`) is applied on top of the unconditional per-tick decay, and the result is re-filtered for `lifespan > 0` — `boids.ts:956-978`. Comment: "deliberately one death mechanism with an accelerant, not two independent ones (FR-008)" (`950-955`).
59. Predation ("protection threshold") invariant: a flock at or below `protectionThreshold` is never attacked — `boids.ts:992-994`: `if (boids.length <= protectionThreshold) return boids;` (early return, no capture logic runs at all). Hard, directly implements the PRD's named US-01 acceptance criterion per the comment at `980-984`.
60. Predation capture: a boid already captured by an earlier predator in the same tick cannot be captured again — enforced via a `captured: Set<BoidState>` checked per predator scan, `boids.ts:1008-1032` (`if (!boid || captured.has(boid)) continue;`). Hard.
61. Reproduction eligibility is a conjunction of two conditions — `boids.ts:834-839`: `individual.energy >= params.energyThreshold && individual.age >= MATURITY_AGE_SECONDS`. Hard gate (ineligible individuals are skipped as mate candidates, `874-876`).
62. Reproduction mate-matching additionally requires: not already paired this tick (`870-872`, `892`), opposite gender (`899-901`: `if (parentA.gender === parentB.gender) continue;`), and — when crossbreeding is disabled — same flock (`902-907`: `if (!params.crossbreedingEnabled && parentA.genes.flockId !== parentB.genes.flockId) continue;`), and within `MATE_DISTANCE_RADIUS` (`908-913`). All hard (skip-candidate), not throws.
63. Population cap during reproduction (see #41 above) is enforced by stopping the *outer* scan early, not by throwing — `boids.ts:862-869`. Soft/silent per decision #7 (explicit comment).
64. Energy is clamped to `[0 implicit, ENERGY_MAX]` on gain every tick — `boids.ts:1128-1135` (boids), `1136-1143` (predators): `Math.min(ENERGY_MAX, energy + ENERGY_GAIN_RATE * dtSeconds * ratio)`. Soft clamp (`Math.min`), no floor clamp coded (energy can't go below 0 only because nothing subtracts energy in this file — **no explicit floor-clamp guard found, searched: every `energy` assignment in boids.ts**; it's implicitly non-negative only because INITIAL_ENERGY=20 and gains are always added, never subtracted, in this file's scope).
65. Newborn genes are blended from parents and then re-clamped to `[0,1]` only for color channels — `boids.ts:780-786` (`blendChannel` clamps; `blendNumber` used for all other numeric genes does NOT clamp). So e.g. `maxSpeed`, `minSpeed`, `maxLifespan`, `separationWeight` etc. can mutate outside their original seed ranges with no enforced bound — **no guard found, searched: `inheritGenes`, `boids.ts:762-811`** — this is a documented, intentional design point ("a mutated descendant can cruise outside the range its ancestors started in", comment `boids.ts:662-665`), not a gap.
66. `flockCount` is constrained to `[2,4]` only at the API boundary (`z.number().int().min(2).max(4)`, `simulation.ts:70`) — boids.ts itself has no internal guard against a `flockCount` of 0/1/5+; `createFlockColors`/`splitCountAcrossFlocks` would behave oddly (division by flockCount) but there is no runtime check in boids.ts — **no guard found, searched: `createInitialPopulation`, `createInitialPredators`, `splitCountAcrossFlocks`, `createFlockColors` in boids.ts**. Enforcement is entirely at the zod/type-level boundary one layer up.

## DB schema constraints (schema.ts) — DB constraint layer, hard at insert time

67. `users.email` — `unique()` constraint — `schema.ts:43`.
68. `accounts` composite primary key `(provider, providerAccountId)` — `schema.ts:76`.
69. `sessions`/`accounts` foreign keys to `users.id` with `onDelete: "cascade"` — `schema.ts:63-64`, `84`.
70. `verificationTokens` composite primary key `(identifier, token)` — `schema.ts:95`.
71. `simulationRuns.userId` — NOT NULL foreign key to `users.id`, `onDelete: "cascade"` — `schema.ts:101-103`.
72. `simulationRuns` — every core run-config column (`seed`, `boidCount`, `separationWeight`, `alignmentWeight`, `cohesionWeight`, `maxDurationSeconds`, `predatorCount`, `protectionThreshold`, `foodStockInitial`, `foodRegenRate`) is `.notNull()` with no default — `schema.ts:104-113` — every INSERT must supply them explicitly (confirmed: `insertRunningSimulation`'s `.values(...)` at `simulation.ts:287-309` supplies all of them).
73. `simulationRuns` — later-added columns (`flockCount`, `crossbreedingEnabled`, `energyThreshold`, `mutationChance`, `mutationMagnitude`, `xyArea`, `zDepth`, `wasEverThrottled`) are `.notNull().default(...)` — `schema.ts:118-129`, `158` — DB-level default backfill for migration compatibility, comment explains why (`114-117`, `123-127`).
74. `simulationRuns.status` enum + default `"running"` — `schema.ts:130-133` (duplicate of #52, listed here for the schema-constraint angle).
75. `adminSettings.id` is the primary key, and the "exactly one row" singleton invariant is explicitly **application-layer only**, not DB-enforced — comment `schema.ts:161-165`: "a singleton enforced at the application layer (always upsert/read that fixed id), not a DB-level constraint, since SQLite has no native 'exactly one row' check short of a trigger this project doesn't need." This is a named, conscious gap, not an oversight.
76. `adminSettings.parameterRanges` is `.notNull()` JSON-mode text column — `schema.ts:172`; no DB-level validation of its internal shape (that's `ParameterRanges`'s TS type only, and `updateParameterRanges`'s runtime check, #49) — DB layer is just NOT NULL + opaque JSON blob.
77. `feedbackReports.userId` — NOT NULL FK to `users.id`, `onDelete: "cascade"` — `schema.ts:196-198`.
78. `feedbackReports.status` enum `["pending","sent","abandoned"]`, default `"pending"` — `schema.ts:204-207`.
79. `simulationRuns.savedState`/`history` are nullable JSON columns with no DB-level shape check — `schema.ts:144`, `150` — shape is enforced (loosely, via guarded casts, not schema validation) only at read time in `simulation.ts` (`getRunAnalysis` comment `828-849`, `getRunsComparison` comment `944-948`) — these are **comment-documented, code-guarded-cast, not type-system-verified** reads: a hand-corrupted JSON blob degrades to a `null`/no-data response rather than crashing, per explicit impl-review comments.

## Coverage notes / explicit gaps found

- No guard found anywhere in the read scope enforcing `maxConcurrentObjectCount <= maxObjectCount` (item 50).
- No guard found enforcing an energy floor of 0 in boids.ts beyond the absence of any subtraction operation (item 64) — not a concern in current code paths, but not a structural invariant either.
- No guard found bounding `flockCount` inside boids.ts itself (item 66) — relies entirely on the zod schema one layer up (`simulation.ts:70`).
- `adminSettings` "exactly one row" is explicitly a *documented, intentional* non-DB-enforced invariant (item 75) — not a gap, a stated trade-off.
- `MAX_PARALLEL_RUNS`'s actual numeric value lives in `run-slots.ts`, not read in this pass — flagged as **unknown**, not verified.
- `adminProcedure`'s underlying admin-check logic and `env.ALLOW_SELF_ELEVATION` wiring live in `trpc.ts`/`env.js`/`auth/config.ts`, not read in this pass — flagged as **unknown**, not verified (only the call sites that *use* these gates were confirmed).
- Whether `simulationRuns.status`'s Drizzle `enum` actually compiles to a SQL CHECK constraint in the generated migration, versus being TS-type-only, was not verified (migrations were out of this read's scope) — flagged **unknown**.
