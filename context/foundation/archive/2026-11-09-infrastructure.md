---
project: swarm-arena
researched_at: 2026-11-09
recommended_platform: Railway
runner_up: Render
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Next.js 16 (App Router, T3 Stack)
  runtime: Node.js (persistent container, custom server)
---

## Recommendation

**Deploy on Railway.**

Railway scored highest of the four shortlisted platforms (4 Pass / 1 Partial against the five agent-friendly criteria) — GA managed Postgres/Redis, GA markdown docs, the most polished first-party MCP server of any researched platform (one-line OAuth setup at `mcp.railway.com`, no stored tokens), and always-on containers that natively support the simulation's persistent WebSocket loop. The developer interview's "prioritize DX" and "co-location preferred" answers both favor Railway directly. The anti-bias cross-check surfaced real open questions — Hobby-tier persistent-volume support for the SQLite file is contradicted across sources, and real compute cost for several parallel always-on simulations is unverified — but these are risks to validate early and mitigate, not disqualifying structural mismatches, and they're judged acceptable against Railway's stronger operability score.

## Platform Comparison

| Platform | CLI-first | Managed/Serverless | Agent-readable docs | Stable deploy API | MCP/Integration | Total |
|---|---|---|---|---|---|---|
| Railway | Partial | Pass | Pass | Pass | Pass | 4 Pass / 1 Partial |
| Render | Pass | Partial | Pass | Pass | Pass | 4 Pass / 1 Partial |
| Fly.io | Partial | Pass | Pass | Partial | Partial | 2 Pass / 3 Partial |
| Cloudflare (not shortlisted) | Pass | Partial | Pass | Partial | Pass | 3 Pass / 2 Partial |
| Vercel (hard-filtered out) | — | — | — | — | — | dropped: WebSocket is beta with a ~5-min practical duration cap, incompatible with an always-on loop |
| Netlify (hard-filtered out) | — | — | — | — | — | dropped: functions are stateless/short-lived, no confirmed WebSocket support at all |

