# UI simulation tokens Implementation Plan

## Overview

Introduce a real design-system contract (shadcn/ui, with token values derived from the palette already in use — not a new palette) and apply it to the simulation view, closing the 4 charges from `/10x-ui`'s audit: duplicated gradient/text literals, a duplicated pill-button with no shared component (and no disabled state), canvas colors disconnected from any token, and a raw-palette error color.

## Current State Analysis

Per `context/changes/ui-simulation-tokens/research.md`:

- No design system exists anywhere in this repo: `src/styles/globals.css` defines only `--font-sans`; no `src/components/`, no `components.json`, no shadcn.
- The dark-purple gradient background (`from-[#2e026d] to-[#15162c]`) and the translucent pill-button style (`bg-white/10 hover:bg-white/20`) are duplicated verbatim across 3 views (`simulation/page.tsx:48`, `src/app/page.tsx:13`, `src/app/login/page.tsx:5`; and 5 button locations respectively).
- The simulation view's canvas drawing (`simulation-canvas.tsx:52,54`) uses two raw hex colors that no Tailwind class can reach.
- The Start button (`simulation/page.tsx:126-132`) has `disabled={startRun.isPending}` wired but zero visual disabled styling.
- The error message (`simulation/page.tsx:137`) uses a raw `text-red-300` palette class.
- Tailwind v4 is already configured CSS-first (`@import "tailwindcss"` + `@theme` in `globals.css`, no `tailwind.config.js`) — compatible with shadcn's current CSS-variable-based theming approach directly.

### Key Discoveries:

- `src/app/simulation/_components/simulation-canvas.tsx:52,54` — canvas `ctx.fillStyle` assignments need the color *values* as JS, not CSS classes; the token source must be duplicated into a small JS constants file kept in sync, not just CSS variables.
- The existing look (deep violet-to-navy gradient, white text, translucent white overlays) is a deliberate, if undocumented, identity already visible to users — the token values this plan introduces are *named versions of what's already there*, not a new design.
- No light/dark toggle exists anywhere in the app; it is permanently dark-styled. Token values are scoped to a single theme.

## What We're NOT Doing

- No light/dark mode toggle — this app has none today; if `shadcn init` scaffolds a `.dark` block, it's populated with the same values as `:root` rather than inventing a second theme nobody asked for.
- No changes to `src/app/page.tsx`, `src/app/login/page.tsx`, or `src/app/_components/post.tsx` — those views share the same literals today but are out of scope for this change (`/10x-ui` is explicitly one view per change); they're left as future candidates to migrate onto the same tokens once this contract exists.
- No new visual design — token values are derived from the colors already on screen, not a rebrand.
- No Playwright/screenshot-testing tool installed — this repo has none, and the skill explicitly allows the no-test-runner form of the visual gate (a kitchen-sink page, manually screenshotted).
- No fix to `basic-flocking-loop`'s or `pseudo-3d-depth-rendering`'s simulation *logic* — this change touches only presentation (classNames, canvas fill colors, the two component files), never `src/server/simulation/boids.ts` or the tRPC router.

## Implementation Approach

Four phases, in `/10x-ui`'s mandated order (environment/library → token values → one view → states):

1. **Environment/library** — initialize shadcn/ui, add `Button` and `Input`. No view changes yet.
2. **Token values** — overwrite shadcn's generated placeholder values in `globals.css` with values derived from the existing palette; export the same raw values as a small JS constants module for the canvas.
3. **One view** — replace every literal identified in the audit with the new components/tokens in `simulation/page.tsx` and `simulation-canvas.tsx`.
4. **States** — a kitchen-sink page proving all 7 states for the Button/Input this view uses, screenshotted as the visual gate, plus the "where tokens/components live" rule added to `AGENTS.md`.

## Phase 1: Environment/library

### Overview

Initialize shadcn/ui and add the two components this view needs, without touching the simulation view yet.

### Changes Required:

#### 1. shadcn/ui initialization

**File**: `components.json` (new), plus whatever `src/lib/utils.ts` and CLI defaults shadcn scaffolds

**Intent**: Bring in shadcn's CLI-managed component/token scaffolding, matching the Tailwind v4 CSS-first setup already in place.

