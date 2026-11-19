#!/bin/sh
set -eu
cd /opt/swarm-arena
git pull --ff-only
docker compose build app
# Apply any new migrations against the production DB before the new image
# starts — previously a manual, undocumented step (see deploy-plan.md's
# "Known gap"), which is why admin_settings/savedState never landed here
# even after CI went green. The final `runner` stage ships only the Next.js
# standalone output (no devDependencies, no drizzle/ files — see Dockerfile),
# so this targets the `builder` stage instead, which already has the full
# repo + node_modules baked in as image layers; the `docker compose build`
# above just populated Docker's layer cache for it, so this build is cheap.
docker build --target builder -t swarm-arena-migrator:latest .
docker run --rm \
	-v /opt/swarm-arena/data:/data \
	-e DATABASE_URL=file:/data/db.sqlite \
	-e SKIP_ENV_VALIDATION=1 \
	swarm-arena-migrator:latest npx drizzle-kit migrate
docker compose up -d
# domain-migration-swarmarena-fun (correction to an earlier, insufficient
# fix): `caddy reload` re-reads Caddyfile through the *already-running*
# container's existing bind-mount handle. A single-file bind mount is tied
# to the source's inode, not its path — `git pull` above replaces
# Caddyfile via a new inode on every pull where its content changed, so a
# long-running caddy container can keep following the OLD inode and
# silently "successfully" reload stale content (confirmed live: `caddy
# reload` exited 0 and logged no error while the running config stayed
# unchanged). Force-recreating the caddy container re-establishes the
# bind mount against the current file every deploy, which `caddy reload`
# cannot guarantee. Costs a few seconds of caddy listening downtime
# (not a graceful reload) in exchange for actually working.
docker compose up -d --force-recreate caddy
