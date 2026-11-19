import { NextResponse } from "next/server";
import { SECURITY_HEADERS } from "~/lib/security-headers";
// NextAuth v5's `auth` dispatch (node_modules/next-auth/lib/index.js
// `handleAuth`) is a 3-way branch: authConfig's `authorized` callback
// returning a Response wins; else a custom middleware callback (this one)
// runs INSTEAD OF the automatic unauthorized->signIn redirect, not after
// it — passing a callback here does not layer on top of that redirect, it
// replaces it. So this callback must replicate that default redirect logic
// itself (mirroring handleAuth's own `!authorized` branch exactly,
// including the already-on-signin-page guard) rather than relying on
// `authorized` to have handled it, so the net auth behavior for every
// protected page stays identical to the plain `export { auth as
// middleware }` this replaces — only the headers are new.
import { auth } from "~/server/auth";
import { authConfig } from "~/server/auth/config";

// impl-review F2: read from authConfig.pages.signIn rather than a second
// "/login" literal, so this logic site and authConfig's own signIn page
// can't silently drift apart (the matcher's negative-lookahead below
// stays a plain string literal — Next.js needs config.matcher statically
// analyzable, and it's practically unreachable anyway since `/login`
// itself never enters this middleware function).
const SIGN_IN_PATH = authConfig.pages?.signIn ?? "/login";

export default auth((req) => {
	const isAuthorized = !!req.auth?.user;
	let response: NextResponse;
	if (!isAuthorized && req.nextUrl.pathname !== SIGN_IN_PATH) {
		const signInUrl = req.nextUrl.clone();
		signInUrl.pathname = SIGN_IN_PATH;
		signInUrl.searchParams.set("callbackUrl", req.nextUrl.href);
		response = NextResponse.redirect(signInUrl);
	} else {
		response = NextResponse.next();
	}
	for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
		response.headers.set(key, value);
	}
	return response;
});

// Required so `auth()` can run its database-session check against
// db.sqlite via the Drizzle adapter — the default Edge middleware
// runtime cannot open the local sqlite file.
export const runtime = "nodejs";

export const config = {
	matcher: [
		// impl-review F1: `.*\..*` matches a dot anywhere in the path, not
		// just a file extension — this also exempts every tRPC HTTP call
		// (always dotted, e.g. /api/trpc/post.hello) from this middleware
		// gate. Safe: tRPC's own `protectedProcedure` enforces auth
		// independently (src/server/api/trpc.ts), so this just means that
		// traffic gets tRPC's own JSON 401 instead of an HTML redirect to
		// /login — not an auth bypass.
		"/((?!login|api/auth|api/test-auth|_next/static|_next/image|.*\\..*).*)",
	],
};
