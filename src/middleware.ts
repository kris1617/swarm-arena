// NextAuth v5's documented middleware pattern: export its `auth` wrapper
// as the named `middleware` export (a default export of `auth` is not
// recognized as the gate and silently lets every request through).
export { auth as middleware } from "~/server/auth";

// Required so `auth()` can run its database-session check against
// db.sqlite via the Drizzle adapter — the default Edge middleware
// runtime cannot open the local sqlite file.
export const runtime = "nodejs";

export const config = {
	matcher: ["/((?!login|api/auth|_next/static|_next/image|favicon.ico).*)"],
};
