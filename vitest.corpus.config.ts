import { defineConfig } from "vitest/config";

// parameter-sweep-corpus-generation Phase 4: a dedicated config for the
// one-time, long-running full-matrix corpus generation test. Vitest's CLI
// `--exclude` flag merges into (never replaces) a config's own `exclude`
// array, so `vitest.config.ts` excluding
// `scripts/corpus/generate-sweep.full.test.ts` from the default suite means
// that file can only run under a separate config that doesn't exclude it —
// this one. Mirrors `vitest.config.ts`'s `resolve.tsconfigPaths`, `test.env`,
// and `test.server.deps.inline` exactly; only `test.include` differs.
export default defineConfig({
	resolve: {
		tsconfigPaths: true,
	},
	test: {
		environment: "node",
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
		include: ["scripts/corpus/generate-sweep.full.test.ts"],
	},
});
