# Deployment Plan — swarm-arena → self-hosted VPS

Status: **executed**, 2026-11-09. This records what was actually done (not just what was planned) — per the lesson's own convention, this file is ground truth for later milestone planning about what's already deployed and which secrets/keys are already wired.

## Target

Self-hosted VPS (`szef@217.154.238.241`, Ubuntu 26.04), overriding the researched PaaS recommendation (Railway) — see `context/foundation/infrastructure.md` for the rationale and `context/foundation/archive/2026-11-09-infrastructure.md` for the superseded research.

## What's deployed

- **Reverse proxy**: Caddy 2 (alpine image), ports 80/443, config at repo root `Caddyfile`. No TLS yet (no domain pointed at the VPS).
- **App**: Next.js 16 (T3 stack) built via multi-stage `Dockerfile`, `output: "standalone"`, running as non-root user `nextjs` (uid 1001), bound to `127.0.0.1:3000` only (Caddy is the sole public entrypoint).
- **Database**: SQLite via libsql, file at `/opt/swarm-arena/data/db.sqlite` on the host, bind-mounted into the container at `/data`. Schema pushed via `drizzle-kit push` (run once via a throwaway `node:22-alpine` container against the production file).
- **Firewall**: `ufw` active, allowing only 22 (SSH), 80 (HTTP), 443 (HTTPS, unused today).
- **Auto-deploy**: `.github/workflows/deploy.yml` on push to `master` → SSH to the VPS using a dedicated, forced-command-restricted deploy key (`DEPLOY_SSH_KEY` GitHub Actions secret) → runs `/opt/swarm-arena/deploy.sh` (`git pull --ff-only && docker compose build app && docker compose up -d`).
- **Repo pull access on the VPS**: a separate, read-only GitHub deploy key (`swarm-arena-vps-readonly`), registered via `gh repo deploy-key add` without write access, used only for `git pull` — kept distinct from the GitHub-Actions-side trigger key.

## Secrets/keys already wired (for future reference)

| Credential | Where it lives | Scope |
|---|---|---|
| `DEPLOY_SSH_KEY` | GitHub Actions secret, `kris1617/swarm-arena` repo | Forced-command-only on the VPS — can only run `deploy.sh`, no shell |
| `swarm-arena-vps-readonly` deploy key | GitHub repo deploy keys (public half); private half on VPS at `~/.ssh/github_deploy_key` | Read-only `git clone`/`pull` of this one repo |
| `DATABASE_URL` | `docker-compose.yml`, plain (not secret) | `file:/data/db.sqlite` inside the `app` container |

No auth (NextAuth) secrets exist yet — `src/env.js` doesn't define any, and none should be added until the feature is actually implemented (per `AGENTS.md`'s env-var hard rule).

## Verification performed

- `http://217.154.238.241` returns HTTP 200 from outside the VPS.
- SQLite data confirmed to survive a `docker compose restart app` (bind-mount persistence check).
- A real push to `master` was confirmed to trigger the GitHub Actions workflow, which rebuilt and recreated the `app` container automatically, with the app staying healthy (HTTP 200) afterward.

## Known gaps (see risk register in `infrastructure.md` for full detail)

No backups, no automated rollback script, no TLS/domain, no monitoring/alerting, and the always-on WebSocket simulation loop that originally justified a persistent-container deployment doesn't exist in code yet — this deployment validates the pipeline and platform choice, not that specific future feature.