Notes per platform:
- **Railway** — Strongest raw score: GA managed Postgres/Redis, GA markdown docs, GA hosted MCP server with a one-line OAuth setup, and `railway up`/`logs` are solid, scriptable commands. The one Partial (CLI-first) is rollback, which is officially dashboard-only (an unofficial `railway redeploy -s ... -y` workaround exists but isn't in the official reference). Managed/serverless scores Pass: always-on containers via Nixpacks/Docker, with Volumes for the SQLite file — though Hobby-tier volume availability is contradicted across sources (see risk register).
- **Render** — Tied with Railway on raw score. CLI is the most scriptable of the four (`render deploys create --wait --confirm -o json`, real exit codes), and it has an official MCP server. Scores Partial on managed/serverless because its Persistent Disk is explicitly single-instance (permanently caps horizontal scaling of the simulation workload) and the free tier spins down after 15 minutes idle, making the paid Starter tier mandatory from day one.
- **Fly.io** — CLI/deploy API scored Partial because `flyctl` has no native rollback command and WebSocket idle-timeout/concurrency behavior is community-sourced, not primary-doc-confirmed. Managed/serverless and docs both score Pass: Fly Machines are genuinely managed persistent containers, Volumes are GA, and `docs.fly.io/llms.txt` is published. MCP scores Partial — `mcp.fly.io` exists but its GA/beta status wasn't confirmable from primary sources. Has the most literally-matching reference tutorial for this exact stack (Next.js + WebSockets + local SQLite), and matches `tech-stack.md`'s prior deployment lean, but lost the top slot on raw operability score.
- **Cloudflare** — Not shortlisted despite decent raw scores. The project's SQLite-via-libsql database doesn't map onto Cloudflare's native D1 (different wire protocol; would require swapping the Drizzle driver and losing native SQL transactions), and the Next.js 16 adapter path is explicitly fragile (OpenNext breaks across Next.js minors; the newer `vinext` path lacks static pre-rendering and is preview-grade). This is a structural stack mismatch, not a scoring nuance.

### Shortlisted Platforms

#### 1. Railway (Recommended)

Best overall CLI/MCP/managed-services package of the four researched candidates, and the easiest "it just works" experience for co-located Postgres/Redis if the project ever migrates off SQLite. Always-on containers natively support the simulation's persistent WebSocket loop with no execution-duration ceiling. The MCP server is the most first-class and best-documented of any platform researched — relevant given this is an agent-driven solo build.

#### 2. Render

Most agent-scriptable deploy flow of the four (clean JSON output, real exit codes on `render deploys create`), and an official MCP server. Scored second because its disk model locks the simulation service to a single instance by design — a ceiling Railway's volume model doesn't share as explicitly — and its free tier's 15-minute spin-down makes the always-on requirement a paid-tier-only feature from the start.

#### 3. Fly.io

Fly Machines are real, managed, long-lived Docker containers with an official, dated tutorial for Next.js + WebSockets on this exact pattern, and Fly Volumes give the SQLite/libsql file durable local storage. The closest literal match to the project's requirements, but scored third on raw operability: no native rollback command, and WebSocket/MCP behavior relies more on community sources than primary docs.

## Anti-Bias Cross-Check: Railway

### Devil's Advocate — Weaknesses

1. **No official CLI rollback command.** Research found only an unofficial `railway redeploy -s <svc> -e <env> -y` workaround and a dashboard-based rollback path. For an agent-operated MVP, "revert a bad deploy" requires either a manual dashboard click or an unverified CLI incantation, undermining the CLI-first criterion exactly where it matters most.
2. **Hobby-tier volume support is conflicting/unverified.** The simulation's resumable state lives in a SQLite file on a Railway Volume. Third-party sources disagree on whether Hobby ($5/mo) actually supports persistent volumes at all. If it doesn't, the save/resume requirement (a must-have in the PRD) forces an unplanned upgrade to Pro ($20/mo) before the project even ships.
3. **Single-region, single-instance SQLite file is a silent scaling ceiling.** Running several parallel simulations (FR-013) on one Railway service sharing one SQLite file means all simulation loops compete for the same disk and the same Node event loop — there's no documented Railway primitive for sharding this across instances, and moving to Postgres later means a schema+driver migration, not a config change.
4. **Compute cost scales with "always-on," not with actual simulation activity.** Because Railway bills per-second regardless of load, running multiple parallel simulations continuously (the PRD's most expensive feature, already flagged as "consciously accepted" scope) could push a modest 1 vCPU/1GB box past its included Hobby credit — estimates in research ranged $3–30/mo with no authoritative confirmation, meaning the actual MVP cost is genuinely unknown until deployed.
5. **No confirmation Railway's Node runtime has been tested against Next.js 16's custom-server pattern specifically** — Railway runs arbitrary Node entrypoints fine in general, but nothing dated 2026 confirms Next 16 + custom WebSocket server was tested on Railway specifically (unlike Fly, which has an official, dated Next.js+WebSockets tutorial).

### Pre-Mortem — How This Could Fail

Six months in, the simulation feature is the thing users actually came for, and it's the thing breaking. The team assumed Railway's "always-on container" model meant "configure once, forget it" — but running several parallel boids simulations on one box quietly pushed past the Hobby plan's included compute credit, and the first surprise was a usage bill nobody had modeled, because the pricing research itself couldn't get firm numbers before launch. Worse, the save/resume feature — a core guardrail in the PRD — turned out to depend on Volume support that may not even exist on Hobby; the team discovered this only when a resumed simulation came back empty after a redeploy, because the SQLite file had silently been ephemeral the whole time. With no official rollback command, the fix for a bad deploy was a frantic dashboard click under time pressure instead of a scripted, agent-run revert. By the time someone asked "why didn't we catch this," the answer was that "it's a PaaS, it just works" had replaced actually reading Railway's own volume and billing docs before committing.

### Unknown Unknowns

- Railway Volumes are tied to a specific instance/region at creation; relocating a service to a different region later may mean a manual data migration, not a config flag — easy to not discover until you try to move.
- Railway's "restart on crash" default behavior interacts with an in-memory simulation loop: a crash doesn't just lose the current tick, it may restart faster than the app can flush state to SQLite, silently corrupting or truncating the save file under exactly the guardrail ("no state loss on save/resume") the PRD calls out.
- Deploys replace the running container — any WebSocket clients connected to the simulation's live view get force-disconnected on every deploy, with no documented graceful-drain window (unlike Fly's ~40-minute proxy drain); this will be especially visible since deploys will happen often during a 6-week after-hours sprint.
- Railway's hosted MCP server (`mcp.railway.com`) gives an agent OAuth-scoped control over the account's projects — if the OAuth session is broad, an agent session debugging one service could plausibly see or touch other projects in the same Railway account, which matters for the "scoped tokens, not master keys" posture this toolkit recommends.
- Credit-based/usage pricing models (seen across Railway, Netlify, Render in this research) are all mid-transition in 2026 — the exact Hobby-tier allowance and overage math may change again before this MVP ships, independent of anything the project does.

**Decision recorded**: Railway was the original leader by raw score; this cross-check was run on it first, then re-run on Fly.io after a provisional swap, before settling back on Railway as the final recommendation. The risks above are carried into the register below rather than used to swap again.

## Operational Story

- **Preview deploys**: Railway supports PR environments natively — enabling "PR Deploys" on a service spins up an isolated environment per pull request with its own URL, torn down automatically when the PR closes. No extra config beyond toggling the setting in the service's environment settings.
- **Secrets**: `railway variables set KEY=value` (or the dashboard) writes to Railway's encrypted variable store per environment; variables are injected at container boot. Rotate by re-running `railway variables set` and triggering a redeploy. CI pipelines should use a project-scoped Railway API token, not a personal account token.
- **Rollback**: no official CLI command — use the dashboard's Service → Deployments → "Redeploy" on a prior successful build (restores that build's image + its associated env vars as a new deployment). An unofficial `railway redeploy -s <svc> -e <env> -y` exists in some third-party guides but isn't in Railway's official CLI reference; don't depend on it without verifying against the current CLI `--help` output first. Database/volume state does not roll back automatically.
- **Approval**: deploys (`railway up`), log reads (`railway logs`), and restarts (`railway restart`) are agent-safe, scripted actions. Deleting a service, removing a volume, or rotating the project's primary API token are human-only operations — never run unattended.
- **Logs**: `railway logs -n 100` tails recent logs; `--build` shows build logs, `--dns` shows DNS logs. The hosted MCP server (`mcp.railway.com`) exposes structured log/status queries as an alternative to CLI parsing once wired up — verify its exact tool surface against current docs before relying on it for anything load-bearing.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| No official CLI rollback command; recovery requires a dashboard click or an unofficial CLI incantation | Devil's advocate | M | H | Document the exact dashboard rollback steps now (screenshots/runbook) so recovery isn't improvised under pressure; re-verify the unofficial CLI command against current `--help` before trusting it |
| Hobby-tier persistent-volume support for the SQLite save file is contradicted across sources | Devil's advocate | M | H | Spin up a throwaway Hobby service with a volume and confirm save/resume survives a restart before building further on this assumption; budget for Pro ($20/mo) if it fails |
| Compute cost for several parallel always-on simulations is unverified — estimates range $3–30/mo | Devil's advocate / Pre-mortem | M | M | Set a billing alert immediately after first deploy; load-test with the PRD's expected parallel-simulation count in week one, not week five |
| Crash + auto-restart may outrace the app's SQLite flush, corrupting or truncating the save file | Unknown unknowns | L | H | Implement write-ahead/fsync-on-tick-boundary saves, or an explicit "safe checkpoint" flush before any voluntary stop, so a crash loses at most one tick, not the whole file |
| Deploys force-disconnect WebSocket clients with no documented graceful-drain window | Unknown unknowns / Pre-mortem | H | M | Add client-side reconnect-with-backoff logic so the live view self-heals after every deploy, independent of how deploys are staged server-side |
| Railway's hosted MCP server has account-wide OAuth scope, not per-project scoping | Unknown unknowns | L | M | Review the MCP server's granted scope before connecting it to an agent session; prefer a project-scoped API token over broad OAuth where the workflow allows it |
| Railway's Node runtime hasn't been specifically confirmed against Next.js 16's custom-server + WebSocket pattern | Devil's advocate | L | M | Treat the first deploy as a spike — confirm the custom server boots, binds the Railway-provided `PORT`, and holds a WebSocket connection before building further features on top |
| Credit-based pricing model is still mid-transition industry-wide in 2026 | Unknown unknowns | M | L | Re-check Railway's current pricing page before each significant scale-up decision rather than relying on figures gathered during this research pass |
| Running several parallel simulations (FR-013) on one machine shares one event loop and one SQLite file — a scaling ceiling, not just a cost question | Research finding | M | M | Treat the single-machine/single-SQLite-file setup as sufficient for MVP scale (PRD: small user count, low QPS); revisit only if FR-013's parallel-run count grows materially |

## Getting Started

1. Install the CLI: `npm i -g @railway/cli` (matches this project's npm package manager), then `railway login`.
2. From the project root, run `railway init` to create a new Railway project, and `railway link` if a project already exists to connect this directory to it.
3. Add a persistent volume for the SQLite file: in the Railway dashboard, attach a Volume to the service and mount it at a path like `/data`; point `DATABASE_URL` at `file:/data/db.sqlite`. Confirm volume support on your actual plan tier before relying on it (see risk register) — a Hobby-tier smoke test is worth doing before the first real deploy.
4. Set environment variables before first deploy: `railway variables set DATABASE_URL=file:/data/db.sqlite` and any NextAuth provider secrets (`AUTH_SECRET`, OAuth client IDs/secrets) via `railway variables set KEY=value` — never commit these to the repo.
5. Deploy: `railway up`. Confirm the custom server binds to the `PORT` Railway injects (not a hardcoded port). Verify with `railway logs`, then open the live view and confirm a simulation survives a manual restart (`railway restart`) — the save/resume guardrail from the PRD.

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup
- Production-scale architecture (multi-region, HA, DR)
