<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Migrate production from swarmarena.hopto.org to swarmarena.fun

- **Plan**: context/changes/domain-migration-swarmarena-fun/plan.md
- **Mode**: Deep
- **Date**: 2026-11-19
- **Verdict**: REVISE (triaged — both findings FIXED → SOUND)
- **Findings**: 1 critical, 0 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | FAIL |
| Plan Completeness | WARNING |

## Grounding
8/8 paths ✓ (Caddyfile, docker-compose.yml, deploy.sh, infrastructure.md, deploy-plan.md, roadmap.md, src/server/auth/config.ts, src/env.js), 2/2 symbols ✓ (AUTH_TRUST_HOST, authConfig), brief↔plan ✓

## Findings

### F1 — Caddyfile change won't take effect without an explicit reload

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — Cutover
- **Detail**: Traced `deploy.sh` end-to-end: it runs `git pull`, builds/migrates, then `docker compose up -d` — nothing else touches the `caddy` service. `Caddyfile` is bind-mounted (`docker-compose.yml`), and Compose only recreates a container when the service definition changes (image, command, env, volume list) — it cannot detect that a bind-mounted file's content changed on the host. The `caddy:2-alpine` image's default command has no `--watch` flag either. Net effect: after this plan's Caddyfile edit merges and deploys, the running Caddy process keeps its old, already-loaded config — `swarmarena.fun` would still fail with no cert, and the old domain's block would still be live too. Phase 1's own manual verification would correctly catch this, but the plan gives the implementer no instruction on what to do about it.
- **Fix A ⭐ Recommended**: Add a reload step to `deploy.sh` permanently
  - Strength: Append `docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile` to the end of `deploy.sh`. Fixes the gap durably for every future Caddyfile edit, not just this one — matches this project's own established pattern of fixing `deploy.sh` for structural CI/CD gaps (see `deploy-plan.md`'s documented history of the missing-migration-step fix). `caddy reload` is a zero-downtime graceful reload via the admin API (enabled by default here) — no dropped connections.
  - Tradeoff: Modifies the deploy script itself — a slightly wider blast radius than a one-off command, though the change is a single safe, idempotent append.
  - Confidence: HIGH — `caddy reload` is Caddy's own documented mechanism for exactly this situation.
  - Blind spot: None significant — standard, documented Caddy behavior.
- **Fix B**: One-off manual reload, scoped to just this migration
  - Strength: Smaller, doesn't touch `deploy.sh`.
  - Tradeoff: The identical silent-no-effect gap bites the next person who edits Caddyfile for any reason.
  - Confidence: HIGH that it unblocks this one deploy.
  - Blind spot: Doesn't fix the systemic issue — only defers it.
- **Decision**: FIXED via Fix A, then corrected during implementation — `caddy reload` (Fix A's literal mechanism) turned out to be insufficient. Confirmed live via SSH that it exits 0 and logs no error while silently not applying the new config, because the long-running caddy container's single-file bind mount follows the old inode `git pull` replaced — `caddy reload` re-reads through that same stale handle. The real fix (also landed in Phase 1, see plan.md's "Implementation note") is `docker compose up -d --force-recreate caddy`, which re-establishes the bind mount every deploy. Fix A's underlying diagnosis (deploy.sh needs an explicit step, not a one-off manual command) was correct; its specific mechanism was not.

### F2 — OAuth App ordering within Phase 1 is correct but implicit

- **Severity**: OBSERVATION
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — Changes Required, items 1–2
- **Detail**: The plan lists the OAuth App URL update ("pre-deploy") before the Caddyfile change — correct, since reversing it would break login on both domains until the OAuth App is updated. The ordering is already right; it's just implicit in the item numbering rather than stated as a rule.
- **Fix**: Add one sentence making the ordering explicit: "Complete the OAuth App update before deploying the Caddyfile change — doing it in the other order breaks login on both domains until the OAuth App is updated."
- **Decision**: FIXED
