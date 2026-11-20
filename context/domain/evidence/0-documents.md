# Document inventory — domain documents and product goals

- `context/foundation/prd.md` — Product Requirements Document (FR-### requirement numbers, Non-Functional Requirements, Access Control section). Primary domain-language source.
- `context/foundation/roadmap.md` — milestone/slice history, "Vision recap" section (restates product goals in product-outcome language).
- `context/foundation/test-plan.md` — risk map (§2) describes failure scenarios in user/business terms; useful for domain rules the team cares about even if not in the PRD.
- `context/foundation/lessons.md` — recurring project rules; some encode business-rule intent (e.g. access-control, idempotency) rather than pure code style.
- `context/archive/*/plan.md`, `context/archive/*/research.md` — per-change design decisions; cite the specific archived change-id when a term's origin traces here.
- `AGENTS.md` / `CLAUDE.md` — repo conventions, not product domain (consulted only if a convention encodes a domain rule, e.g. "no literal colors" is not domain, but "admin_settings is one global row" might reflect a real business constraint).
- `README.md` — minimal, mostly setup instructions, not domain language.

## Product goal quotes (for domain-language framing)

- PRD / roadmap: the product lets a signed-in user configure and run a 3D boids/predator-prey flocking simulation (client-ticked or server-owned), watch it live, score it, and compare/rank/export results — confirmed via `context/map/repo-map.md`'s TL;DR (itself derived from these same sources) and cross-checked against `prd.md` directly during synthesis.
