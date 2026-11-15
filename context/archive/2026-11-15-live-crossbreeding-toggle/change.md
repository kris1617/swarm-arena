---
change_id: live-crossbreeding-toggle
title: Live-adjust crossbreeding toggle on a running simulation
status: archived
created: 2026-11-15
updated: 2026-11-15
archived_at: 2026-11-15T19:24:24Z
---

## Notes

User toggles crossbreeding on or off for a running server-owned simulation and sees the effect on subsequent reproduction events — crossbreedingEnabled is already read fresh from run.params every tick (confirmed via code inspection), so this widens the live-adjustable allowlist rather than building new mechanism