**Contract**: Run `npx shadcn@latest init` in the project root. Accept its Tailwind v4 CSS-variable-based setup (it detects the existing `@import "tailwindcss"` config automatically); when prompted for a base color, any placeholder choice is fine since Phase 2 overwrites the generated values entirely. This creates `components.json` and typically a `src/lib/utils.ts` (the `cn()` helper) — accept the CLI's own conventional paths rather than customizing them.

#### 2. Add Button and Input

**File**: `src/components/ui/button.tsx` (new), `src/components/ui/input.tsx` (new)

**Intent**: Pull in shadcn's maintained `Button` (with built-in hover/focus-visible/disabled variants — directly closing the "Start button has no disabled styling" charge) and `Input` components, to replace the 5+ duplicated literal button/input class strings found in the audit.

**Contract**: Run `npx shadcn@latest add button input`. Do not hand-write these components — use the CLI's own generated files as-is in this phase; Phase 3 is where they get used.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- `components.json` and `src/components/ui/button.tsx`, `src/components/ui/input.tsx` exist: `test -f components.json && test -f src/components/ui/button.tsx && test -f src/components/ui/input.tsx`

#### Manual Verification:

- None — this phase adds scaffolding only, nothing user-visible changes yet.

---

## Phase 2: Token values

### Overview

Replace shadcn's generated placeholder token values with values derived from the palette already visible on screen, and make the same values available to the canvas drawing code.

### Changes Required:

#### 1. Token values derived from the existing palette

**File**: `src/styles/globals.css`

**Intent**: Give the colors already in use (deep violet `#2e026d`, dark navy `#15162c`, white, a red used for errors, and the translucent white used for buttons/borders) real semantic names, replacing whatever placeholder values `shadcn init` generated — not picking a new palette.

