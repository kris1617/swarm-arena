# Migrate production from swarmarena.hopto.org to swarmarena.fun — Plan Brief

> Full plan: `context/changes/domain-migration-swarmarena-fun/plan.md`

## What & Why

Move production traffic from `swarmarena.hopto.org` (a free dynamic-DNS hostname, currently flagged by Google Safe Browsing) to the newly-purchased, owned domain `swarmarena.fun`. This is a Caddy config + GitHub OAuth App URL swap — no application code changes.

## Starting Point

`Caddyfile` has one site block for `swarmarena.hopto.org`; the app itself is fully domain-agnostic (`AUTH_TRUST_HOST=true`, CSP uses `'self'`). DNS for `swarmarena.fun` already correctly resolves to the VPS, but Caddy has no site block/cert for it yet, so HTTPS doesn't work there yet.

## Desired End State

`swarmarena.fun` serves the app over valid HTTPS with a working `www` redirect and GitHub OAuth login. `swarmarena.hopto.org` no longer serves anything. Canonical docs (`infrastructure.md`, `deploy-plan.md`, roadmap) describe the new domain as current fact.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| OAuth App transition | Update existing app in place | Simpler, one app to manage — accepted that login on the old domain breaks the instant it's saved |
| Old domain's fate | Remove Caddy block entirely (no redirect) | Simplest end state; no lingering tie to the flagged domain |
| www subdomain | Add `www.swarmarena.fun` → bare domain redirect | Covers the common user habit of typing `www` |
| Cutover approach | All at once, single deploy | Matches the in-place OAuth App choice — no transition window is possible anyway |
| Safe Browsing review | Noted as a side-benefit, not actioned | Stays a separate manual Search Console action; this plan is an infra migration, not a remediation |
| Doc cleanup scope | Canonical docs only (`infrastructure.md`, `deploy-plan.md`, roadmap) | Archived change folders are read-only by convention; README/repo metadata confirmed to have zero domain references |
| Rollback | Fix forward, no formal rollback | Low-traffic personal project; diagnosing live is acceptable over flip-flopping DNS/OAuth config |
| Verification depth | Login + homepage + one core simulation flow | Confirms auth and the core product didn't silently break, not just that pages load |

## Scope

**In scope:** `Caddyfile` (new domain + www redirect + old block removed), `deploy.sh` (explicit `caddy reload` step — a plan-review finding: Compose never recreates the caddy container for a bind-mount content change alone), GitHub OAuth App URL update, `infrastructure.md`/`deploy-plan.md`/roadmap doc updates, manual verification.

**Out of scope:** Any application code change, a staged test window before cutover, a redirect from the old domain, an automated rollback mechanism, the actual Safe Browsing "Request a Review" submission, a second OAuth App.

## Architecture / Approach

Single-deploy cutover: `Caddyfile` gains `swarmarena.fun`'s site block and a `www` redirect block, and loses `swarmarena.hopto.org`'s block, all in one change. The GitHub OAuth App's Homepage/callback URLs are updated in the GitHub web console as a point-in-time action sequenced alongside the same deploy. Docs are updated only after the cutover is confirmed working.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Cutover | Caddy + OAuth App switched to the new domain in one deploy | Point-in-time OAuth App switch has no test window — any misconfiguration is discovered live |
| 2. Docs update | `infrastructure.md`, `deploy-plan.md`, roadmap reflect the new domain | Low risk — doc-only, no functional impact |
| 3. Manual verification & close-out | Confirms login + core flow work, old domain is dark, new Search Console property verified | Relies on the user completing the Search Console verification themselves (outside this repo) |

**Prerequisites:** DNS for `swarmarena.fun` already confirmed pointing at the VPS (done, prior to this plan). GitHub account access to edit the OAuth App's settings.
**Estimated effort:** Single session, ~3 small phases — config/doc changes only, no code.

## Open Risks & Assumptions

- The OAuth App update is irreversible in the sense that there's no "test both domains" window — if the new callback URL is wrong, login breaks on both domains until fixed.
- `swarmarena.fun`'s TLS cert provisioning depends on Caddy's ACME challenge succeeding on first attempt; if it doesn't, Phase 1's manual verification catches it and the fix is applied forward (no automated retry/rollback by design).

## Success Criteria (Summary)

- `swarmarena.fun` serves the app over valid HTTPS; `www.swarmarena.fun` redirects correctly.
- GitHub OAuth login and one core simulation flow both work end-to-end on the new domain.
- `swarmarena.hopto.org` no longer serves the app; canonical docs describe the new domain as current.
