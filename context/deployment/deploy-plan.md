# Deployment Plan — swarm-arena → self-hosted VPS

Status: **executed**, 2026-11-09. This records what was actually done (not just what was planned) — per the lesson's own convention, this file is ground truth for later milestone planning about what's already deployed and which secrets/keys are already wired.

## Target

Self-hosted VPS (`szef@217.154.238.241`, Ubuntu 26.04), overriding the researched PaaS recommendation (Railway) — see `context/foundation/infrastructure.md` for the rationale and `context/foundation/archive/2026-11-09-infrastructure.md` for the superseded research.

## What's deployed

- **Reverse proxy**: Caddy 2 (alpine image), ports 80/443, config at repo root `Caddyfile`. Serves `swarmarena.hopto.org` with automatic Let's Encrypt TLS (added 2026-11-09); HTTP redirects to HTTPS automatically.
- **App**: Next.js 16 (T3 stack) built via multi-stage `Dockerfile`, `output: "standalone"`, running as non-root user `nextjs` (uid 1001), bound to `127.0.0.1:3000` only (Caddy is the sole public entrypoint).
- **Database**: SQLite via libsql, file at `/opt/swarm-arena/data/db.sqlite` on the host, bind-mounted into the container at `/data`. Schema was originally pushed via `drizzle-kit push` run once via a throwaway `node:22-alpine` container — **fixed 2026-11-14** (see "Known gaps" below): `deploy.sh` now runs `drizzle-kit migrate` automatically on every deploy, against the Dockerfile's `builder` stage image (which has the full repo + `node_modules`; the final `runner` stage ships only the Next.js standalone output and has neither).
- **Firewall**: `ufw` active, allowing only 22 (SSH), 80 (HTTP), 443 (HTTPS, unused today).
- **Auto-deploy**: `.github/workflows/deploy.yml` on push to `master` → SSH to the VPS using a dedicated, forced-command-restricted deploy key (`DEPLOY_SSH_KEY` GitHub Actions secret) → runs `/opt/swarm-arena/deploy.sh` (`git pull --ff-only && docker compose build app && docker build --target builder ... && docker run ... drizzle-kit migrate && docker compose up -d`).
- **Repo pull access on the VPS**: a separate, read-only GitHub deploy key (`swarm-arena-vps-readonly`), registered via `gh repo deploy-key add` without write access, used only for `git pull` — kept distinct from the GitHub-Actions-side trigger key.

## Secrets/keys already wired (for future reference)

| Credential | Where it lives | Scope |
|---|---|---|
| `DEPLOY_SSH_KEY` | GitHub Actions secret, `kris1617/swarm-arena` repo | Forced-command-only on the VPS — can only run `deploy.sh`, no shell |
| `swarm-arena-vps-readonly` deploy key | GitHub repo deploy keys (public half); private half on VPS at `~/.ssh/github_deploy_key` | Read-only `git clone`/`pull` of this one repo |
| `DATABASE_URL` | `docker-compose.yml`, plain (not secret) | `file:/data/db.sqlite` inside the `app` container |

**Known gap (2026-11-11):** F-01 (auth) shipped 2026-11-10 and made `AUTH_SECRET`/`AUTH_GITHUB_ID`/`AUTH_GITHUB_SECRET` required in `src/env.js`, but this doc and `docker-compose.yml`'s `environment:` block were never updated to match — the VPS never received these secrets. The Docker *build* stage sets `SKIP_ENV_VALIDATION=1` so it doesn't catch this, but the running container does not skip validation and crashes at startup without them, producing a 500 on every request. `docker-compose.yml` now references `${AUTH_SECRET}`/`${AUTH_GITHUB_ID}`/`${AUTH_GITHUB_SECRET}`/`${ADMIN_EMAILS}` (resolved from an untracked `/opt/swarm-arena/.env` on the VPS, which Compose reads automatically) — but that `.env` file still needs to be created on the VPS with real values (a production-specific GitHub OAuth app, since OAuth Apps only support one callback URL each) before the next deploy will actually come up healthy.

**Known gap (2026-11-14, fixed same day):** `deploy.sh` never ran migrations at all — the "schema pushed via a throwaway container" line above was describing a one-off manual step, not anything automated. Every schema change since (`admin_settings` table, `simulationRuns.savedState` column, added 2026-11-14) was applied to the local dev DB via `drizzle-kit push` but never captured as a committed migration file, and even once one exists, nothing on the VPS would have applied it. This surfaced as CI itself failing (`npm test` against a freshly-`db:migrate`'d test DB hit "no such table: admin_settings"), which blocked every deploy (`needs: test`) and produced deploy-failure notifications on every push since. Fixed by: generating the missing `drizzle/0003_*.sql` migration, and adding an automatic `drizzle-kit migrate` step to `deploy.sh` (via the Dockerfile's `builder` stage, which has `node_modules` — the final `runner` stage doesn't).

**Still open as of 2026-11-14:** the production SQLite file itself has never had `admin_settings`/`savedState` applied (the gap above prevented every deploy since Phase 2 of `full-score-save-resume` from reaching production at all). The very next successful deploy will run the new automatic migration step and fix this going forward — but that deploy hasn't happened yet as of this note. No manual intervention needed beyond letting the next push through CI.

## Verification performed

- `http://217.154.238.241` returns HTTP 200 from outside the VPS.
- `https://swarmarena.hopto.org` returns HTTP 200 with a valid Let's Encrypt cert; plain `http://swarmarena.hopto.org` redirects to HTTPS.
- SQLite data confirmed to survive a `docker compose restart app` (bind-mount persistence check).
- A real push to `master` was confirmed to trigger the GitHub Actions workflow, which rebuilt and recreated the `app` container automatically, with the app staying healthy (HTTP 200) afterward.

## Known gaps (see risk register in `infrastructure.md` for full detail)

No backups, no automated rollback script, no monitoring/alerting, and the always-on WebSocket simulation loop that originally justified a persistent-container deployment doesn't exist in code yet — this deployment validates the pipeline and platform choice, not that specific future feature. The domain is dynamic DNS (`hopto.org`), not an owned domain — see risk register in `infrastructure.md`.
