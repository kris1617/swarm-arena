---
title: Anti-Corruption Layer — the unwrapped {r,g,b} color representation
created: 2026-11-17
type: refactor-plan
---

# Anti-Corruption Layer: color representation

**Scope**: planning only — no production code is modified by this document.

## Step 0: Context

Read `context/foundation/prd.md`, `package.json`, and
`context/domain/domain-distillation.md` (this session's own M4L5 artifact
1/3). No document declares any component "intentionally swappable" in the
usual ACL sense (no stated intent to someday swap the color library, the
DB driver, or the auth provider). The project's actual external
dependencies (`drizzle-orm`, `next-auth`, `zod`, `@trpc/*`) were checked
first and found already well-isolated: Drizzle types never leak past
`src/server/*`, NextAuth's session type is isolated behind
`isEffectivelyAdmin`/`auth()` with no duplicated role logic, zod schemas
stay server-side, and `src/server/feedback/github-client.ts` already maps
GitHub's raw JSON response (`number`, `html_url`) to a clean domain shape
on its very first line of business logic — this project already practices
the pattern this exercise asks for, in that one place. This is a genuinely
clean codebase for 3rd-party-SDK leaks (confirmed by grep: `$inferSelect`/
`InferSelectModel` never appear anywhere, and no client file imports
`@trpc/server`, `drizzle-orm`, or `next-auth` directly).

