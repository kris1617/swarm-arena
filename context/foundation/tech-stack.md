---
starter_id: t3
package_manager: npm
project_name: swarm-arena
hints:
  language_family: js
  team_size: solo
  deployment_target: self-hosted-vps
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: verified
  path_taken: custom
  quality_override: false
  self_check_answers:
    typed: true
    from_official_starter: true
    conventions: true
    docs_current: true
    can_judge_agent: true
  has_auth: true
  has_payments: false
  has_realtime: true
  has_ai: false
  has_background_jobs: false
---

## Why this stack

Swarm Arena is a solo, after-hours, 6-week MVP whose core mechanic — several boids/predator
simulations running continuously in parallel, observed live, and resumable across restarts —
ruled out the registry's recommended `(web, js)` default, 10x Astro Starter, whose own card warns
that its edge runtime constrains long-running tasks. The custom path led to the T3 Stack instead:
NextAuth and Drizzle give authentication and a persistent database from day one (matching the
PRD's admin/member roles and save/resume requirements), end-to-end TypeScript keeps the simulation
parameters and scores strongly typed across client and server, and the stack clears all four
agent-friendly gates with a verified bootstrapper confidence. Deployment targets `fly` rather than
the starter's default `vercel` — a persistent container is required for the always-on simulation
loop and any WebSocket/SSE push to the live view, where serverless function timeouts would not
hold. CI runs on GitHub Actions with auto-deploy on merge, matching a solo after-hours workflow.
Payments and AI/LLM features are out of scope per the PRD; background-job infrastructure (queues/
cron) was not flagged as needed since the simulation tick runs as part of the long-lived server
process itself rather than a scheduled job.

**2026-11-09 update**: the deployment target was changed from the researched platform shortlist
(see `context/foundation/archive/2026-11-09-infrastructure.md` for that research — Railway was
recommended, Render runner-up) to a **self-hosted VPS already owned by the developer**, running
Docker + Caddy. The persistent-container requirement that ruled out serverless platforms still
holds and is satisfied the same way; `auto-deploy-on-merge` is now implemented directly via a
GitHub Actions workflow that triggers a restricted-SSH-key deploy script on the VPS, rather than
a PaaS's native git integration. See `context/foundation/infrastructure.md` for the current,
authoritative deployment decision.
