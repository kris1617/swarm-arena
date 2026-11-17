---
change_id: confirm-admin-elevation-mechanism-resolved
topic: "Roadmap slice S-38 grounding — formally closing Open Roadmap Question #6"
researcher: Claude Sonnet 5
date: 2026-11-17
status: complete
---

# Research: Confirm admin-elevation mechanism is resolved (roadmap slice S-38)

## Question

Open Roadmap Question #6: "What exact mechanism should temporary admin
elevation (FR-030/S-22) use — a self-service toggle, a time-boxed
grant, or something else?" The roadmap's own text claims this is
already resolved and shipped: time-boxed, self-service elevation,
decided during the archived `temporary-admin-elevation` change's
planning interview. This slice must confirm the claim against the
*current* code, not just the original 2026-11-14 plan — since the
sibling slice S-37 found that an "already resolved" claim can still
hide a real gap.

## Summary

Unlike S-37, this confirmation found **no gap**. Every component of the
originally-shipped mechanism is still present, unmodified, and
correctly wired as of 2026-11-17: the `elevatedUntil` column, the
`isEffectivelyAdmin` helper (same 4-case logic), both authorization
sites (`adminProcedure`, `/admin/settings`'s page-level redirect), the
5 tRPC procedures and their router registration, the `ALLOW_SELF_ELEVATION`
safety flag (currently unset in this repo's `.env`, which resolves to
disabled — matching its documented secure default), the elevation UI
at `/admin/elevation`, and the full test suite covering all the
originally-specified cases. No later change (searched all of
`context/archive/`) modified, superseded, or bypassed this mechanism.
`git log` on the two core files shows no commits after the original
implementation's own SHAs.

## Detailed findings

### 1. Core mechanism — unchanged

- `users.elevatedUntil` (`src/server/db/schema.ts:55`): still
  `d.integer({ mode: "timestamp" })`, nullable, no default — same
  shape as originally shipped.
- `isEffectivelyAdmin` (`src/server/auth/elevation.ts`): same 4-case
  logic (member → false; admin + null → true, permanent; admin +
  future `elevatedUntil` → true; admin + past → false), confirmed via
  direct read of the current implementation.
- `adminProcedure` (`src/server/api/trpc.ts:174-178`): still calls
  `isEffectivelyAdmin(ctx.session.user)`, no raw-role check.
- `src/app/admin/settings/page.tsx:14-17`: still redirects via
  `isEffectivelyAdmin(session.user)`, with its own comment noting the
  deliberate avoidance of a raw `role` read.
- `session` callback (`src/server/auth/config.ts:99-115`): still
  exposes both `role` and `elevatedUntil` on `session.user`. A
  repo-wide grep for every `.role` reference across `src/` found no
  new authorization-decision site reading `role` directly — the only
  hits are the session-population site, the helper's own internal
  check, an explanatory comment, and test assertions against raw DB
  rows (not runtime decisions).

### 2. Procedures, flag, and UI — unchanged

- `src/server/api/routers/user.ts` still has all 5 procedures
  (`elevateSelf`, `revertSelf`, `elevateAccount`, `revertAccount`,
  `listElevatedAccounts`), registered in `src/server/api/root.ts:15`.
- `elevateSelf` still gates on `ctx.allowSelfElevation`
  (`user.ts:41-43`), sourced through `createTRPCContext`
  (`trpc.ts:40`: `allowSelfElevation: env.ALLOW_SELF_ELEVATION`) —
  matching the original plan's "no hidden singleton reads" discipline,
  not a direct `env` import.
- `ALLOW_SELF_ELEVATION` is still defined in `src/env.js:38-41` and
  documented in `.env.example:32-36` (default `"false"`). This repo's
  own `.env` file has no `ALLOW_SELF_ELEVATION` entry at all — since
  the schema's `.optional().transform(v => v === "true")` resolves an
  unset var to `false`, self-elevation is currently **disabled** in
  this environment, matching the documented secure default.
- `src/app/admin/elevation/page.tsx` and its `elevation-form.tsx` still
  exist at the `/admin/elevation` route with the same structure: a
  self-elevate/self-revert section always reachable by any logged-in
  user (no role gate on the page itself), and a cross-account section
  gated behind `isCurrentlyAdmin` (computed via `isEffectivelyAdmin`).

### 3. Test coverage — still present

`src/server/api/routers/user.test.ts` and
`src/server/auth/elevation.test.ts` both still exist and cover every
case the original plan specified: flag-on/off self-elevation, lapsed-
grant rejection even when the DB `role` column still says `"admin"`,
unknown-email rejection, case-insensitive email matching, and
permanent-admin exclusion from `listElevatedAccounts`. (Confirmed by
reading the describe/it block structure; the full suite's actual
pass/fail is this change's own automated-verification gate, not
re-run here.)

### 4. No later change modified this mechanism

A grep across all of `context/archive/` for `ALLOW_SELF_ELEVATION`,
`elevateSelf`, and `elevation` after 2026-11-14 finds only two
incidental mentions (`in-app-feedback-module`, a changelog reference;
`pre-existing-admin-settings-flakes`, an unrelated test-flake fix) —
neither modifies the mechanism. `git log --oneline` on
`src/server/auth/elevation.ts` and `src/server/db/schema.ts` shows no
commits after the original implementation's own three phase SHAs
(`b1e07c5`, `9f34537`, `eb69177`).

## Response guidance — verified

- **"Confirm this is already resolved and shipped"** — confirmed fully.
  Every component is live, correct, and unmodified. Unlike S-37, no
  real gap was found during this verification pass.

## Open items for `/10x-plan`

- Given the clean confirmation, the plan for this slice is likely a
  pure documentation/closeout phase (no code changes) — same shape as
  S-37's plan structure, minus the code-fix phase, since there is
  nothing to fix.
