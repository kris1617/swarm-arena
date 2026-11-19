# Migrate production from swarmarena.hopto.org to swarmarena.fun Implementation Plan

## Overview

Move production traffic from the dynamic-DNS domain `swarmarena.hopto.org` to the newly-purchased, owned domain `swarmarena.fun`. This is a Caddy reverse-proxy config change plus a GitHub OAuth App URL update — no application code changes. The old domain is retired (its Caddy block removed) once the new one is confirmed working.

## Current State Analysis

- `Caddyfile` (repo root) has a single site block: `swarmarena.hopto.org { reverse_proxy app:3000 }`. Caddy auto-provisions and renews its Let's Encrypt cert for this block.
- DNS for `swarmarena.fun` is already correctly configured: its A record resolves to `217.154.238.241`, matching the VPS. No `www.swarmarena.fun` A record exists yet. HTTPS does not yet work for `swarmarena.fun` — Caddy's global auto-HTTPS redirects any unmatched Host header's port-80 traffic to port 443, but with no matching site block there's no TLS cert, so the HTTPS handshake fails (confirmed via `curl`/`openssl` — status 000, no cert found).
- No application code references the domain. `AUTH_TRUST_HOST=true` (`src/server/auth/config.ts`, `src/env.js`) makes NextAuth host-agnostic — it trusts whatever Host header Caddy forwards, regardless of domain. The CSP and other security headers (`src/lib/security-headers.js`) use `'self'`, not a literal domain. Confirmed via repo-wide grep: zero application-code hits for `hopto.org`.
- The GitHub OAuth App used for sign-in has exactly one callback URL configured, currently `https://swarmarena.hopto.org/api/auth/callback/github` (per `context/deployment/deploy-plan.md`'s own note that "OAuth Apps only support one callback URL each"). This is the one config surface genuinely coupled to the domain.
- `context/foundation/infrastructure.md` and `context/deployment/deploy-plan.md` both state `swarmarena.hopto.org` as the current production domain, including a risk-register entry in `infrastructure.md` specifically flagging the dynamic-DNS domain as a risk (VPS IP changes silently breaking resolution).
- `swarmarena.hopto.org` is currently flagged by Google Safe Browsing ("Deceptive pages" — see `context/foundation/roadmap.md`'s Maintenance log and this session's own investigation) with Search Console reporting no specific sample URLs, consistent with a shared-reputation issue on the `hopto.org` dynamic-DNS domain rather than content on this site. That investigation is tracked separately (a manual Search Console "Request a Review" action) — not a task of this plan, but this migration incidentally resolves it going forward since `swarmarena.fun` is an owned domain with no shared-reputation history.
- No README/`package.json`/GitHub repo metadata (`homepageUrl`, `description`) references the domain — confirmed via direct check. No doc cleanup needed there.

## Desired End State

`swarmarena.fun` serves the production app over valid HTTPS, with `www.swarmarena.fun` redirecting to it. GitHub OAuth login works against the new domain. `swarmarena.hopto.org`'s Caddy block is removed — the old domain no longer serves the app (DNS for it is untouched; it simply stops resolving to a working site via Caddy). `infrastructure.md`, `deploy-plan.md`, and the roadmap's Maintenance log reflect the new domain as current fact.

### Key Discoveries:

- `AUTH_TRUST_HOST=true` means the domain swap requires **zero** NextAuth/env config changes beyond the OAuth App's own callback URL (`src/server/auth/config.ts:66`, `src/env.js:19`).
- Caddy's automatic HTTPS already redirects unmatched-host HTTP traffic to HTTPS globally, confirmed by `swarmarena.fun`'s existing `308` redirect on port 80 despite having no site block yet — adding the site block is the only remaining step for TLS to start working.
- The GitHub OAuth App's single-callback-URL constraint (`context/deployment/deploy-plan.md`) is the one piece of the migration that cannot have a transition window — updating it is a point-in-time switch, confirmed by the user's own choice to update in place rather than run a second app.

## What We're NOT Doing

- Not changing any application code — no file under `src/` is touched by this plan.
- Not staging a parallel test window on the new domain before cutover — the OAuth App update is in-place and point-in-time by design (user's explicit choice), so there is no way to fully verify the new domain's auth flow before the old domain's login breaks. The cutover is a single deploy.
- Not keeping a redirect from `swarmarena.hopto.org` to `swarmarena.fun` — the old domain's Caddy block is removed outright (user's explicit choice), not converted to a redirect.
- Not adding a formal automated rollback mechanism — if the cutover has a problem, the plan's own manual-verification phase catches it and the fix is applied forward (user's explicit choice), not via automatic revert.
- Not submitting Google Safe Browsing's "Request a Review" for the old domain as part of this plan — that remains a separate, manual Search Console action for the user. This plan only notes the side-benefit.
- Not touching the VPS's `/opt/swarm-arena/.env` file's `AUTH_GITHUB_ID`/`AUTH_GITHUB_SECRET` values — since the OAuth App is updated in place (same Client ID/Secret), these env values are unchanged.
- Not adding a new Search Console property verification file or doing the verification walkthrough — the plan notes that a new property is needed, but the actual Google-side verification is a manual user action outside this repo.

