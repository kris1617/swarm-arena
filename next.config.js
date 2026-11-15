/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";

/** @type {import("next").NextConfig} */
const config = {
	output: "standalone",
	// Self-hosted behind a reverse proxy (Caddy): without this, middleware's
	// own request.nextUrl (used by next-auth's auth() middleware wrapper to
	// build the /login?callbackUrl=... redirect) is rebuilt from the
	// standalone server's own bind address/port (this.fetchHostname, always
	// 0.0.0.0:3000 per the Dockerfile) instead of the real forwarded Host —
	// a *separate* code path from the one scripts/patch-next-forwarded-host.mjs
	// already fixes (that one only covers the main render/API request URL,
	// not middleware's). This flag makes middleware reuse the already-correct
	// forwarded-host URL instead of reconstructing a broken one.
	skipProxyUrlNormalize: true,
};

export default config;
