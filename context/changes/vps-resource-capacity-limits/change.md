---
change_id: vps-resource-capacity-limits
title: Derive simulation capacity ceilings from the VPS's actual resources
status: implemented
created: 2026-11-15
updated: 2026-11-15
archived_at: null
---

## Notes

Roadmap F-07 (M-4, "Area, camera, and ops limits"). No prerequisites. MS-05.
Unlocks S-24 (configurable-area-and-camera-view) — the new area parameter's
admin-configurable range has no safe default without this.

**Outcome**: Concrete, documented ceilings exist for simulation area size,
object count, and concurrent run count — derived from this specific VPS's
actual CPU/RAM/disk, not arbitrary defaults.

**Confirmed VPS specs (2026-11-15, direct SSH inspection)**: 4 vCPU (AMD
EPYC-Milan), 7.7GiB RAM (~6.1GiB available at inspection time, no swap
configured), 232GB disk (187GB free). The app's Docker container currently
has no memory/CPU limit set (`docker inspect` reports unlimited).
`DEFAULT_MAX_OBJECT_COUNT = 500` (`parameter-ranges.ts`) was chosen to match
pre-existing hardcoded bounds, not derived from this hardware.

**Open (non-blocking) questions from the roadmap**:
- What safety margin to target when deriving a ceiling from available
  RAM/CPU (e.g. cap at 50% of available RAM)?
- Should the app enforce a container-level resource limit itself, or only
  enforce limits at the simulation-parameter level (area/object-count
  ranges)?

**Roadmap's own risk note**: Low — measurement and policy-setting, not new
code. Main risk is picking a ceiling too conservative or too loose (genuine
OOM risk on this no-swap machine if ignored).
