import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
	/**
	 * Specify your server-side environment variables schema here. This way you can ensure the app
	 * isn't built with invalid env vars.
	 */
	server: {
		DATABASE_URL: z.string().url(),
		NODE_ENV: z
			.enum(["development", "test", "production"])
			.default("development"),
		AUTH_SECRET: z.string().min(1),
		AUTH_GITHUB_ID: z.string().min(1),
		AUTH_GITHUB_SECRET: z.string().min(1),
		ADMIN_EMAILS: z.string().default(""),
		// next-auth v5 refuses every session (logs "UntrustedHost") unless the
		// request's host is explicitly trusted and no AUTH_URL is configured.
		// Required for `next start` against localhost (E2E) and, separately,
		// for the real deploy behind its reverse proxy — see
		// https://errors.authjs.dev#untrustedhost.
		AUTH_TRUST_HOST: z
			.string()
			.optional()
			.transform((v) => v === "true"),
		// Enables POST /api/test-auth/login, a database-session bypass for local
		// Playwright E2E runs (this app has no credentials provider — GitHub
		// OAuth only). The route 404s whenever this is unset — see its own
		// file for why that's the only gate. Never set this in a deployed
		// environment.
		E2E_TEST_AUTH_SECRET: z.string().optional(),
		// temporary-admin-elevation (FR-030): gates the self-service
		// elevateSelf mutation. Defaults to disabled — GitHub OAuth sign-in
		// has no allowlist, so without this flag any signed-up account could
		// self-elevate to admin. Enable only in a deployment where every
		// signed-up account is already trusted.
		ALLOW_SELF_ELEVATION: z
			.string()
			.optional()
			.transform((v) => v === "true"),
		// in-app-feedback-module (S-26): a GitHub fine-grained PAT, used
		// server-side only to create Issues in kris1617/swarm-arena — never
		// exposed to the client.
		GITHUB_FEEDBACK_TOKEN: z.string().min(1),
		// pre-existing-admin-settings-flakes: gates temporary diagnostic
		// logging in getOrSeedAdminSettings, added to investigate a rare
		// check-then-insert race (see
		// context/changes/pre-existing-admin-settings-flakes). Defaults to
		// disabled — never set this in a deployed environment.
		DEBUG_ADMIN_SETTINGS_RACE: z
			.string()
			.optional()
			.transform((v) => v === "true"),
	},

	/**
	 * Specify your client-side environment variables schema here. This way you can ensure the app
	 * isn't built with invalid env vars. To expose them to the client, prefix them with
	 * `NEXT_PUBLIC_`.
	 */
	client: {
		// NEXT_PUBLIC_CLIENTVAR: z.string(),
	},

	/**
	 * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
	 * middlewares) or client-side so we need to destruct manually.
	 */
	runtimeEnv: {
		DATABASE_URL: process.env.DATABASE_URL,
		NODE_ENV: process.env.NODE_ENV,
		AUTH_SECRET: process.env.AUTH_SECRET,
		AUTH_GITHUB_ID: process.env.AUTH_GITHUB_ID,
		AUTH_GITHUB_SECRET: process.env.AUTH_GITHUB_SECRET,
		ADMIN_EMAILS: process.env.ADMIN_EMAILS,
		AUTH_TRUST_HOST: process.env.AUTH_TRUST_HOST,
		E2E_TEST_AUTH_SECRET: process.env.E2E_TEST_AUTH_SECRET,
		ALLOW_SELF_ELEVATION: process.env.ALLOW_SELF_ELEVATION,
		GITHUB_FEEDBACK_TOKEN: process.env.GITHUB_FEEDBACK_TOKEN,
		DEBUG_ADMIN_SETTINGS_RACE: process.env.DEBUG_ADMIN_SETTINGS_RACE,
		// NEXT_PUBLIC_CLIENTVAR: process.env.NEXT_PUBLIC_CLIENTVAR,
	},
	/**
	 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
	 * useful for Docker builds.
	 */
	skipValidation: !!process.env.SKIP_ENV_VALIDATION,
	/**
	 * Makes it so that empty strings are treated as undefined. `SOME_VAR: z.string()` and
	 * `SOME_VAR=''` will throw an error.
	 */
	emptyStringAsUndefined: true,
});
