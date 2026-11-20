# Plan Brief: Shared AI toolkit registry (GitHub Packages)

Full plan: `context/changes/shared-ai-toolkit-registry/plan.md`

## What & Why

10xChampion (Module 5) is earned via exactly one of two tracks. This project already shipped Track A (CI code-review pipeline, demonstrated live on PR #11). This is the additional Track B artifact — packaging this project's own code-review conventions as a distributable npm package (`@kris1617/ai-toolkit`) via GitHub Packages, the course's recommended default (Model 1) model.

## Starting Point

Course materials fetched via `npx @przeprogramowani/10x-cli@latest get m5l4` — complete, working starter templates for package.json, install.js/uninstall.js, the publish workflow, and the team-rules file, all placeholder-scoped to `@twoj-zespol` ("your-team"). The spec also ships a skill-generation prompt (6 review categories derived from a conventions handout) for the one skill the package carries.

## Key Decisions

| Decision | Choice | Why |
|---|---|---|
| npm scope | `@kris1617` (real) replacing the `@twoj-zespol` placeholder | Matches the actual GitHub org/user this repo belongs to |
| Package location | `packages/ai-toolkit/`, not repo root | Repo root already has the Next.js app's own `package.json` — the spec itself anticipates this exact situation |
| Workspace membership | Standalone, not an npm workspace member | This package is meant to be installed by *other* repos, not consumed by swarm-arena itself |
| Model | Model 1 (GitHub Packages) | Zero extra infra, course's own stated default, matches this project's solo scale |
| Secret | Default ephemeral `GITHUB_TOKEN`, no new PAT | Spec explicitly uses this for same-org publishing |

## Phases

1. **Package skeleton + code-review skill content** — package.json, install.js/uninstall.js (reformatted to project style), the `code-review` SKILL.md (generated from the conventions handout), rules/CLAUDE.md, README.md
2. **CI/CD publish workflow** — a separate, path-scoped workflow (never touches the main app's deploy pipeline) that validates and publishes to GitHub Packages on push to master

**Prerequisites**: none beyond what's in the repo today. **Estimated effort**: 2 small phases.

## What We're NOT Doing

- Not rebuilding Track A (already shipped separately)
- Not Model 2 (AWS/Terraform) or Model 3 (full API+CLI)
- Not an npm workspace member of the root
- Not a new GitHub secret
- Not the optional cross-org consumer-auth helper (no real external consumers yet)

## References

- `.claude/prompts/m5l4-shared-conventions.md`, `m5l4-shared-spec-skill.md`, `m5l4-github-packages-spec-{pack,cicd}.md` (fetched course specs)
- `.claude/config-templates/m5l4-github-packages-*.template` (fetched starter code)
