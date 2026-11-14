# Branded Swarm Arena login page Implementation Plan

## Overview

Close the remaining gap in FR-031's "visual identity" requirement for the login page. The page's name/framing/color branding was already delivered end-to-end as part of F-06 (`ui-design-system-foundation`) Phase 2 — this plan covers only what's left: the browser tab icon.

## Current State Analysis

- `src/app/login/page.tsx` already shows `<h1>Swarm Arena</h1>` + "Sign in to continue" on the app's token-based gradient (`from-primary to-background text-foreground`), with the sign-in button on the matching `bg-input` token — delivered by F-06's Phase 2 (commit `cdc4bd6`), confirmed present via direct read.
- `src/app/layout.tsx`'s `metadata.title` is already `"Swarm Arena"` (F-06 Phase 1, commit `e5e80ec`).
- `public/favicon.ico` is unchanged since the repo's initial commit — still the generic default create-t3-app icon, referenced from `layout.tsx`'s `metadata.icons: [{ rel: "icon", url: "/favicon.ico" }]` (line unchanged by F-06).
- FR-031 (`context/foundation/prd.md`): "The login page is branded for 'Swarm Arena' specifically (name, framing, visual identity), replacing today's generic/default-looking login screen." Name and framing are done; the favicon is the one remaining "visual identity" surface, confirmed with the user as in-scope for this change.
- Manual regression testing performed in this session (dev server + Playwright, both the test-auth bypass and a real GitHub OAuth redirect) confirmed F-06's AppShell restructuring did not break the login/auth flow — out of scope for this plan, recorded here for context only.

## Desired End State

`public/favicon.ico` is replaced with a small branded glyph (three triangles in a V/flock formation — a boid/swarm motif matching the app's actual domain — on a rounded-square backdrop using the existing `--primary`/`--background` token colors), referenced identically from `layout.tsx` (no code change needed there — same filename, same `metadata.icons` entry).

### Key Discoveries

- No code change is required beyond the binary asset swap — `metadata.icons` already points at `/favicon.ico` by relative URL, and the file is served from `public/` unchanged in shape.
- The icon design and color choice were agreed with the user directly during this planning session (triangle/flock motif, dark backdrop matching the login gradient's end color) — not re-derived here.

## What We're NOT Doing

- No new logo/wordmark elsewhere in the app (header, email templates, etc.) — scope is the favicon only, per FR-031's text+color branding already being satisfied elsewhere.
- No re-litigating the login page's text/color branding — already shipped and verified by F-06.
- No further manual regression testing of the login/auth flow — already performed this session, unrelated to this plan's actual change (a static asset swap).

## Implementation Approach

Single phase: replace the favicon binary, verify it's referenced correctly, and confirm visually in the browser.

## Phase 1: Replace the favicon with a branded glyph

### Overview

Swap `public/favicon.ico` for the agreed boid/flock-glyph icon; no other files change.

### Changes Required:

#### 1. Replace the favicon asset

**File**: `public/favicon.ico`

**Intent**: Replace the default create-t3-app icon with a Swarm-Arena-specific glyph: three triangles in a V formation on a rounded-square backdrop, using the app's existing `--primary` (`#2e026d`-equivalent) and `--background` (`#15162c`-equivalent) token colors plus a light accent for the triangles, at the standard 16/32/48px multi-size `.ico` set.

**Contract**: Same filename (`public/favicon.ico`), same multi-resolution `.ico` format `next/font`/Next's static server already expects — no change to `src/app/layout.tsx`'s `metadata.icons` entry, which continues to reference `/favicon.ico` by relative URL.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- Full suite still passes: `npm test`
- `file public/favicon.ico` reports a valid `MS Windows icon resource` with more than one embedded size (confirms the multi-size `.ico` wasn't accidentally saved as a single-size file)

#### Manual Verification:

- Visiting `/login` (and any other page) in the browser shows the new triangle/flock glyph in the browser tab, not the old default icon
- The icon is legible (not a solid blob) at the actual rendered tab size

## Testing Strategy

### Unit Tests:

- None — this is a binary asset swap with no logic to test.

### Manual Testing Steps:

1. Load any page, confirm the new favicon renders in the browser tab (hard-refresh or clear favicon cache if the browser shows a stale cached icon).

## Performance Considerations

None — a ~15KB static icon file, same as before.

## Migration Notes

None.

## References

- `context/archive/2026-11-14-ui-design-system-foundation/plan.md` — the prior change that delivered the login page's text/color branding and app-wide title metadata this plan completes.
- `context/foundation/prd.md` FR-031 — the requirement this plan closes out.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Replace the favicon with a branded glyph

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck` — b3b7553
- [x] 1.2 Linting passes: `npm run check` — b3b7553
- [x] 1.3 Full suite still passes: `npm test` — b3b7553
- [x] 1.4 `file public/favicon.ico` reports a valid multi-size MS Windows icon resource — b3b7553

#### Manual

- [x] 1.5 New triangle/flock glyph renders in the browser tab on `/login` and other pages — b3b7553
- [x] 1.6 Icon is legible (not a solid blob) at actual tab size — b3b7553
