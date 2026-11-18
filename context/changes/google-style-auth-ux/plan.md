# Google-style auth UX Implementation Plan

## Overview

Replace the bare-bones `/login` page and silent one-click sign-out with a polished,
Google-style sign-in/sign-out experience — centered card, GitHub icon, pending
states, a visible error banner, deep-link preservation, a real user menu with
avatar, and a sign-out confirm dialog. GitHub remains the sole identity
provider; no auth/session logic, schema, or RBAC behavior changes.

## Current State Analysis

- `src/app/login/page.tsx` is a bare gradient full-page layout with a hand-rolled
  `<button>` (not the shared `Button` component), no icon, no pending state, no
  error handling, and a hardcoded `redirectTo: "/dashboard"` that ignores any
  `callbackUrl` next-auth's own middleware already appends.
- `src/components/app-shell.tsx`'s sidebar footer has a plain "Sign out"
  `SidebarMenuButton` with no confirmation, no pending state, and no user
  identity (name/avatar) shown anywhere in the app.
- Sign-in/out is 100% Server-Action based (`signIn`/`signOut` from
  `~/server/auth`, never `next-auth/react`) — no client-side session hooks
  exist anywhere in the app today.
- `session.user.image`/`.name` already flow through from GitHub's profile on
  first sign-in via the Drizzle adapter (`src/server/db/schema.ts:42,45`,
  `src/server/auth/config.ts:95-116`) — nothing needs to change to make them
  available, they're just never rendered.
- next-auth's `authorized` callback returning `false`
  (`src/server/auth/config.ts:123`) triggers the framework's own middleware
  redirect to `/login`, which auto-appends `?callbackUrl=<original-url>`
  (confirmed in `node_modules/next-auth/lib/index.js`). `/login` currently has
  no `searchParams` prop at all, so this is silently dropped.
- No `pages.error` is configured today. Per `@auth/core`'s actual redirect
  logic, only errors whose `kind === "signIn"` (`SignInError` subclasses)
  land on `pages.signIn` (`/login`) with `?error=<Type>` — `AccessDenied`
  extends `AuthError` directly (`kind: "error"`), so it currently redirects
  to next-auth's own default `/api/auth/error?error=AccessDenied` instead,
  not `/login` (plan-review F2). The installed v5-beta `@auth/core` also uses
  different error-type names than v4 (`OAuthSignInError`,
  `OAuthCallbackError`, `OAuthAccountNotLinked`, `CallbackRouteError`, etc.),
  not the legacy `OAuthSignin`/`OAuthCallback`/`Callback` names.
- No icon, dropdown-menu, avatar, or alert-dialog primitive exists in
  `src/components/ui/` today; `lucide-react` (already a dependency) has no
  GitHub brand icon in the installed version.

### Key Discoveries:

- `src/components/ui/button.tsx:49-52` — `Button` has no built-in
  loading/pending prop; any pending UI composes externally.
- `src/components/ui/status-message.tsx` is `min-h-screen` — a whole-page
  replacement, not suited for an inline banner.
- `AGENTS.md` hard rule: a page's own root element must be `<div>`, never
  `<main>`, when wrapped by `AppShell`'s `SidebarInset` — but `/login` is
  rendered *outside* `AppShell` (`src/app/layout.tsx:31`: only wraps when
  `session?.user` is truthy), so `/login`'s own `<main>` root is its one
  landmark and stays correct.
- This Next.js version's `searchParams` page prop is a `Promise` (confirmed in
  `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md`)
  — must `await searchParams`.
- `cn` is imported from the `"cn"` package (not a local util) —
  `src/components/ui/button.tsx:2`.

## Desired End State

Visiting any gated URL while signed out lands on a centered, card-styled
`/login` with a GitHub-icon button; a failed sign-in shows a readable error
banner instead of a blank/generic error page; signing in from a deep link
returns the user to that original URL (not always `/dashboard`); once signed
in, the sidebar shows the user's GitHub avatar and name behind a dropdown menu
whose "Sign out" item asks for confirmation before it actually signs out, and
`/login` acknowledges a completed sign-out with a brief message.

**Verification**: `npm run typecheck`, `npm run check`, `npm test`, and the new
Playwright spec (`tests/e2e/auth-ux.spec.ts`) all pass; manual click-through of
every path below confirms the behavior.

## What We're NOT Doing

- No change to GitHub as the identity provider, no additional OAuth providers.
- No change to session strategy (stays database-backed via `DrizzleAdapter`),
  schema, or the `role`/`elevatedUntil`/admin-elevation logic.
