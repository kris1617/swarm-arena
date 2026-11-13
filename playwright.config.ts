import { existsSync } from "node:fs";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Local secrets (app env) come from the gitignored env file. In CI the file
// is absent and the variables come from the job.
if (existsSync(".env")) process.loadEnvFile(".env");

// 3000 is Next.js's documented default for `next start` (no port configured
// anywhere in this project). E2E_PORT overrides it when that port is taken.
const PORT = Number(process.env.E2E_PORT ?? 3000);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
	testDir: "./tests/e2e",
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: "html",
	use: {
		baseURL,
		trace: "on-first-retry",
		screenshot: "only-on-failure",
	},
	projects: [
		// This app has no credentials provider (GitHub OAuth only), so the
		// `setup` project signs in through the local-only test-auth bypass
		// (src/app/api/test-auth/login/route.ts) instead of a real UI form —
		// see context/foundation/test-stack.md ## E2E.
		{ name: "setup", testMatch: /.*\.setup\.ts/ },
		{
			name: "chromium",
			use: {
				...devices["Desktop Chrome"],
				storageState: "playwright/.auth/user.json",
			},
			dependencies: ["setup"],
		},
	],
	webServer: {
		// Mirrors the actual deploy (Dockerfile, context/deployment/deploy-plan.md):
		// `output: "standalone"` in next.config.js means the real production
		// artifact is `node .next/standalone/server.js`, not `next start` — which
		// Next.js itself warns is incompatible with standalone output and which
		// silently serves a dev-shaped server, not what's deployed. The
		// standalone build excludes static assets by design (meant to be copied
		// in, same as the Dockerfile's COPY lines), so they're copied in here too.
		// Next's standalone server.js chdir()s into its own directory on start,
		// so a relative DATABASE_URL (the .env default, "file:./db.sqlite")
		// would resolve under .next/standalone/ instead of the repo's real
		// db.sqlite — pass an absolute path to override it.
		command: `npm run build && rm -rf .next/standalone/public .next/standalone/.next/static && cp -r public .next/standalone/public && cp -r .next/static .next/standalone/.next/static && DATABASE_URL="file:${path.resolve(process.cwd(), "db.sqlite")}" PORT=${PORT} HOSTNAME=localhost node .next/standalone/server.js`,
		url: baseURL,
		reuseExistingServer: !process.env.CI,
		timeout: 180_000,
	},
});
