import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		tsconfigPaths: true,
	},
	test: {
		environment: "node",
		// admin-ranges-and-hook-test-flakes: a PID-keyed lock held for the
		// lifetime of this invocation, so .claude/hooks/end-of-turn.sh can
		// detect an already-running `vitest` and skip its own nested run
		// instead of racing it. See vitest.global-setup.ts.
		globalSetup: ["./vitest.global-setup.ts"],
		env: {
			DATABASE_URL: "file:./db.sqlite",
			NODE_ENV: "test",
			AUTH_SECRET: "test-secret",
			AUTH_GITHUB_ID: "test-github-id",
			AUTH_GITHUB_SECRET: "test-github-secret",
			// in-app-feedback-module (S-26): required (z.string().min(1)) in
			// src/env.js, same tier as the required vars above — without this,
			// every test file would fail env validation at module load, not
			// just feedback.test.ts's own tests.
			GITHUB_FEEDBACK_TOKEN: "test-token",
		},
		server: {
			// next-auth's lib/env.js does `import { NextRequest } from "next/server"`
			// with no extension; Next ships no package.json "exports" map, so letting
			// Node's native ESM resolver load next-auth (as an externalized dep) can't
			// find it. Force it through Vite's own resolver instead, which resolves
			// extensionless subpaths the way Next's own bundler does.
			deps: {
				inline: [/next-auth/, /@auth\/.*/],
			},
		},
		projects: [
			{
				extends: true,
				test: {
					name: "serialized-shared-state",
					// vitest-parallel-flakiness: these 3 files all read/write the
					// shared admin_settings singleton row and/or insert
					// corpus-*@example.com fixture owners — concurrent execution
					// between them causes write-write corruption of
					// admin_settings.parameterRanges and false-positive
					// stray-owner assertions that no amount of in-test scoping
					// can fully eliminate while they can run in the same window.
					// Vitest's Projects feature serializes just this group;
					// everything else stays on the parallel "default" project
					// below.
					include: [
						"src/server/api/routers/simulation.test.ts",
						"scripts/corpus/harness.test.ts",
						"scripts/corpus/generate-sweep.smoke.test.ts",
					],
					fileParallelism: false,
				},
			},
			{
				extends: true,
				test: {
					name: "default",
					// .claude/skills/** ships its own node:test-style *.test.mjs files (run by the
					// 10x-cli toolkit itself, not this app) — exclude them, same category as the
					// context/, CLAUDE.md, .claude excludes already in biome.jsonc.
					// tests/e2e/**/*.spec.ts are Playwright specs, run by `npx playwright
					// test`, not Vitest — Vitest's default include glob also matches
					// `*.spec.ts`, so exclude the E2E directory explicitly.
					// The 3 files in the "serialized-shared-state" project above are
					// also excluded here so they aren't double-run.
					exclude: [
						"**/node_modules/**",
						".claude/**",
						"tests/e2e/**",
						"scripts/corpus/generate-sweep.full.test.ts",
						"src/server/api/routers/simulation.test.ts",
						"scripts/corpus/harness.test.ts",
						"scripts/corpus/generate-sweep.smoke.test.ts",
					],
					// vitest-parallel-flakiness: Vitest's default worker count (one per
					// CPU core) causes CPU/IO contention under this suite's file
					// parallelism, producing spurious testTimeout/hookTimeout failures on
					// slow-but-correct tests. Confirmed-supported in the installed Vitest
					// 5.1.0 — do NOT use `poolOptions`, which was removed in Vitest 4 and
					// silently no-ops. 8 fits this project's own dev machine; GitHub's
					// hosted ubuntu-latest runners have far fewer vCPUs (confirmed by a
					// CI-only spurious testTimeout on server-run-registry.test.ts's
					// fake-timer-heavy "unwatched-run tick throttling" test, which never
					// reproduces locally) — CI gets a lower cap to match its real core
					// count instead of oversubscribing it.
					maxWorkers: process.env.CI ? 4 : 8,
				},
			},
		],
	},
});
