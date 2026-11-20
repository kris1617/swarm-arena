# @kris1617/ai-toolkit

Team AI artifacts (agent skills and starter rules) distributed as an npm
package through GitHub Packages, for installation into any consumer
repository.

## Install

In the consumer repository, create (or extend) its `.npmrc` with the scope
mapping — no token in this file:

```
@kris1617:registry=https://npm.pkg.github.com
```

Then install the package as a dev dependency:

```sh
npm install @kris1617/ai-toolkit --save-dev
```

Installing (and every subsequent `npm install`) runs the package's
`postinstall` script, which:

- copies `skills/` into the consumer's `.claude/skills/` (currently just
  `code-review`)
- appends the `rules/CLAUDE.md` starter rules into the consumer's own
  `CLAUDE.md`, inside a sentinel-marked block (`<!-- BEGIN @kris1617/ai-toolkit -->`
  / `<!-- END @kris1617/ai-toolkit -->`) so a reinstall replaces only that block
- writes `.claude/.ai-toolkit-manifest.json`, tracking every file it installed
  so uninstall can remove exactly those files

The install is idempotent: running it again (e.g. on every `npm install`)
re-syncs the skill files and replaces the managed rules block without
duplicating it.

You can also run the installer manually, without a fresh `npm install`:

```sh
npx ai-toolkit
```

## Uninstall

```sh
npx ai-toolkit-uninstall
```

This removes every file recorded in `.claude/.ai-toolkit-manifest.json`,
strips the sentinel-marked rules block from the consumer's `CLAUDE.md` (the
rest of that file is left untouched), and deletes the manifest itself.

## Publishing (GitHub Packages, CI only)

Publishing to `https://npm.pkg.github.com` under the `@kris1617` scope runs
from this repository's own CI (`.github/workflows/publish-ai-toolkit.yml`)
using the ephemeral `GITHUB_TOKEN` already available to GitHub Actions — no
additional secret is configured for it.

## Future work

A `GH_PKG_TOKEN` preinstall helper (so a third-party consumer's own CI can
authenticate against this scope without a developer's personal token) is a
documented future addition, not implemented here — this package has no
external consumers yet.
