// Shared security header values applied to every response. Both
// next.config.js (plain ESM, loaded directly by Node — cannot import a .ts
// module without a build step) and src/middleware.ts (TypeScript, compiled
// by Next) import this single source of truth so the two never drift.
//
// next.config.js's headers() function needs the {key, value} array shape
// Next.js expects there; src/middleware.ts sets each header individually via
// response.headers.set(). This plain object serves both.

/** @type {Record<string, string>} */
export const SECURITY_HEADERS = {
	"X-Frame-Options": "DENY",
	"X-Content-Type-Options": "nosniff",
	"Referrer-Policy": "strict-origin-when-cross-origin",
	// domain-migration-swarmarena-fun (phase 4): `preload` added so this
	// domain can be submitted to hstspreload.org — the submission form
	// requires the literal `preload` directive, not just max-age +
	// includeSubDomains. This is a one-way door once browsers ship it:
	// removal from the preload list can take months to propagate.
	"Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
	"Content-Security-Policy":
		"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' avatars.githubusercontent.com data:; font-src 'self'; connect-src 'self';",
};
