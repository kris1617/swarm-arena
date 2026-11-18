// NextAuth v5's documented middleware pattern: export its `auth` wrapper
// as the named `middleware` export (a default export of `auth` is not
// recognized as the gate and silently lets every request through).
export { auth as middleware } from "~/server/auth";

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
