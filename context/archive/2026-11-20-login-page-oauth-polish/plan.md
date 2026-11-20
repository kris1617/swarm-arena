# Login page OAuth polish Implementation Plan

## Overview

Restyle the login page's sign-in button to match the neutral, bordered "Continue with X" convention Google/Microsoft's own provider-login buttons use, add a spinner to the pending state, and widen the login card slightly to give the full-width button room. Research confirmed the reported redirect-visibility gap is not a code defect — the OAuth redirect genuinely navigates to github.com and updates the browser's address bar; this plan documents that finding rather than "fixing" a working mechanism.

## Current State Analysis

- `src/app/login/_components/sign-in-button.tsx:7-16` — uses `<Button size="lg">` with no `variant`, resolving to `variant="default"` (`bg-primary`, branded solid color) — not the neutral/bordered style provider-login buttons conventionally use.
- `src/app/login/page.tsx:31` — the card is `max-w-sm`, centered, `rounded-xl border p-8`.
- `src/components/ui/button.tsx:12-13` — `variant="outline"` (`border-border bg-background hover:bg-muted hover:text-foreground`) is the closest existing match to the provider-login convention.
- `package.json:34` — `lucide-react` is already a dependency; no new package needed for a spinner icon.
- Redirect mechanism: confirmed working via direct browser test (Playwright, production build) — clicking the button navigates the real browser to `https://github.com/login?client_id=...`. Full detail: `context/changes/login-page-oauth-polish/research.md`.

## Desired End State

The sign-in button is a full-width, neutral/bordered button (matching the outline variant) with the GitHub icon unchanged, showing a spinner alongside "Redirecting…" text while its pending server action is in flight. The login card is modestly wider (`max-w-md`) to give the full-width button room. No change to the OAuth mechanism itself — research found it already works correctly.

### Key Discoveries:

- `GitHubIcon` (`src/components/icons/github-icon.tsx`) already renders as a monochrome mark inheriting the button's current text color — it will automatically adapt to the outline variant's foreground color with no separate edit.
- The button's pending state already exists via `useFormStatus()` (`sign-in-button.tsx:8`) — adding a spinner is a render-time addition to the existing conditional, not new state logic.

## What We're NOT Doing

- Not changing the OAuth provider (still GitHub only) — research explicitly confirmed this, matching the user's own stated scope.
- Not changing the redirect/sign-in mechanism (`signIn("github", {redirectTo})`, the server action, `authConfig`) — research found it already works correctly; this is a documented non-finding, not a deferred fix.
- Not changing the GitHub icon's size, color, or weight — user decision: keep as-is, it already adapts correctly to the new button variant.
- Not touching `src/server/auth/config.ts`, `src/middleware.ts`, or any other auth-flow file — presentation-only change.

## Implementation Approach

Single phase: 2 small presentational files, no logic change.

## Phase 1: Restyle the login page

### Overview

Restyle `SignInButton` (outline variant, full width, spinner) and widen the login card.

### Changes Required:

#### 1. Full-width outline button with a spinner

**File**: `src/app/login/_components/sign-in-button.tsx`

**Intent**: Switch to the neutral/bordered button style the "Continue with Google/Microsoft" convention uses, stretch it to the card's full width, and add a spinner alongside the existing "Redirecting…" text during the pending state for a more noticeable transition cue.

**Contract**: `<Button variant="outline" size="lg" className="w-full" disabled={pending} type="submit">` — add `import { Loader2Icon } from "lucide-react"` and render it conditionally when `pending` is true, alongside the existing `GitHubIcon` and text (e.g. `{pending ? <Loader2Icon className="animate-spin" /> : <GitHubIcon />}`), keeping the existing "Redirecting…"/"Continue with GitHub" text swap unchanged.

#### 2. Widen the login card

**File**: `src/app/login/page.tsx`

**Intent**: Give the now-full-width button more breathing room.

**Contract**: Change the card's `max-w-sm` to `max-w-md` (line 31's className).

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`
- Full suite still passes: `npm test`
- Hardcoded-value scan on both touched files stays at 0 hits: `grep -nE '#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(|-\[[0-9.]+(px|rem)\]|\b(bg|text|border|ring|outline|from|via|to|fill|stroke|shadow|divide)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)\b' src/app/login/_components/sign-in-button.tsx src/app/login/page.tsx`

#### Manual Verification:

- Live, production-build screenshot of `/login`: confirm the card is visibly wider, the button is full-width with a bordered/neutral background (not the branded purple), and the GitHub icon renders correctly.
- Trigger the button's pending state (or inspect the conditional directly) and confirm the spinner renders alongside "Redirecting…" text, with the icon swap happening correctly (no spinner in the idle state).
- Re-confirm the redirect itself still works after the restyle: click the button, confirm the browser navigates to `github.com` (same check research already performed) — this is a regression check on a working mechanism, not new verification territory.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to archive.

---

## Testing Strategy

### Unit Tests:

- None new — matches the milestone's established precedent (no existing unit tests for any login-page presentational component).

### Manual Testing Steps:

1. Screenshot `/login` at a representative desktop width, confirm the widened card and full-width outline button.
2. Confirm the spinner + "Redirecting…" state (via direct render inspection, since the real pending window is sub-second).
3. Re-run the redirect click-through check from research to confirm no regression.

## Performance Considerations

None — presentational change, `Loader2Icon` is a lightweight SVG already available via the existing `lucide-react` dependency.

## Migration Notes

None — no persisted data, no schema, no API surface touched.

## References

- `context/changes/login-page-oauth-polish/research.md` — redirect-visibility investigation (confirmed working, not reproduced as a defect) and the button-styling gap analysis.
- `context/archive/2026-11-14-branded-login-page/` — the login page's prior (and, until now, only) styling work.
- `src/components/ui/button.tsx:12-13` — the `outline` variant this plan adopts.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Restyle the login page

#### Automated

- [x] 1.1 Typecheck passes: `npm run typecheck` — f225429
- [x] 1.2 Lint passes: `npm run check` — f225429
- [x] 1.3 Full suite still passes: `npm test` — f225429
- [x] 1.4 Hardcoded-value scan on both touched files stays at 0 hits — f225429

#### Manual

- [x] 1.5 Live screenshot confirms wider card, full-width outline button, correct GitHub icon rendering — verified live (production build): card is visibly wider, button spans the card's inner content width (382px vs. 384px available) with a neutral/bordered background. Fixed a mismatch along the way: the plan's `w-full` on the Button alone had no effect because the wrapping `<form>` shrink-wraps under the card's `items-center` flex layout — added `className="w-full"` to the `<form>` too. — f225429
- [x] 1.6 Spinner + "Redirecting…" state renders correctly, no spinner in the idle state — verified via DOM inspection: idle state renders exactly 1 unclassed svg (GitHubIcon), confirming the ternary correctly omits the spinner when not pending; the pending branch uses the same established `useFormStatus()` ternary pattern the text swap already used successfully. — f225429
- [x] 1.7 Redirect click-through regression check still passes (browser navigates to github.com) — verified live: clicking the restyled button still navigates the browser to `https://github.com/login?client_id=...`, matching research's own finding with no regression. — f225429
