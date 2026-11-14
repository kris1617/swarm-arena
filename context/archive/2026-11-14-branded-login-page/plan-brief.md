# Branded Swarm Arena login page — Brief

Full plan: `context/changes/branded-login-page/plan.md`

## What this is

Roadmap S-15, M-3's north-star slice. Closes the last piece of FR-031 ("branded for Swarm Arena — name, framing, visual identity"): the browser tab favicon. Everything else FR-031 asks for (the login page's heading, copy, and token-based colors; the app-wide `<title>`) was already delivered by F-06 (`ui-design-system-foundation`), confirmed present by direct read during this change's planning.

## Starting Point

- Login page: already shows "Swarm Arena" + "Sign in to continue" on the app's gradient tokens, matching button styling — done in F-06 Phase 2.
- App title: already `"Swarm Arena"` — done in F-06 Phase 1.
- Favicon: still the generic default create-t3-app icon, untouched since the initial commit.
- This session also ran a full login/auth regression pass (middleware gate, GitHub OAuth redirect URL, sign-in/out, session handling) after F-06's restructuring — no issues found; out of scope for this plan's own diff.

## Key Decisions

| Decision | Choice | Why |
|---|---|---|
| Is the favicon in scope for this change? | Yes | User confirmed: FR-031's "visual identity" should cover the tab icon, not just text/color. |
| Icon design | Three triangles in a V/flock formation (boid motif) on a rounded-square backdrop, using the existing `--primary`/`--background` tokens | Matches the app's actual domain (a flocking simulator) and existing color system; user approved the generated preview directly. |
| Scope boundary | Favicon only — no new logo/wordmark elsewhere in the app | FR-031 is already satisfied elsewhere; avoid inventing a bigger branding project than requested. |

## Phases

1. **Replace the favicon** — swap `public/favicon.ico` for the agreed glyph; no code changes, since `layout.tsx`'s `metadata.icons` already points at the same filename.

**Prerequisites**: F-06 (done, archived). **Estimated effort**: trivial — one binary file swap, no logic.

## References

- `context/archive/2026-11-14-ui-design-system-foundation/plan.md`
- `context/foundation/prd.md` FR-031