## Implementation Approach

A single-deploy cutover: extend `Caddyfile` with the new domain's site block (plus a `www` redirect block) and remove the old domain's block in the same change, so one deploy fully switches production. The GitHub OAuth App's URLs are updated directly beforehand (a web-console action, not a code change, but sequenced and tracked as part of Phase 1 since it's point-in-time-coupled to the same cutover). Canonical docs are updated in a separate phase afterward, once the cutover is confirmed working, so the docs describe reality rather than an assumed outcome.

## Phase 1: Cutover — Caddy + GitHub OAuth App

### Overview

Switch Caddy's routing and the GitHub OAuth App's URLs from the old domain to the new one, in a single deploy. This is the point-in-time switch the user explicitly chose (no transition window).

### Changes Required:

**Ordering note**: Complete item 1 (OAuth App) before deploying item 2 (Caddyfile) — doing it in the other order breaks login on both domains until the OAuth App is updated, which is strictly worse than the brief old-domain-login gap this ordering accepts.

#### 1. GitHub OAuth App (manual, pre-deploy)

**Intent**: Point the existing OAuth App's Homepage URL and Authorization callback URL at the new domain, in place — the same Client ID/Secret continue to work, so no VPS env change is needed.

**Contract**: In the GitHub OAuth App's settings (the app whose Client ID matches this deployment's `AUTH_GITHUB_ID`), set Homepage URL to `https://swarmarena.fun` and Authorization callback URL to `https://swarmarena.fun/api/auth/callback/github`. This is a manual, point-in-time action — login on `swarmarena.hopto.org` stops working the moment it's saved, which is expected given the user's explicit choice not to stage a transition window.

#### 2. `Caddyfile`

**File**: `Caddyfile`

**Intent**: Replace the old domain's site block with one for `swarmarena.fun`, add a `www.swarmarena.fun` redirect to the bare domain, and remove `swarmarena.hopto.org`'s block entirely so Caddy stops provisioning/renewing a cert for it and stops proxying it to the app.

**Contract**: The file's single `swarmarena.hopto.org { reverse_proxy app:3000 }` block is replaced by two blocks: `swarmarena.fun { reverse_proxy app:3000 }` and `www.swarmarena.fun { redir https://swarmarena.fun{uri} permanent }`. Caddy's automatic HTTPS handles cert provisioning for both from the existing DNS (already confirmed resolving to this VPS).

#### 3. `deploy.sh`

**File**: `deploy.sh`

