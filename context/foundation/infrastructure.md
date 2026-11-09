---
project: swarm-arena
researched_at: 2026-11-09
recommended_platform: self-hosted-vps
runner_up: null
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Next.js 16 (App Router, T3 Stack)
  runtime: Node.js (Docker container, persistent)
---

## Recommendation

**Deploy on a self-hosted VPS (Ubuntu 26.04, Docker, Caddy reverse proxy), not any of the researched PaaS platforms.**

The researched platform shortlist (Railway recommended, Render runner-up, Fly.io third — see `context/foundation/archive/2026-11-09-infrastructure.md`) was superseded by a direct decision: the developer already owns a VPS, so the managed-platform cost/convenience tradeoff that drove the PaaS research no longer applies. This is a conscious override, not a gap in the research — the lesson's own guidance is explicit that the final content of this file is the developer's call, not the skill's. The persistent-container requirement that ruled out serverless platforms (Vercel, Netlify) in the original research still holds unchanged: the simulation's always-on loop needs a long-lived process, which this VPS provides directly.

## Stack Fit

- **Runtime**: Next.js 16 custom-built via a multi-stage Dockerfile using `output: "standalone"` — confirmed working after one fix (a placeholder `DATABASE_URL` is needed at build time because Next.js's page-data collection eagerly imports the Drizzle/libsql client, which throws `URL_INVALID` on an unset URL even though no real query runs during build).
- **Database**: Drizzle over SQLite via libsql, same as local dev, now persisted to a **bind-mounted host directory** (`/opt/swarm-arena/data`) rather than a Docker named volume — chosen for direct host-level inspectability/backup. Confirmed the container's `nextjs` user (uid 1001) needs the host directory `chown`'d to match, or SQLite fails to open with error 14 (`SQLITE_CANTOPEN`).
- **WebSocket/persistent-connection readiness**: not yet exercised — the app currently deployed is the T3 bootstrap as-is (no custom WebSocket server exists in code yet). The Docker/Caddy setup does not block long-lived connections (Caddy proxies WebSocket upgrades transparently), but this hasn't been load-tested with the actual simulation feature yet.

## CLI / Operability

- **Deploy mechanism**: GitHub Actions workflow (`.github/workflows/deploy.yml`) triggers on push to `master`, SSHes to the VPS with a **dedicated, restricted deploy key** (forced command `command="/opt/swarm-arena/deploy.sh"`, no shell, no port/agent forwarding), which runs `git pull --ff-only && docker compose build app && docker compose up -d`. This is the closest equivalent to a PaaS's native git-push-to-deploy, confirmed working end-to-end (tested via `gh run rerun`).
- **Repo access on the VPS**: a second, separate **read-only GitHub deploy key** (registered via `gh repo deploy-key add`, no `-w` flag) is used for `git pull` on the VPS — distinct from the GitHub-Actions-side deploy-trigger key, so a compromise of either key alone can't both read the private repo *and* trigger arbitrary deploys with write-level access.
- **No MCP server** — this is a bare VPS, not a platform product, so there's no equivalent to Railway's/Fly's hosted MCP server. All operability is via direct SSH + `docker compose`/`git` CLI commands.
- **Logs**: `ssh szef@217.154.238.241 "cd /opt/swarm-arena && docker compose logs app"` (add `-f` to follow, `--tail N` to limit).

## Operational Story

- **Preview deploys**: none configured. There is no per-PR preview environment on this setup — every push to `master` deploys straight to the one production instance. If preview environments matter later, the straightforward path is a second `docker-compose.staging.yml` + a second Caddy site block, not a platform feature.
- **Secrets**: the GitHub Actions deploy-trigger private key lives only in the repo's `DEPLOY_SSH_KEY` Actions secret; the VPS's own read-only GitHub deploy key lives only in `~/.ssh/github_deploy_key` on the VPS, never in the repo. `DATABASE_URL` is set directly in `docker-compose.yml` (not secret — it's just a local file path) since it's the only variable in `src/env.js`'s current schema. When NextAuth is actually implemented, its secrets must be added to `src/env.js` first (per `AGENTS.md`'s hard rule), then provisioned via a VPS-local `.env` file read by `docker-compose.yml`'s `env_file:` directive — not committed to the repo.
- **Rollback**: `ssh szef@217.154.238.241`, then `cd /opt/swarm-arena && git checkout <previous-sha> && docker compose up -d --build`. No automated rollback command exists yet; this is a manual, few-minutes operation. The SQLite file does not roll back with the code — a bad migration needs its own recovery path (no backup mechanism configured yet, see risk register).
- **Approval**: routine deploys (push to `master`) are fully unattended via the GitHub Actions → SSH-forced-command path. Anything touching the VPS's root/sudo access, firewall (`ufw`) rules, SSH `authorized_keys`, or GitHub repo secrets/deploy-key registration is **human-only** — confirmed in practice during this setup, where the sandboxed agent session was blocked by its own safety classifier from writing SSH keys, GitHub secrets, or deploy keys, and the human had to run those specific commands directly.
- **Logs/monitoring**: no centralized log aggregation or uptime monitoring configured yet — `docker compose logs` over SSH is the only visibility today. Worth adding a simple uptime check (e.g. a free UptimeRobot/healthchecks.io ping against `http://217.154.238.241`) before relying on this for anything beyond personal MVP testing.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| No backup mechanism for the SQLite file — a single bind-mounted file on a single VPS disk is a single point of failure | Research finding | M | H | Add a simple cron job (e.g. nightly `sqlite3 .backup` to a separate path, or rsync off-box) before real user data accumulates |
| No automated rollback — reverting a bad deploy is a manual multi-command SSH operation under time pressure | Research finding | M | M | Script a `rollback.sh` on the VPS now (mirrors `deploy.sh` but checks out a given SHA) so recovery isn't improvised later |
| No firewall-level protection beyond `ufw`'s three allowed ports — no fail2ban, no rate limiting on SSH | Unknown unknowns | L | M | Consider `fail2ban` for SSH brute-force protection once this is more than a personal MVP; low priority at current scale |
| No TLS yet — the app is served over plain HTTP on the bare IP | Devil's advocate | H | L | Acceptable for MVP/personal testing; add a domain + update the `Caddyfile` to enable Caddy's automatic HTTPS the moment real users are expected |
| Single VPS, single point of failure for both app and data — no redundancy, no horizontal scaling path without real work | Devil's advocate | L | M | Acceptable at the PRD's stated scale (single user, low QPS); revisit only if that changes materially |
| The two deploy-related SSH keys (GitHub Actions trigger key, VPS's read-only repo-pull key) both live outside this repo's version control, with no documented rotation procedure | Unknown unknowns | L | M | Document a rotation runbook (generate new key, update GitHub secret/deploy-key, remove old one) before either key is ever suspected compromised |
| The WebSocket-based simulation loop that justified a persistent-container deployment in the first place doesn't exist in code yet — this deployment validates the pipeline, not the feature | Research finding | M | M | Load-test the actual WebSocket/SSE feature through Caddy once it's implemented; don't assume today's HTTP-only verification covers it |

## Getting Started (what's already done)

The VPS is live and deployed — these are the steps already executed, documented for reproducing on a fresh box if needed:

1. `curl -fsSL https://get.docker.com | sudo sh` — installs Docker Engine + Compose plugin.
2. `sudo usermod -aG docker <user>` — avoids needing `sudo` for every `docker` call.
3. `sudo ufw allow 22,80,443/tcp && sudo ufw enable` — minimal firewall.
4. Add `output: "standalone"` to `next.config.js`, add `Dockerfile`/`docker-compose.yml`/`Caddyfile`/`deploy.sh` to the repo (committed, see repo root).
5. Generate a dedicated deploy-trigger keypair, add its public half to the VPS's `authorized_keys` restricted to a forced command, add its private half as the `DEPLOY_SSH_KEY` GitHub Actions secret.
6. Generate a separate read-only keypair directly on the VPS, register its public half as a GitHub repo deploy key (`gh repo deploy-key add`, read-only), use it for `git pull` on the VPS via `git config core.sshCommand`.
7. Clone the repo into `/opt/swarm-arena`, `chown` the `data/` subdirectory to match the container's non-root uid (1001), run `docker compose up -d --build`.
8. Run Drizzle migrations against the production DB once: `docker run --rm -v /opt/swarm-arena:/app -v /opt/swarm-arena/data:/data -w /app -e DATABASE_URL=file:/data/db.sqlite node:22-alpine sh -c "npm ci && npx drizzle-kit push"`.

## Out of Scope

The following were not evaluated or built in this deployment:
- CI/CD beyond the single deploy-on-push workflow (no test/lint gate before deploy yet)
- Production-scale architecture (multi-region, HA, DR, load balancing)
- TLS/HTTPS (no domain pointed at the VPS yet)
- Backups and monitoring (flagged in the risk register, not yet implemented)
