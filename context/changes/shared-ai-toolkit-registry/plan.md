# Shared AI toolkit registry (GitHub Packages) — Implementation Plan

## Overview

Package this project's code-review conventions as a distributable npm package, `@kris1617/ai-toolkit`, publishable to GitHub Packages and installable by any consumer repository via `postinstall`. This is the 10xChampion M5L4 Track B artifact — built in addition to the already-shipped Track A (CI code-review pipeline), per the course's Model 1 (GitHub Packages) spec.

## Current State Analysis

- Repo root already has its own `package.json` (the Next.js app) — a second package.json cannot coexist at the root, so this package lives at `packages/ai-toolkit/` (the course spec's own documented fallback for exactly this situation: "unless the agent generated a monorepo layout; if so, use `packages/ai-toolkit/`").
- The course's `10x-cli` already fetched complete, working starter templates: `.claude/config-templates/m5l4-github-packages-{package.json,install.js,uninstall.js,publish-ai-toolkit.yml,rules.CLAUDE.md,consumer.npmrc}.template` — all placeholder-scoped to `@twoj-zespol` (Polish for "your-team"), needing a real scope substituted.
- `.claude/prompts/m5l4-shared-conventions.md` (team engineering conventions handout) and `m5l4-shared-spec-skill.md` (the skill-generation spec: name `code-review`, frontmatter, 6 review categories, output format) together fully specify the one skill this package ships.
- `biome.jsonc`'s `includes` list does not currently exclude `tools/ai-reviewer/` (the existing standalone CI tool), so new plain-JS files under `packages/` will be linted by the same convention — write `install.js`/`uninstall.js` in this project's tab-indentation style to pass `npm run check` without needing a new ignore entry.
- No GitHub Packages secret setup is needed for publishing: the spec uses the ephemeral default `GITHUB_TOKEN` (already available to Actions in this repo), not a new PAT.

## Phase 1: Package skeleton + code-review skill content

### Changes Required:

**`packages/ai-toolkit/package.json`**
- **Intent**: Real, publishable package metadata — the template with the scope substituted.
- **Contract**: copy `.claude/config-templates/m5l4-github-packages-package.json.template`, replacing `@twoj-zespol` with `@kris1617` throughout (name, bin commands stay named `ai-toolkit`/`ai-toolkit-uninstall` per spec).

**`packages/ai-toolkit/install.js`, `packages/ai-toolkit/uninstall.js`**
- **Intent**: Working installer/uninstaller, unchanged in logic from the fetched templates (idempotent, sentinel-marker-based, manifest-tracked) — reformatted to this project's tab-indentation Biome style.
- **Contract**: copy `.claude/config-templates/m5l4-github-packages-install.js.template` and `...uninstall.js.template` verbatim in logic, substituting only the package-name-derived sentinel markers (computed from `package.json`, not hardcoded — already how the template works) and re-indenting with tabs.

**`packages/ai-toolkit/skills/code-review/SKILL.md`**
- **Intent**: The one skill this package ships — reviews code against this project's own engineering conventions, generated from the conventions handout per the spec's exact requirements (not invented).
- **Contract**: YAML frontmatter `name: code-review`, `description: Review code changes against team engineering conventions, testing standards and security expectations.`; body organized by the 6 review categories (Naming, Error handling, TypeScript, Function design, Security, Testing), each derived from `.claude/prompts/m5l4-shared-conventions.md`'s own rules; output format section specifying `file:line` findings grouped Critical → Warning → Suggestion, ending in one of `APPROVE`/`REQUEST CHANGES`/`NEEDS DISCUSSION`.

**`packages/ai-toolkit/rules/CLAUDE.md`**
- **Intent**: The starter rules block consumers get appended into their own `CLAUDE.md`, scoped to the real package name.
- **Contract**: copy `.claude/config-templates/m5l4-github-packages-rules.CLAUDE.md.template`, substituting `@twoj-zespol/ai-toolkit` → `@kris1617/ai-toolkit`.

**`packages/ai-toolkit/README.md`**
- **Intent**: Install/uninstall instructions for a consumer repository, including the committed `.npmrc` registry mapping.
- **Contract**: install via `npm install @kris1617/ai-toolkit --save-dev`, consumer `.npmrc` containing only `@kris1617:registry=https://npm.pkg.github.com` (no token — per spec, tokens are CI/local-auth concerns, never committed), manual `npx ai-toolkit`/`npx ai-toolkit-uninstall` commands documented.

### Success Criteria:

#### Automated Verification:
- `npm pack --dry-run` succeeds from `packages/ai-toolkit/`: `cd packages/ai-toolkit && npm pack --dry-run`
- `node --check install.js && node --check uninstall.js` (syntax-valid)
- Lint passes on the new files: `npm run check`
- SKILL.md frontmatter validates: `name` matches directory name (`code-review`), `description` present

#### Manual Verification:
- Read the generated `SKILL.md` and confirm its review categories/output format match the spec exactly (not paraphrased loosely)
- Manually run the installer against a disposable scratch directory and confirm it creates `.claude/skills/code-review/SKILL.md`, appends the sentinel-marked rules block to a fresh `CLAUDE.md`, and writes `.claude/.ai-toolkit-manifest.json`; then run the uninstaller and confirm it removes exactly those additions

## Phase 2: CI/CD publish workflow

### Changes Required:

**`.github/workflows/publish-ai-toolkit.yml`**
- **Intent**: Validate and publish the package to GitHub Packages on push to `master`, using the course's own validation steps (skill frontmatter checks, `npm pack --dry-run`) plus a version-already-published skip so a push without a version bump doesn't fail on a 409.
- **Contract**: copy `.claude/config-templates/m5l4-github-packages-publish-ai-toolkit.yml.template`'s `validate`/`publish` jobs, substituting `@twoj-zespol` → `@kris1617`, adding a `working-directory: packages/ai-toolkit` default to every step (the template assumes repo-root package location; this repo needs the monorepo-subdir path), and pinning the two actions to the exact SHAs already used elsewhere in this repo's other workflows (`actions/checkout`, `actions/setup-node`) for consistency with the project's existing pinning convention.
- This is a **separate** workflow from `deploy.yml`/`review.yml` — triggers only on paths under `packages/ai-toolkit/**` plus the workflow file itself, so it never runs (and never blocks) the main app's deploy pipeline.

### Success Criteria:

#### Automated Verification:
- YAML is syntactically valid: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/publish-ai-toolkit.yml'))"`
- Locally simulate the validate job's steps against the real `packages/ai-toolkit/` content (skill frontmatter check, `npm pack --dry-run`) — all pass

#### Manual Verification:
- Push to `master` and confirm the Actions run shows both `validate` and `publish` jobs passing, and the package actually appears under the repo's GitHub Packages tab with version `0.1.0` listed

## What We're NOT Doing

- Not building Track A again — it's already shipped and demonstrated (`tools/ai-reviewer`, `.github/workflows/review.yml`, PR #11). This is a genuinely separate, additional artifact, not a replacement.
- Not building Model 2 (AWS CodeArtifact + Terraform) or Model 3 (full API+CLI) — Model 1 (GitHub Packages) is the deliberate choice: zero extra infra, matches this solo project's scale, and is the course's own stated default.
- Not making `packages/ai-toolkit` an npm workspace member of the root `package.json` — it's meant to be installed by *other* repositories, not consumed by swarm-arena itself; keeping it fully standalone (its own `package.json`, no shared `node_modules`) avoids any risk of the main app's build/lint tooling treating it as part of the Next.js app.
- Not adding a new GitHub repo secret — publishing uses the default ephemeral `GITHUB_TOKEN`, already available to Actions with `packages: write` permission scoped to the one job that needs it.
- Not adding the optional `GH_PKG_TOKEN` preinstall helper for third-party consumer CI — this package has no real external consumers yet; documented as a future addition in the README, not implemented speculatively.

## Progress

### Phase 1: Package skeleton + code-review skill content

#### Automated

- [x] 1.1 `npm pack --dry-run` succeeds
- [x] 1.2 `node --check install.js && node --check uninstall.js`
- [x] 1.3 Lint passes: `npm run check`
- [x] 1.4 SKILL.md frontmatter validates (name matches directory, description present)

#### Manual

- [x] 1.5 SKILL.md review categories/output format match the spec exactly
- [x] 1.6 Installer/uninstaller round-trip verified against a disposable scratch directory

### Phase 2: CI/CD publish workflow

#### Automated

- [x] 2.1 YAML is syntactically valid
- [x] 2.2 Validate-job steps pass locally against real package content

#### Manual

- [ ] 2.3 Live push confirms both jobs pass and the package appears in GitHub Packages