- No light/dark theme toggle — this app has one theme (per `globals.css`'s own
  documented decision); the new card/banner/menu use existing tokens only.
- No confirmation dialog on sign-in — only sign-out gets one, per the approved
  decision.
- No attempt to drive GitHub's real OAuth consent screen from Playwright (not
  possible); E2E coverage for the sign-in path stops at the pre-redirect UI and
  the redirect target, not a completed OAuth round-trip (see Phase 4).

## Implementation Approach

Four phases, each independently verifiable: (1) add the new shared primitives
and dependencies with no visible behavior change yet, (2) rebuild `/login`
end-to-end, (3) add post-login identity + confirmed sign-out, (4) cover the new
UI with Playwright. Phases 2 and 3 are the only ones with user-visible
behavior changes; 1 and 4 are purely additive.

## Critical Implementation Details

**Nesting AlertDialog inside a DropdownMenu item**: Radix's `DropdownMenu`
unmounts its content as soon as an item is selected, which would unmount a
nested `AlertDialog` before it can render. The confirm dialog must be rendered
as a sibling of the `DropdownMenu` (its own `open` state in the parent
component), not via `AlertDialogTrigger` placed inside a `DropdownMenuItem`.
The item's `onSelect` handler calls `event.preventDefault()` (to stop the
dropdown from stealing focus back) and then opens the dialog via state.

**`useFormStatus` placement**: `useFormStatus` only reports the pending state
of the nearest enclosing `<form>` and must live in a component *rendered
inside* that form, not the component that defines the form's `action`. Each
pending-state button (sign-in, sign-out, sign-out confirm) is its own small
`"use client"` leaf component rendered as a child of the relevant `<form>`.

## Phase 1: Shared primitives & new dependencies

### Overview

Add the three new shadcn primitives, the inline GitHub icon, and a small
reusable banner component. No existing file changes, no visible behavior
change — this phase only makes new building blocks available.

### Changes Required:

#### 1. New shadcn UI primitives

**Command**: `npx shadcn@latest add dropdown-menu avatar alert-dialog`

**Intent**: Add the three primitives the later phases need, via this repo's
own established path for adding missing `src/components/ui/*` components
(`AGENTS.md`: "add missing ones via `npx shadcn@latest add <name>`").