**Intent**: `docker compose up -d` never recreates the `caddy` container just because the bind-mounted `Caddyfile`'s content changed on the host — Compose only reacts to service-definition changes (image/command/env/volumes), and the `caddy:2-alpine` image's default command has no `--watch` flag. Without an explicit reload, this plan's Caddyfile edit would silently not take effect after deploy. Fixing it in `deploy.sh` itself (not a one-off manual command) makes every future Caddyfile edit — not just this one — take effect automatically, matching this project's own precedent of fixing `deploy.sh` for structural CI/CD gaps (see `deploy-plan.md`'s documented history of the missing-migration-step fix).

**Contract**: Append one line to the end of `deploy.sh`, after the existing `docker compose up -d`: `docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile`. This is Caddy's own documented zero-downtime graceful-reload mechanism (via its admin API, enabled by default here) — no dropped connections, no listen-socket gap.

### Success Criteria:

#### Automated Verification:

- `Caddyfile` is valid Caddy syntax: `docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile` (run against the deployed container, not locally — this repo has no local Caddy binary)
- `deploy.sh`'s new reload line runs without error as part of the normal deploy (confirmed via the GitHub Actions deploy log for this push)

#### Manual Verification:

- `curl -I https://swarmarena.fun/` returns `200` with a valid Let's Encrypt cert (not a self-signed/absent-cert error)
- `curl -I https://www.swarmarena.fun/` returns a redirect to `https://swarmarena.fun/`
- `curl -I https://swarmarena.hopto.org/` no longer returns a response from this app (connection refused, or no matching Caddy site — confirms the old block is gone)
- GitHub OAuth login completes successfully on `https://swarmarena.fun/login` (full round trip: redirect to GitHub, authorize, redirect back, authenticated session)

---

## Phase 2: Update canonical docs

### Overview

Update the two "source of truth" infra docs and the roadmap's Maintenance log to describe `swarmarena.fun` as the current domain, now that Phase 1 is confirmed working. Archived change folders are left untouched (read-only by convention).

### Changes Required:

#### 1. `context/foundation/infrastructure.md`

**Intent**: Replace the Domain/TLS line's domain and risk-register entry to reflect the new, owned domain — the dynamic-DNS risk this file flagged no longer applies.

**Contract**: Update the `- **Domain/TLS**:` bullet (currently referencing `swarmarena.hopto.org`) to name `swarmarena.fun` and the migration date. Update or remove the risk-register row about `hopto.org` being dynamic DNS, since `swarmarena.fun` is an owned domain, not DDNS.

#### 2. `context/deployment/deploy-plan.md`

**Intent**: Update every factual reference to the production domain so the doc matches the deployed reality.

**Contract**: Update the "Reverse proxy" bullet, the verification-command example (`https://swarmarena.hopto.org` → `https://swarmarena.fun`), and the "domain is dynamic DNS" sentence in the known-gaps/limitations section to reflect the new, owned domain.

#### 3. `context/foundation/roadmap.md`

**Intent**: Add this migration to the Maintenance log (alongside `security-hardening-pass`), noting it as the action that resolves the previously-logged Safe-Browsing/DDNS-reputation concern.

**Contract**: Append a new bullet under `## Maintenance log` for `domain-migration-swarmarena-fun`, in the same format as the existing `security-hardening-pass` entry, noting the Safe Browsing side-benefit per this plan's own scope decision (noted, not actioned).

### Success Criteria:

#### Automated Verification:

- `grep -rn "hopto.org" context/foundation/infrastructure.md context/deployment/deploy-plan.md` returns no matches (or only an explicitly-historical note, if one is intentionally kept)

#### Manual Verification:

- Both docs read correctly end-to-end (no leftover sentence that still assumes the old domain)

---

## Phase 3: Manual verification & close-out

### Overview

Confirm the migration is fully done: the new domain serves the app correctly end-to-end, and the old domain is fully retired.

### Changes Required:

None — this phase is verification-only, no file changes.

### Success Criteria:

#### Manual Verification:

- `https://swarmarena.fun/login` loads, GitHub OAuth login succeeds, and the authenticated session lands on the dashboard (re-confirms Phase 1's login check post-docs-update, in case anything regressed)
- One core flow works end-to-end on the new domain: start a simulation (client-staged) and confirm it ticks and renders live
- `https://swarmarena.hopto.org/` confirmed not serving the app (per Phase 1's check, re-verified once more after any propagation delay)
- A new Google Search Console property for `swarmarena.fun` has been created and verified (manual user action; this plan does not perform the verification walkthrough itself, only confirms the user has done it)

---

## Testing Strategy

### Manual Testing Steps:

1. After Phase 1's deploy, run the `curl`/OAuth-login checks listed in Phase 1's Manual Verification.
2. After Phase 2's doc updates, re-read both docs for consistency.
3. After Phase 3, do a final full pass: login, one core simulation flow, and confirm the old domain is dark.

## References

- `Caddyfile`, `docker-compose.yml`, `.github/workflows/deploy.yml` — current deploy config
- `context/foundation/infrastructure.md`, `context/deployment/deploy-plan.md` — canonical docs being updated
- `context/foundation/roadmap.md` — Maintenance log (`security-hardening-pass` entry is the format precedent)
- `src/server/auth/config.ts`, `src/env.js` — confirms `AUTH_TRUST_HOST` host-agnostic behavior, no code changes needed

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Cutover — Caddy + GitHub OAuth App

#### Automated

- [ ] 1.1 Caddyfile syntax validates: `docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile`
- [ ] 1.2 deploy.sh's new caddy reload line runs without error in the deploy log

#### Manual

- [ ] 1.3 `https://swarmarena.fun/` returns 200 with a valid Let's Encrypt cert
- [ ] 1.4 `https://www.swarmarena.fun/` redirects to `https://swarmarena.fun/`
- [ ] 1.5 `https://swarmarena.hopto.org/` no longer serves the app
- [ ] 1.6 GitHub OAuth login completes successfully on `https://swarmarena.fun/login`

### Phase 2: Update canonical docs

#### Automated

- [ ] 2.1 No remaining `hopto.org` references in infrastructure.md/deploy-plan.md: `grep -rn "hopto.org" context/foundation/infrastructure.md context/deployment/deploy-plan.md`

#### Manual

- [ ] 2.2 Both docs read correctly end-to-end with no leftover old-domain assumption

### Phase 3: Manual verification & close-out

#### Manual

- [ ] 3.1 Login + dashboard works on swarmarena.fun (re-confirmed post-docs-update)
- [ ] 3.2 One core simulation flow (start + live render) works end-to-end on the new domain
- [ ] 3.3 swarmarena.hopto.org confirmed not serving the app
- [ ] 3.4 New Google Search Console property for swarmarena.fun created and verified