**Contract**: In the `:root` block (and an identical `.dark` block, per "What We're NOT Doing"), set shadcn's standard variable set to values derived from the existing literals:
- `--background` ← `#15162c` (the gradient's darker stop; the solid surface components sit on)
- `--foreground` ← `#ffffff`
- `--primary` ← `#2e026d` (the gradient's accent stop)
- `--primary-foreground` ← `#ffffff`
- `--secondary` / `--muted` ← a slightly lighter shade of `--background` (shadcn needs these; nothing in the current view distinguishes them today, so derive rather than invent)
- `--secondary-foreground` / `--muted-foreground` ← `#ffffff` / a light gray (muted text has no precedent in this view; pick a value that passes a contrast check in Phase 4)
- `--destructive` ← derived from the existing `text-red-300` (`#fca5a5`), adjusted toward a slightly stronger red so it also works as `Button`'s destructive-variant fill if ever used, not only as text (exact value confirmed against Phase 4's error-state check)
- `--destructive-foreground` ← `#ffffff`
- `--border` / `--input` ← `#ffffff` (matching the existing `border-white/20` and `bg-white/10` literals — components reference them with the same `/20`, `/10` Tailwind opacity modifiers already used today, so the visual result is unchanged)
- `--ring` ← a lighter tone of `--primary` (nothing currently defines a focus-visible outline at all; this is a new addition the states phase will verify is visible against the dark background)
- Keep `--font-sans` exactly as-is (untouched by this change).
Publish every new variable through `@theme inline` (`--color-background: var(--background)`, etc.) following the same pattern already used for `--font-sans`, so `bg-background`, `text-foreground`, etc. become real Tailwind classes.

#### 2. Canvas-readable color constants

**File**: `src/styles/theme-colors.ts` (new)

**Intent**: Give `simulation-canvas.tsx`'s imperative `ctx.fillStyle` assignments the same two color values as the CSS tokens, since canvas drawing can't read a Tailwind class — closing the "canvas colors disconnected from any token" charge.

**Contract**: Export two named constants whose values are the same two hex strings assigned to `--background` and a color that corresponds to the existing boid-fill color (`#38bdf8` — not part of the audited "duplicated across views" literals, but still a raw hex this phase should name since it's in the same file). A one-line comment at the top of this file states it must be kept in sync with `globals.css` by hand (no build-time codegen is introduced for this — out of scope for a single-view change).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`

#### Manual Verification:

- None — no view reads these yet; Phase 3 wires them up.

---

## Phase 3: One view

### Overview

Apply the new tokens and components to the simulation view, removing every literal identified in the audit.

### Changes Required:

#### 1. Simulation page

**File**: `src/app/simulation/page.tsx`

**Intent**: Replace the page's literal gradient background, the 5 duplicated input literals, the duplicated button literal (now gaining a real disabled state for free from the `Button` component), and the raw-palette error text with the new tokens/components.

**Contract**: `<main>`'s className becomes `bg-gradient-to-b from-primary to-background text-foreground` (same gradient, now token-driven) plus its existing layout classes unchanged. Each of the 5 `<input>` elements becomes a shadcn `<Input>` (from `~/components/ui/input`), preserving each field's existing `type`/`value`/`onChange`/`min`/`step` props. The Start `<button>` becomes a shadcn `<Button>` (from `~/components/ui/button`), preserving its `disabled`/`type`/`onClick` wiring — the component's own disabled variant now provides the visual feedback the audit found missing. The error paragraph's class changes from `text-red-300` to `text-destructive`.

#### 2. Simulation canvas component

**File**: `src/app/simulation/_components/simulation-canvas.tsx`

**Intent**: Replace the canvas's two raw hex `fillStyle` assignments with the Phase 2 constants, and replace its own duplicated button literals and border literal with the same tokens/components used in `page.tsx`.

**Contract**: `drawBoids`'s two `ctx.fillStyle = "..."` lines import and use the two named constants from `src/styles/theme-colors.ts` instead of inline hex strings. The `<canvas>` element's className changes `border-white/20` to `border-border/20` (zero visual change, token-driven). The Stop button and the "Start New Run" button both become shadcn `<Button>` components, preserving their existing `onClick`/`type` wiring.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- Hardcoded-value scan finds nothing left in the view files: `! grep -nE '#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(|-\[[0-9.]+(px|rem)\]|\b(bg|text|border|ring|outline|from|via|to|fill|stroke|shadow|divide)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)\b' src/app/simulation/page.tsx src/app/simulation/_components/simulation-canvas.tsx` (the `! grep ...` form succeeds — exit code 1 — only when the scan finds zero matches)

#### Manual Verification:

- The simulation view looks visually identical to before this change (same gradient, same button/input appearance) — this phase renames values, it does not redesign.
- The Start button now visibly looks disabled (dimmed/different cursor) while a run is starting, which it did not before.

---

## Phase 4: States

### Overview

Prove all 7 states from `/10x-ui`'s Definition of Done for the Button/Input this view uses, via a kitchen-sink page as the visual gate, then leave a rule so the next agent stays on this contract.

### Changes Required:

#### 1. Kitchen-sink page

**File**: `src/app/simulation/kitchen-sink/page.tsx` (new)

**Intent**: Render the view's `Button` and `Input` across all 7 states side by side, so each one is visible at once rather than requiring the real view to be coaxed into each state manually — the cheapest form of the visual gate, per the skill, since this repo has no screenshot-testing tool installed and none is being added for this change.

**Contract**: A single page (gated behind the same auth middleware as the rest of the app — no new public route) rendering: a default `Button`, a `hover`-simulated/forced-state `Button` (shown via a documented way to force the CSS state in a static render, e.g. a second button with the hover classes applied directly for the screenshot, or a code comment instructing manual hover during the screenshot step — implementer's choice, documented either way), a focused `Input` (can be achieved with `autoFocus` for the screenshot), a `disabled` `Button`, an `Input` in an error state (paired with a `text-destructive` message, mirroring `page.tsx`'s pattern), an empty-state `Input` (default placeholder, no value), and a `loading` `Button` (the existing `{startRun.isPending ? "Starting..." : "Start"}` text-swap pattern already used in `page.tsx`, shown directly rather than reinvented).

#### 2. Agent rules

**File**: `AGENTS.md`

**Intent**: Make the contract stick for the next agent — without this, the next view built in this app will copy literals again, exactly as `page.tsx`/`login/page.tsx`/`post.tsx` did.

**Contract**: Add a `## UI` section (new H2, after the existing sections) stating: tokens live in `src/styles/globals.css` (`:root`, `@theme inline`); canvas-only color values live in `src/styles/theme-colors.ts` and must be kept in sync by hand; shared components live in `src/components/ui`; check that directory before writing a new one, add missing ones via `npx shadcn@latest add <name>`; no literal colors or arbitrary Tailwind values in views — reference a token. This section is independent of `CLAUDE.md`'s `<!-- BEGIN @przeprogramowani/10x-cli -->` block (that block is toolkit-managed and gets rewritten on every `10x-cli get`) — it goes in `AGENTS.md`, which has no such managed block.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- `AGENTS.md` contains the new UI section: `grep -q '^## UI$' AGENTS.md`

#### Manual Verification:

- All 7 states (default, hover, focus-visible, disabled, error, empty, loading) are visible on the kitchen-sink page — each one either genuinely shown or explicitly marked N/A with a reason in the page itself.
- A screenshot of the kitchen-sink page at desktop width and one mobile width (e.g. 375px) is taken and saved to `context/changes/ui-simulation-tokens/` as the visual-gate evidence.
- `--destructive`'s exact value (left approximate in Phase 2) gives readable contrast for error text on the `--background` color — adjust in `globals.css` if not, re-screenshot.
- `--ring`'s focus-visible outline is actually visible against the dark gradient background on a keyboard-focused `Input`/`Button` — adjust in `globals.css` if not.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- None — this change is presentation-only (classNames, canvas fill colors, two new component files from an external generator); no new business logic to unit-test.

### Integration Tests:

- None — consistent with this repo having no screenshot-testing tool and the skill's explicit no-test-runner visual-gate option.

### Manual Testing Steps:

1. After Phase 3, open `/simulation`, confirm it looks the same as before (same gradient, same button/input look) — a pure rename, not a redesign.
2. After Phase 3, start a run and confirm the Start button now visibly looks disabled while submitting.
3. After Phase 4, open the kitchen-sink page, confirm all 7 states are visible, screenshot desktop + one mobile width.
4. After Phase 4, tab through the real `/simulation` form with the keyboard and confirm the focus ring is visible on every control.

## Performance Considerations

None — shadcn's `Button`/`Input` are lightweight wrapper components; no new runtime cost beyond what two extra React components already add (negligible next to the existing canvas render loop).

## Migration Notes

Not applicable — no persisted data, no schema change; this is a presentation-layer-only change.

## References

- Related research: `context/changes/ui-simulation-tokens/research.md`
- `/10x-ui` skill: `.claude/skills/10x-ui/SKILL.md` (phase order, 7-state matrix, visual gate, "make it stick")
- Prior view implementation: `context/changes/basic-flocking-loop/plan.md` (Phase 3) — the original markup this change tokenizes

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Environment/library

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck`
- [x] 1.2 Linting passes: `npm run check`
- [x] 1.3 `components.json` and `src/components/ui/button.tsx`, `src/components/ui/input.tsx` exist

### Phase 2: Token values

#### Automated

- [ ] 2.1 Type checking passes: `npm run typecheck`
- [ ] 2.2 Linting passes: `npm run check`

### Phase 3: One view

#### Automated

- [ ] 3.1 Type checking passes: `npm run typecheck`
- [ ] 3.2 Linting passes: `npm run check`
- [ ] 3.3 Hardcoded-value scan finds nothing left in the view files

#### Manual

- [ ] 3.4 The simulation view looks visually identical to before this change
- [ ] 3.5 The Start button now visibly looks disabled while starting

### Phase 4: States

#### Automated

- [ ] 4.1 Type checking passes: `npm run typecheck`
- [ ] 4.2 Linting passes: `npm run check`
- [ ] 4.3 `AGENTS.md` contains the new UI section

#### Manual

- [ ] 4.4 All 7 states are visible on the kitchen-sink page
- [ ] 4.5 Screenshot evidence saved (desktop + one mobile width)
- [ ] 4.6 `--destructive` gives readable contrast for error text
- [ ] 4.7 `--ring` focus-visible outline is visible against the dark background
