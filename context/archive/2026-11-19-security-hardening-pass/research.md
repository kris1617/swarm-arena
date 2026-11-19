---
topic: "General security/hardening audit of swarm-arena"
researcher: claude-sonnet-5
change_id: security-hardening-pass
date: 2026-11-19
---

# Research: Security/hardening audit

## Question

Following this session's two fixed incidents (an unauthenticated public
write endpoint, a stale-DB-state crash) and the still-unresolved Chrome
Safe Browsing flag, what concrete security/hardening gaps exist in
swarm-arena right now, and how should they be prioritized?

## Answer

**No CRITICAL or HIGH-severity finding exists anywhere in the current
codebase.** Four parallel audits covered authN/authZ, input validation
and injection, infrastructure/transport hardening, and session/cookie
security. Every tRPC procedure, every resource-scoped operation, every
input schema, and every secret/env var checked out clean. The two
genuinely actionable findings are both **MEDIUM**, both purely
*defense-in-depth* (closing gaps that reduce blast radius, not open
holes): the complete absence of security HTTP headers, and the absence
of application-level rate limiting on `simulation.start`/`startServer`.
Everything else is LOW/INFO — worth knowing, not worth a change.

## Detailed findings

### MEDIUM — No security HTTP headers anywhere (headers audit)

Confirmed via grep across `next.config.js`, `Caddyfile`, and
`src/middleware.ts`: zero occurrences of CSP, `X-Frame-Options`,
`X-Content-Type-Options`, `Strict-Transport-Security`, or
`Referrer-Policy` in any of the three places that could set them.
Caddy's implicit-HTTPS management does not itself add HSTS unless
explicitly configured. This is also the root cause of a second,
independently-raised finding: `/login` (the GitHub OAuth entry point)
has no clickjacking protection — a realistic phishing vector for an
OAuth login page specifically, confirmed as the same underlying gap by
a second, independent audit pass that checked `/login` specifically.