**Contract**: Produces `src/components/ui/dropdown-menu.tsx`,
`src/components/ui/avatar.tsx`, `src/components/ui/alert-dialog.tsx`, built on
the same `radix-ui` unified package + `cva` + `cn` pattern as the existing
`button.tsx`/`sheet.tsx`. No manual edits to the generated files beyond what
the CLI produces, unless the CLI's output conflicts with this repo's existing
token usage (verify `bg-popover`/`text-popover-foreground` etc. map to this
app's tokens, not unstyled defaults). Plan-review F4: the CLI is
network-dependent and templated by this project's `"radix-nova"` style, which
isn't cached locally — treat the CLI's actual diff as the source of truth
rather than assuming exactly 3 files with zero other side effects (e.g. the
generated `alert-dialog.tsx` may import `buttonVariants` from the existing
`button.tsx` — expected, not a defect).

#### 2. GitHub icon

**File**: `src/components/icons/github-icon.tsx` (new)

**Intent**: Provide the GitHub mark as a zero-dependency inline SVG, since the
installed `lucide-react` version has no GitHub brand icon.

**Contract**: Exports `GitHubIcon(props: React.SVGProps<SVGSVGElement>)`
rendering the standard GitHub octocat mark as a single `<path>` in a 16x16
viewBox, `fill="currentColor"`, spreading `...props` so callers can size it
the same way lucide icons are sized elsewhere (`className="size-4"` etc. —
matches the convention in `src/components/ui/button.tsx:7`'s
`[&_svg:not([class*='size-'])]:size-4` global rule).

#### 3. Compact auth banner

**File**: `src/app/login/_components/auth-banner.tsx` (new)

**Intent**: A small, non-full-page message component for `/login`'s error and
sign-out-acknowledgment states — `status-message.tsx` is `min-h-screen` and
wrong for this.

**Contract**: `AuthBanner({ tone, children }: { tone: "error" | "info";
children: React.ReactNode })`. `tone="error"` uses `bg-destructive/10
text-destructive border-destructive/30` (existing `--destructive` token,
matching the `destructive` `Button` variant's color family); `tone="info"`
uses `bg-muted text-muted-foreground border-border`. Single bordered, rounded,
padded `<div>` — no portal, no dismiss button.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`
- New files exist: `test -f src/components/ui/dropdown-menu.tsx && test -f src/components/ui/avatar.tsx && test -f src/components/ui/alert-dialog.tsx && test -f src/components/icons/github-icon.tsx && test -f src/app/login/_components/auth-banner.tsx`

#### Manual Verification:

- `npm run dev` boots with no console errors after adding the new shadcn primitives (no behavior to click through yet — this phase is additive only)

---

## Phase 2: Redesign `/login`

### Overview

Rebuild `/login` as a centered card: icon button with a pending state, a
visible error banner for `?error=`, a safely-validated `?callbackUrl=`
honored on successful sign-in, and a sign-out acknowledgment banner for
`?signedOut=1` (wired fully in Phase 3, read here).

### Changes Required:

#### 1. Safe callback-URL resolution (pure, unit-testable)

**File**: `src/app/login/safe-redirect.ts` (new)

**Intent**: Resolve the `callbackUrl` query param next-auth's middleware
already appends into a redirect target, rejecting anything that isn't a
same-origin relative path — closes the open-redirect class the recommended
answer called for.

**Contract**: `resolveSafeRedirect(raw: string | string[] | undefined,
currentOrigin: string, fallback: string): string`. Takes the first element
when `raw` is an array. next-auth's middleware sends an **absolute** URL
(`request.nextUrl.href`), not a relative path — plan-review F1 — so this
resolves `raw` via `new URL(raw, currentOrigin)` and accepts it only if the
result's `.origin` equals `currentOrigin`; on acceptance, returns the
pathname+search+hash (normalizing a same-origin absolute URL down to a
relative path). Anything that fails to parse or resolves to a different
origin (cross-origin, protocol-relative, malformed) returns `fallback`.
`currentOrigin` is a parameter (not read via `headers()` internally) so the
function stays pure and directly unit-testable.

#### 2. Error-code → message mapping

**File**: `src/app/login/auth-error-messages.ts` (new)

**Intent**: Map next-auth's default error codes to short, friendly copy
instead of the raw `?error=` value.

**Contract**: `resolveAuthErrorMessage(code: string | string[] |
undefined): string | null`. Returns `null` when `code` is absent. Recognizes
the error types actually reachable with this app's GitHub-only, no-credentials
provider setup (plan-review F2 — these are the real v5-beta `@auth/core`
names, not v4 legacy ones): `Configuration`, `OAuthSignInError`,
`OAuthCallbackError`, `OAuthAccountNotLinked`, `CallbackRouteError`,
`MissingCSRF`, `AccountNotLinked`, `AccessDenied` (reachable on `/login` once
`pages.error` is set — see item 5 below) — each with a one-line message
(e.g. `AccessDenied` → "GitHub denied access to this account."); any
other/unknown code falls back to a generic "Something went wrong signing in.
Please try again." — never echoes the raw code to the user.

#### 3. Sign-in button (pending state)

**File**: `src/app/login/_components/sign-in-button.tsx` (new)

**Intent**: A `"use client"` leaf rendered inside the sign-in `<form>` so
`useFormStatus` can disable the button and swap its label while the GitHub
redirect is in flight.

**Contract**: Default export, no props. Uses `useFormStatus` from
`react-dom`; renders the shared `Button` (`size="lg"`) containing `GitHubIcon`
+ label text, `disabled={pending}`, label becomes "Redirecting…" while
`pending` is true.

#### 4. `/login` page rewrite

**File**: `src/app/login/page.tsx`

**Intent**: Centered card layout (replacing the full-bleed gradient), reading
and validating `searchParams`, rendering the error/info banner, and threading
the validated redirect target into `signIn`.

**Contract**: `export default async function LoginPage({ searchParams }: {
searchParams: Promise<{ error?: string; callbackUrl?: string; signedOut?:
string }> })`. Root stays `<main>` (page is not wrapped by `AppShell` — see
Current State Analysis). Inner card: `bg-card border-border text-card-foreground
rounded-xl border p-8 shadow-sm`, centered via the existing flex wrapper.
Renders `AuthBanner tone="error"` when `resolveAuthErrorMessage` returns
non-null; else `AuthBanner tone="info"` when `signedOut === "1"`; else
nothing. The page calls `headers()` (from `next/headers`) to derive
`currentOrigin` (protocol via `x-forwarded-proto`, host via
`x-forwarded-host`/`host` — the same proxy-aware reasoning this app's
`AUTH_TRUST_HOST` already relies on). The form's server action computes
`resolveSafeRedirect(callbackUrl, currentOrigin, "/dashboard")` and passes
the result as `signIn("github", { redirectTo }).

#### 5. Route all auth errors through `/login`

**File**: `src/server/auth/config.ts`

**Intent**: Plan-review F2 — without `pages.error`, `AccessDenied`-kind
errors land on next-auth's own unstyled default error page instead of this
plan's new banner. Unify every error kind onto `/login`.

**Contract**: Add `error: "/login"` alongside the existing `pages: { signIn:
"/login" }`. Before relying on this, confirm at implementation time that
`/login` not requiring authentication avoids tripping `@auth/core`'s
`ErrorPageLoop` guard (`node_modules/@auth/core/index.js:93-105` checks
whether the configured error page itself requires auth) — if it does trip,
fall back to plan-review F2's Fix B (leave `AccessDenied` on the default
page, narrow `resolveAuthErrorMessage`'s recognized set to only the
`kind: "signIn"` codes) and note the deviation in Progress.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`
- Unit tests pass: `npx vitest run src/app/login/safe-redirect.test.ts src/app/login/auth-error-messages.test.ts`
- Full suite still passes: `npm test`

#### Manual Verification:

- Visiting `/login` directly shows the new centered card with the GitHub icon on the button
- Clicking the sign-in button shows a disabled/"Redirecting…" state before the GitHub redirect happens
- Visiting `/login?error=AccessDenied` shows the mapped friendly error banner (now reachable on `/login` after item 5's `pages.error` change); `/login?error=SomeUnknownCode` shows the generic fallback, not the raw code
- Visiting a protected URL while signed out (e.g. `/dashboard`) redirects to `/login?callbackUrl=<absolute-url>` and, after a real GitHub sign-in, lands back on the originally requested URL — confirms `resolveSafeRedirect` actually accepts the real absolute `callbackUrl` next-auth sends, not just a hand-crafted relative-path test input
- Visiting `/login?callbackUrl=https://evil.example.com` and signing in lands on `/dashboard` (fallback), not the external URL

---

## Phase 3: Post-login identity & sign-out

### Overview

Surface the signed-in user's avatar/name in the sidebar behind a dropdown
menu, move "Sign out" inside it behind a confirm dialog, and acknowledge a
completed sign-out back on `/login`.

### Changes Required:

#### 1. Sign-out acknowledgment redirect

**File**: `src/server/auth/actions.ts`

**Intent**: Land the user on the sign-out-acknowledgment banner added in Phase 2.

**Contract**: `signOut({ redirectTo: "/login" })` → `signOut({ redirectTo:
"/login?signedOut=1" })`. No other change to this file.

#### 2. Sign-out button (pending state)

**File**: `src/components/sign-out-button.tsx` (new)

**Intent**: Same `useFormStatus` pending-state pattern as Phase 2's sign-in
button, for the confirm dialog's actual sign-out action.

**Contract**: Default export, no props. Renders the shared `Button`
(`variant="destructive"`), `disabled={pending}`, label "Sign out" /
"Signing out…" while pending.

#### 3. User menu

**File**: `src/components/user-menu.tsx` (new, `"use client"`)

**Intent**: Compose `Avatar` (GitHub `image`, with initials-from-`name`
fallback), `DropdownMenu` (trigger = avatar + name, matching the existing
`SidebarMenuButton` trigger pattern), and the `AlertDialog` confirm — per
"Critical Implementation Details," the dialog's `open` state lives in this
component, not as a nested `AlertDialogTrigger` inside the dropdown item.

**Contract**: `UserMenu({ user }: { user: { name: string | null; email:
string | null; image: string | null } })`. Dropdown trigger is a
`SidebarMenuButton asChild` wrapping `Avatar` + truncated name/email text
(mirrors the existing nav-link `asChild` pattern at
`src/components/app-shell.tsx:44-46`). One `DropdownMenuItem` ("Sign out"),
`onSelect={(e) => { e.preventDefault(); setConfirmOpen(true); }}`.
`AlertDialog` with a cancel action and an `AlertDialogAction asChild`
wrapping `<form action={signOutAction}><SignOutButton /></form>`.

#### 4. Wire the user menu into `AppShell`

**File**: `src/components/app-shell.tsx`

**Intent**: Replace the bare "Sign out" button with `UserMenu`, fed the
session user from the root layout (this component has no server-side session
access of its own).

**Contract**: `AppShell({ children, user }: { children: React.ReactNode;
user: { name: string | null; email: string | null; image: string | null } })`.
`SidebarFooter` renders `<FeedbackSheet />` then `<UserMenu user={user} />`
in place of the old sign-out form.

#### 5. Pass the session user down

**File**: `src/app/layout.tsx`

**Intent**: Thread the already-fetched `session.user` into `AppShell`.

**Contract**: `DefaultSession["user"]` declares `name`/`email`/`image` as
*optional* (`string | null | undefined`), not the `string | null` that
`AppShell`/`UserMenu`'s contracts specify (plan-review F3) — normalize at
this boundary: `<AppShell user={{ name: session.user.name ?? null, email:
session.user.email ?? null, image: session.user.image ?? null }}>{children}
</AppShell>` (only reachable when `session?.user` is truthy, per the existing
conditional at `src/app/layout.tsx:31` — no new null-check needed beyond
what's already there).

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`
- Existing `AppShell`/sidebar-dependent tests still pass: `npm test`

#### Manual Verification:

- Signed in, the sidebar footer shows the GitHub avatar and name instead of a bare "Sign out" button
- Opening the dropdown shows a "Sign out" item; selecting it opens a confirm dialog without signing out immediately
- Cancelling the dialog leaves the session intact; confirming shows a pending "Signing out…" state, then lands on `/login` with the sign-out acknowledgment banner from Phase 2
- A user with no GitHub avatar (if testable) falls back to initials, not a broken image

---

## Phase 4: E2E coverage

### Overview

Playwright coverage for everything the new UI surfaces, within what Playwright
can actually drive — GitHub's real OAuth consent screen is out of reach, so
sign-in coverage stops at the pre-redirect UI and the redirect target; the
authenticated-side UI (dropdown, confirm dialog, sign-out) uses the existing
`test-auth` bypass to reach a signed-in state directly.

### Changes Required:

#### 1. New auth UX spec

**File**: `tests/e2e/auth-ux.spec.ts` (new)

**Intent**: Cover the behaviors Phase 2/3 added, following this repo's
existing Playwright conventions (`getByRole`/`getByText` locators, no
`waitForTimeout`, independent tests).

**Contract**: Test cases —
1. Unauthenticated: `/login` renders the card, the GitHub icon, and the
   "Continue with GitHub" button.
2. Unauthenticated: `/login?error=AccessDenied` renders the mapped friendly
   message (confirms Phase 2 item 5's `pages.error` routing actually lands
   `AccessDenied` on `/login` rather than next-auth's default error page);
   `/login?error=NotARealCode` renders the generic fallback text (not the
   raw code).
3. Unauthenticated: visiting a protected route (e.g. `/dashboard`) redirects
   to `/login` with an **absolute** `callbackUrl` in the URL (matching real
   middleware behavior, not a hand-crafted relative path); clicking sign-in
   navigates toward `github.com` (assert via `page.url()` containing
   `"github.com"` after the click, without completing GitHub's consent
   screen) — this is the regression test for plan-review F1.
4. Unauthenticated: `/login?callbackUrl=https://evil.example.com` followed by
   clicking sign-in still navigates toward GitHub's authorize endpoint with
   this app's own callback (i.e. the malicious `callbackUrl` never reaches a
   trusted-redirect position) — assert the GitHub-bound URL does not contain
   `evil.example.com`.
5. Authenticated (via the existing `tests/e2e/auth.setup.ts` bypass): the
   sidebar shows the user's name; opening the menu and selecting "Sign out"
   shows the confirm dialog; cancelling keeps the session (reload still shows
   the authenticated shell); confirming signs out and lands on
   `/login?signedOut=1` with the acknowledgment banner visible.

### Success Criteria:

#### Automated Verification:

- New spec passes: `npx playwright test tests/e2e/auth-ux.spec.ts`
- Full E2E suite still passes: `npx playwright test`

#### Manual Verification:

- Review the spec's locators against the five anti-patterns this project's E2E conventions call out (no CSS/XPath selectors, no `waitForTimeout`, each test independent with its own setup/cleanup)

---

## Testing Strategy

### Unit Tests:

- `resolveSafeRedirect`: a same-origin relative path accepted unchanged; a
  **same-origin absolute URL** (the real shape next-auth's middleware sends)
  accepted and normalized to its relative path — this case is the
  plan-review F1 regression test and must not be skipped; protocol-relative
  (`//evil.com`), cross-origin absolute (`https://evil.com`), and malformed
  inputs all fall back to the provided default; `undefined`/array input
  handled.
- `resolveAuthErrorMessage`: each recognized code maps to its specific
  message; an unrecognized code and `undefined` both resolve to the expected
  fallback/`null`.

### Integration Tests:

- None beyond the existing Vitest suite — this change has no server-side
  logic beyond the two pure functions above; everything else is presentation.

### Manual Testing Steps:

1. Full fresh sign-in: visit `/dashboard` signed out → redirected to
   `/login?callbackUrl=/dashboard` → click sign-in → complete real GitHub
   OAuth → land back on `/dashboard`.
2. Deep-link sign-in: visit `/simulation` signed out → sign in → land on
   `/simulation`, not `/dashboard`.
3. Failed sign-in: temporarily misconfigure `AUTH_GITHUB_SECRET` (or revoke
   the OAuth app) and confirm the error banner renders instead of a blank
   page.
4. Sign-out round-trip: sign in, open the user menu, cancel the confirm
   dialog once, then confirm it; verify the `/login?signedOut=1`
   acknowledgment.

## Performance Considerations

None — this is a presentation-only change; no new queries, no new data
fetched (session already carries `image`/`name`).

## Migration Notes

None — no schema or data changes.

## References

- Related research: findings summarized inline above (no `research.md` was
  produced as a separate artifact for this change; an Explore subagent's
  report during the conversation covered the current-state facts cited
  throughout this plan).
- Similar `asChild` dropdown-trigger pattern: `src/components/app-shell.tsx:44-46`
- Similar slide-over/overlay pattern (`FeedbackSheet`): `src/components/feedback-sheet.tsx`
- Existing E2E auth bypass: `tests/e2e/auth.setup.ts`, `src/app/api/test-auth/login/route.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Shared primitives & new dependencies

#### Automated

- [x] 1.1 Typecheck passes: `npm run typecheck` — b01bec4
- [x] 1.2 Lint passes: `npm run check` — b01bec4
- [x] 1.3 New files exist (dropdown-menu, avatar, alert-dialog, github-icon, auth-banner) — b01bec4

#### Manual

- [x] 1.4 `npm run dev` boots with no console errors — b01bec4

### Phase 2: Redesign `/login`

#### Automated

- [x] 2.1 Typecheck passes: `npm run typecheck` — 8f8b238
- [x] 2.2 Lint passes: `npm run check` — 8f8b238
- [x] 2.3 Unit tests pass: `npx vitest run src/app/login/safe-redirect.test.ts src/app/login/auth-error-messages.test.ts` — 8f8b238
- [x] 2.4 Full suite still passes: `npm test` — 8f8b238

#### Manual

- [x] 2.5 `/login` shows the new centered card with the GitHub icon — 8f8b238
- [x] 2.6 Sign-in button shows a disabled/"Redirecting…" pending state — 8f8b238
- [x] 2.7 `/login?error=AccessDenied` shows the mapped message; unknown code shows the generic fallback — 8f8b238
- [x] 2.8 Deep-link sign-in returns to the originally requested URL, not always `/dashboard` — 8f8b238
- [x] 2.9 A malicious `callbackUrl` falls back to `/dashboard`, never redirects externally — 8f8b238

### Phase 3: Post-login identity & sign-out

#### Automated

- [x] 3.1 Typecheck passes: `npm run typecheck` — 9e2a115
- [x] 3.2 Lint passes: `npm run check` — 9e2a115
- [x] 3.3 Full suite still passes: `npm test` — 9e2a115

#### Manual

- [x] 3.4 Sidebar footer shows avatar + name instead of a bare "Sign out" button — 9e2a115
- [x] 3.5 "Sign out" opens a confirm dialog instead of signing out immediately — 9e2a115
- [x] 3.6 Cancel keeps the session; confirm shows a pending state then lands on `/login?signedOut=1` with the acknowledgment banner — 9e2a115
- [x] 3.7 Missing-avatar case falls back to initials, not a broken image — 9e2a115

### Phase 4: E2E coverage

#### Automated

- [x] 4.1 New spec passes: `npx playwright test tests/e2e/auth-ux.spec.ts` — 7380817
- [x] 4.2 Full E2E suite still passes: `npx playwright test` (7/8 — the 1 failure, `authenticated-simulation-run.spec.ts`, is a pre-existing, unrelated strict-mode locator bug confirmed present on the pre-change baseline commit 6feed91 via a throwaway worktree; out of this change's scope) — 7380817

#### Manual

- [x] 4.3 Spec locators reviewed against this project's E2E anti-pattern checklist — 7380817
