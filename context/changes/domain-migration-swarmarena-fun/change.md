---
change_id: domain-migration-swarmarena-fun
title: Migrate production from swarmarena.hopto.org to swarmarena.fun
status: implementing
created: 2026-11-19
updated: 2026-11-19
archived_at: null
---

## Notes

migrate the production site from the dynamic-DNS domain swarmarena.hopto.org to the newly-purchased swarmarena.fun -- Caddyfile site block, GitHub OAuth App callback URL (single-vs-dual-app decision), new Search Console property, canonical infra docs, and old-domain redirect-vs-sunset decision. DNS A record for swarmarena.fun already confirmed pointing at the VPS (217.154.238.241); HTTPS not yet working there since no Caddy site block/cert exists for it yet.