**Fix shape (not yet planned)**: add a `headers()` function to
`next.config.js` (or a `header` directive in `Caddyfile`) setting at
minimum `X-Frame-Options: DENY` (or a CSP `frame-ancestors 'none'`),
`X-Content-Type-Options: nosniff`, `Referrer-Policy:
strict-origin-when-cross-origin`, and `Strict-Transport-Security` with
a reasonable max-age. A full CSP is a larger, separate design decision
(React/Next's inline-script needs careful `script-src` tuning) — the
other four headers are low-risk, high-value, and could ship
independently first.

### MEDIUM — No rate limiting on `simulation.start`/`startServer` (infra audit)

`src/server/api/routers/simulation.ts:525` (`start`) and `:538`
(`startServer`) have no request-frequency throttle — only
`MAX_PARALLEL_RUNS` (a *concurrency* cap, not a *rate* cap). A
signed-in user can call either repeatedly; `startServer` triggers real
server-side simulation compute per call, and even a rejected (over
the concurrency cap) call still costs a DB insert + rollback. By
contrast, `feedback.create` already has a DB-enforced 5/hour/user rate
limit (`feedback.ts:18-52`) — this project has the pattern, it just
wasn't applied here.

**Fix shape (not yet planned)**: a per-user rate limit on
`start`/`startServer`, likely following `feedback.ts`'s own
DB-counted-window pattern rather than introducing a new rate-limit
library, for consistency with this codebase's existing convention.

### MEDIUM — Defense-in-depth gap in the test-auth bypass route's cookie (session audit)

`src/app/api/test-auth/login/route.ts:96` hardcodes `secure: false` on
the session cookie it sets, regardless of environment. The route's
*real* control is the 404-when-unset gate on `E2E_TEST_AUTH_SECRET`
(confirmed unset in production) — this finding only matters if that
primary gate were ever misconfigured, in which case the cookie this
route issues would also be weaker than NextAuth's own default. Low
practical risk (a secondary gap behind an already-critical
misconfiguration), but cheap to close.

### LOW/INFO — npm audit: 4–8 moderate advisories, zero reaching production (infra audit)

`npm audit --omit=dev`: 4 moderate (a `minimatch` ReDoS advisory via
`shadcn`'s own `ts-morph` dependency — a codegen CLI tool, not
runtime-loaded). `npm audit` (full): 8 moderate, adding an `esbuild`
dev-server-request advisory via `drizzle-kit` (the migration CLI, dev
tool only). Confirmed the production Docker image only copies
`.next/standalone` + `public`, not dev-dependency `node_modules` — so
neither advisory reaches the deployed app. No CRITICAL/HIGH advisory
anywhere.

### LOW/INFO — Other items checked and found acceptable-as-is

- **IDOR/ownership checks**: all 20 `simulation.ts` procedures that
  take a resource id perform an explicit `run.userId !==
  ctx.session.user.id` check before mutating or returning data; `user.ts`
  and `feedback.ts` procedures are either self-scoped or admin-gated.
  No IDOR surface found anywhere.
- **Public write surfaces**: zero `publicProcedure` usages exist in any
  router (grep-confirmed single definition site, never imported by a
  router file) — the `root-page-scaffold-redirect` fix earlier this
  session removed the only one that ever existed.
- **Input validation / injection**: every procedure taking client input
  has a zod schema; no raw/unparameterized SQL; zero
  `dangerouslySetInnerHTML` anywhere; no prototype-pollution-prone
  pattern found.
- **Elevation logic** (`isEffectivelyAdmin`): correctly treats a lapsed
  time-boxed grant as non-admin even though the DB `role` column isn't
  auto-reverted — verified against all 4 branches, test-covered.
- **Sign-out**: properly invalidates the server-side session row via
  Auth.js's own database-session `signOut`, not just a client-side
  cookie clear.
- **`safe-redirect.ts`**: this session's earlier open-redirect fix
  (origin check + `//`-prefix rejection) is confirmed still intact,
  wired into `login/page.tsx`, no regression.
- **Deploy pipeline secrets** (`.github/workflows/deploy.yml`): real
  secrets only ever referenced via `${{ secrets.* }}`, never
  echoed/logged; the `test` job's env vars are literal CI-only
  placeholders, not real values.
- **Docker/compose**: non-root container user, only port 3000 exposed,
  app bound to `127.0.0.1` (only Caddy faces the public internet), no
  secret baked into an image layer.
- **Biome**: `recommended` preset active, no security-category rule
  disabled, `noDangerouslySetInnerHtml` enabled by default and moot
  anyway (zero usages exist).
- **One operational footgun, not a vulnerability**: an `ADMIN_EMAILS`
  permanent-admin account, once manually reverted via `revertAccount`,
  is not automatically re-granted on next login (the email-match
  assignment only fires once, on first row creation). Recoverable via
  self-elevation or `elevateAccount` — not a security hole, just a
  surprise if someone expects auto-re-grant.
- **SSH deploy step TOFU**: `ssh -o StrictHostKeyChecking=accept-new`
  accepts the VPS host key on first connection without pinning — minor,
  since the target is a static, long-lived IP.
- **Unverifiable from the repo alone**: whether the deploy SSH key is
  scoped (forced-command/restricted) on the VPS side, and whether
  Caddy/the deploy terminates TLS in a way Auth.js sees as `https` (so
  its `secure` cookie flag actually activates) — both live in
  server-side configuration, not this repository.

## Code References

- `src/server/api/trpc.ts` — `publicProcedure`/`protectedProcedure`/`adminProcedure` definitions
- `src/server/api/routers/simulation.ts:525,538` — unthrottled `start`/`startServer`
- `src/server/api/routers/feedback.ts:18-52` — the existing rate-limit pattern to reuse
- `src/app/api/test-auth/login/route.ts:96` — hardcoded `secure: false`
- `next.config.js`, `Caddyfile`, `src/middleware.ts` — confirmed absence of security headers
- `src/server/auth/elevation.ts` — `isEffectivelyAdmin`, confirmed correct
- `src/app/login/safe-redirect.ts` — confirmed fix intact
- `.github/workflows/deploy.yml:55-58` — secret handling, SSH TOFU
- `Dockerfile:30-38`, `docker-compose.yml:8-37` — container hardening, confirmed clean

## Architecture Insights

This codebase already has an established pattern for exactly the kind
of fix the two MEDIUM findings need: `feedback.ts`'s DB-counted
per-user rate limit is a ready-made template for
`simulation.start`/`startServer`'s missing throttle, and
`root-page-scaffold-redirect`'s removal of the last `publicProcedure`
this session already closed the one real hole that existed. The
remaining gaps are additive (headers, a rate-limit table) rather than
corrective.

## Open Questions

- Should the security-header fix start with the 4 low-risk headers
  (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, HSTS) as
  one phase, with a full CSP deferred as its own separately-scoped
  follow-up (given CSP's script-src tuning is a genuinely bigger
  design decision for a Next.js/React app)?
- Does the Chrome Safe Browsing flag correlate with any of these
  findings? Missing security headers and an unthrottled compute-heavy
  endpoint are not typically what Safe Browsing's "Social Engineering"
  category flags (that's usually deceptive content/credential
  phishing, not these hardening gaps) — this audit found nothing that
  obviously explains the Safe Browsing warning. The Google Search
  Console Security Issues report (not yet checked by the user, per
  the standing outstanding item) remains the only authoritative source
  for that specific question.