**Second pass, checking every other entry in `package.json`'s dependency
list specifically for a leak** (prompted by a request to confirm no
stronger candidate was missed before finalizing this choice): the seeded
PRNG (`src/server/simulation/rng.ts`) is a hand-rolled mulberry32
implementation with an explicit comment stating *why* — "implemented
in-house rather than via a library dependency so the output sequence for
a given seed can never change out from under us via an upstream version
bump" — the opposite of a leak, a deliberate avoidance of one. `recharts`
is imported in exactly 2 files (`runs/[runId]/page.tsx`,
`runs/compare/page.tsx`), each with its own trivial one-line `.map()` data
transform (not duplicated business logic, and not spread beyond the 2
chart-rendering components that are recharts' only 2 possible consumers).
`@libsql/client` is imported in exactly one production file
(`src/server/db/index.ts`) — the only other match found by grep was a
code *comment* in a test file referencing the package by name, not an
import. `superjson` is imported on both the tRPC server config and the
client's query-client setup — this is tRPC's own documented contract (the
transformer must be configured identically on both sides), not a leak.
None of these beats the color-representation finding below.

Because no severe 3rd-party-SDK leak exists, Step 1 widens the search
(per the lesson's own signal list, which includes "duplicated
reconstruction of objects/types in multiple places" as a standalone
trigger, not only "same npm package in two layers") to the worst
*representation* leak found: a foreign wire/rendering format — the CSS
Canvas API's `rgb(...)` string contract — crossing the domain with no
Value Object ever owning it.

## Step 1: Identify leaking dependencies

**Candidate — the bare `{ r: number; g: number; b: number }` color shape.**
It is never a named domain type (just a 3-field anonymous object literal
type, `boids.ts:25`), yet it:

1. Is **constructed from a foreign hex-string format** (`hexToUnitColor`,
   `boids.ts:200-206`) — the exact inverse of what a browser's
   `ctx.fillStyle` or any CSS color picker expects.
2. Is **independently reconstructed a second time, in a different file**,
   to go the other direction — `colorToCss` (`simulation-canvas.tsx:189-200`)
   converts the same unit-interval triple back into the CSS `rgb(...)`
   string, with its own clamping/rounding logic, duplicated from scratch
   rather than calling a shared `.toCss()` on anything.
3. Has its own **third independent construction site** for blending —
   `blendChannel` (`boids.ts:784-788`) averages+mutates two colors into a
   child's color, again operating on the bare object with no shared
   "blend two colors" method living anywhere but this one function.
4. **Crosses the wire raw, with no DTO mapping** — the `stop` tRPC mutation's
   `survivingBoidGenes` input (`simulation.ts:438`) and the `getRunAnalysis`/
   `getRunsComparison` outputs (`simulation.ts:834,952`) all type `color` as
   the same bare `{r,g,b}` shape, persisted verbatim in the `history` JSON
   column (`schema.ts:150`) — client, server, and the database all agree on
   this shape by convention alone, not through one owning type.

**Files that "know" this shape today** (grep for the literal field triple
`r:`/`g:`/`b:` adjacent to color context):
- `src/server/simulation/boids.ts:25` (type declaration), `:200-206`
  (`hexToUnitColor`), `:784-792` (`blendChannel`/blend construction).
- `src/app/simulation/_components/simulation-canvas.tsx:189-200`
  (`colorToCss`).
- `src/server/api/routers/simulation.ts:438,562,834,952` (wire shape, input
  and both output types) — these don't reconstruct the conversion logic,
  but they do independently re-declare the same 3-field type shape in 3
  separate places (the input zod schema and the 2 output TS types) rather
  than referencing one shared `Color` type.

## Step 2: Classify and select #1

| axis | assessment |
|---|---|
| (a) layers/files touched | 2 layers (server simulation core, client canvas rendering), 5 files total (boids.ts, simulation-canvas.tsx, simulation.ts ×3 shape re-declarations), plus the persisted JSON column — this is the most-spread representation found in this codebase; every other checked dependency (Drizzle, NextAuth, zod, GitHub client) was confirmed isolated to 1 layer. |
| (b) risk/cost of changing today | Low-to-medium: not a 3rd-party library-swap risk (there's no library to swap — CSS color strings aren't going away), but a **real correctness risk**: the clamping/rounding behavior in `colorToCss` and the mutation-clamping in `blendChannel` are each their own independent implementation of "what happens at the edges of [0,1]," so a future change to one (e.g. a different rounding mode) has no structural reason to stay consistent with the other. |
| (c) documents declare swappability? | No document declares this representation as intended to be swappable — this is **not** an intention-vs-code gap (the lesson's strongest signal), which is why this candidate is honestly weaker than a textbook ACL case. It still qualifies under the lesson's broader "duplicated reconstruction in multiple places" trigger. |

**Selected, as the worst available candidate**: the unwrapped `{r,g,b}`
color representation. Named explicitly: this project does **not** have a
severe, intention-contradicting 3rd-party dependency leak — every real SDK
boundary (DB, auth, external HTTP) is already correctly isolated. The
"worst leak" standard the lesson asks for is still met by this
representation, which is genuinely the most-duplicated, most-independently-
reconstructed shape found anywhere in the codebase during this and the
two prior M4L5 passes.

## Step 3: Diagnosis

- **Duplication, quoted**: `hexToUnitColor` (`boids.ts:200-206`) —
  `r: Number.parseInt(value.slice(0, 2), 16) / 255` — vs. `colorToCss`
  (`simulation-canvas.tsx:197-199`) — `Math.round(Math.min(1, Math.max(0, value)) * 255)`
  — both files independently know that the domain representation is
  `[0,1]` floats and the wire/rendering representation is `[0,255]`
  integers, and both independently implement half of the round-trip, with
  no function or type connecting the two halves.
- **No dangerous leak across the client/server bundle boundary**: unlike a
  textbook ACL case, nothing server-only (a DB client, a secret-bearing
  SDK) is pulled into the client bundle here — `colorToCss` is a pure,
  dependency-free function, already correctly client-safe. The danger here
  is purely **inconsistency risk**, not a security/bundle-size leak.
- **No document declares intended swappability** that the code fails to
  honor — this diagnosis step, which the lesson expects to find a sharp
  intention-vs-code gap, instead confirms there is no such gap in this
  codebase for any 3rd-party SDK. The ACL below is offered as the next-best
  available exercise target, not as a fix for a broken promise.

## Step 4: ACL design

**Domain value object — the sole owner of the shape**: `Color`
(`src/server/simulation/color.ts`, new). Since there is no swappable 3rd-party
library here, there is no separate "port interface," only the value object
itself — its public methods ARE the narrow surface the rest of the code is
allowed to depend on.

```ts
// src/server/simulation/color.ts (new)

export class Color {
  private constructor(
    readonly r: number,
    readonly g: number,
    readonly b: number,
  ) {}

  // The ONLY place that knows the hex-string wire format.
  static fromHex(hex: string): Color {
    const value = hex.replace("#", "");
    return new Color(
      Number.parseInt(value.slice(0, 2), 16) / 255,
      Number.parseInt(value.slice(2, 4), 16) / 255,
      Number.parseInt(value.slice(4, 6), 16) / 255,
    );
  }

  // The ONLY place that knows the HSL->RGB math (moves hslToUnitColor here).
  static fromHsl(hueDegrees: number, saturation: number, lightness: number): Color { /* unchanged math, relocated */ }

  // The ONLY blend implementation — moves blendChannel's per-channel
  // average+clamp logic here as a single method instead of 3 repeated
  // channel calls at the caller.
  blend(other: Color): Color { /* unchanged math, relocated */ }

  // The ONLY place that knows the CSS rgb(...) wire format — moves
  // colorToCss's clamping/rounding here, so the client's canvas renderer
  // calls `color.toCss()` instead of reimplementing the conversion.
  toCss(): string { /* unchanged math, relocated */ }

  // Plain-object escape hatch for persistence/wire serialization ONLY —
  // the one place allowed to produce the bare {r,g,b} shape that crosses
  // the tRPC/JSON boundary, and the one place allowed to reconstruct a
  // Color from it on the way back in.
  toJSON(): { r: number; g: number; b: number } { return { r: this.r, g: this.g, b: this.b }; }
  static fromJSON(json: { r: number; g: number; b: number }): Color { return new Color(json.r, json.g, json.b); }
}
```

No repository is needed (this is a pure value object, not an aggregate with
persistence of its own) and no atomicity concern applies (color math has no
transactional boundary). The "thin adapter" in this case is `toJSON`/
`fromJSON` — the two methods that intentionally still produce/consume the
bare shape, but only at the serialization boundary, not scattered through
business logic.

## Step 5: Isolation proof and before/after

**Proof that a representation change touches only `color.ts`**: after this
refactor, the only files that would need to change if, say, the clamping
rule changed from `Math.round` to a different rounding mode, or the CSS
output format changed from `rgb()` to `rgba()`, would be `color.ts` itself
— `boids.ts` would call `.fromHex()`/`.blend()`, never reimplementing the
math; `simulation-canvas.tsx` would call `.toCss()`, never reimplementing
clamping; `simulation.ts`'s wire types would reference `Color`'s
`toJSON()`/`fromJSON()` shape instead of re-declaring the 3-field object 3
times independently.

| site | before | after |
|---|---|---|
| `boids.ts:200-206` (`hexToUnitColor`) | free function, own implementation | `Color.fromHex(hex)` |
| `boids.ts:784-792` (`blendChannel` × 3 calls) | 3 repeated per-channel calls | `parentA.genes.color.blend(parentB.genes.color)` — one call |
| `simulation-canvas.tsx:189-200` (`colorToCss`) | free function, own clamp/round | `color.toCss()` |
| `BoidGenes.color` type (`boids.ts:25`) | bare `{r,g,b}` | `Color` (in-memory); `.toJSON()` at the one point it's persisted/sent over the wire |
| `simulation.ts:438,834,952` (3 independent shape re-declarations) | each re-declares `{r,g,b}` | each imports and reuses one shared wire-shape type derived from `Color.toJSON()`'s return type |

**UI gets finished domain data, not a raw library object**: the client
canvas already receives `genes.color` as plain data (not a library object)
— the fix here is narrower than the textbook "UI gets a raw SDK object"
case: the client gets the *right shape*, just without a type/method that
guarantees it was produced consistently with the server's own color math.
After the refactor, `simulation-canvas.tsx` calls `.toCss()` on a `Color`
it reconstructed via `Color.fromJSON(wireData)`, rather than hand-rolling
the conversion against a bare object it trusts by convention.

**No open question depends on this library's own documentation** — there is
no 3rd-party library here, so Step 5's "resolve open questions from the
library's docs" instruction doesn't apply; the relevant decision (keep
`Math.round` vs. another rounding mode, keep `rgb()` vs. `rgba()`) is
encoded directly in `Color.toCss()` itself once written, which is exactly
where the lesson says such a decision belongs (in the ACL, not the API
layer) — there's simply no external document to consult for it.

## Step 6: Verification and phased plan

**Success criterion**: `rg "\.replace\(\"#\", \"\"\)|toChannel\(" src` (the
two independent hex-parsing/channel-rounding implementations) returns
matches only inside `color.ts` after the refactor — today it returns
matches in both `boids.ts` and `simulation-canvas.tsx`.

**Files that know the dependency today → after**:
- `boids.ts` — knows hex-parsing, HSL math, blend math → after: imports
  `Color`, knows none of the math.
- `simulation-canvas.tsx` — knows CSS-string construction/clamping → after:
  imports `Color`, calls `.toCss()`.
- `simulation.ts` — re-declares the shape 3 times → after: references one
  shared type.
- `color.ts` (new) — the only file that ever will know any of this math.

**Phased plan** (matches this project's established guard-first
convention, per `context/archive/2026-11-17-refactor-opportunities/`):

1. **Phase 1 (test-first)**: write `color.ts` + `color.test.ts`, with
   characterization tests asserting byte-identical output to today's three
   free functions for the same inputs (reuse `boids.test.ts`'s existing
   fixed-seed test data for `fromHex`/`blend`; reuse any existing
   `colorToCss` test cases for `toCss`) — pin behavior before any call site
   depends on the new class.
2. **Phase 2**: migrate `boids.ts`'s three call sites
   (`hexToUnitColor`→`fromHex`, `hslToUnitColor`→`fromHsl`,
   `blendChannel`→`.blend()`) to the new class; run the existing
   `boids.test.ts` suite (including the two color-distinctness/hue-spread
   regression tests from `genetic-inheritance-crossbreeding`) to confirm no
   behavior change.
3. **Phase 3**: migrate `simulation-canvas.tsx`'s `colorToCss` call site;
   run `simulation-canvas.test.tsx`.
4. **Phase 4**: consolidate `simulation.ts`'s 3 independent shape
   re-declarations into one shared type derived from `Color`.

## Summary

This codebase has no severe, intention-contradicting 3rd-party-dependency
leak — Drizzle, NextAuth, zod and the GitHub HTTP client are all already
correctly isolated, the last one (`github-client.ts`) already modeling the
exact pattern this exercise asks for. The worst available candidate is
narrower: the bare `{r,g,b}` color representation is independently
reconstructed in three places (hex-parsing in `boids.ts`, CSS-string
construction in `simulation-canvas.tsx`, and per-channel blending, also in
`boids.ts`), with the same anonymous shape re-declared three more times
across the tRPC wire contract, and no Value Object ever owning the
conversions. A `Color` class consolidates all of this behind
`fromHex`/`fromHsl`/`blend`/`toCss`/`toJSON`/`fromJSON`, leaving the
bare-object shape to exist only at the serialization boundary it's actually
needed for. The migration is low-risk (pure relocation of unchanged math,
not a behavior change) and phases in the same guard-first order this
project already uses elsewhere.
