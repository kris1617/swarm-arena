// temporary-admin-elevation Phase 1: a plain, framework-free check so it's
// unit-testable without a DB or session — same discipline this project's
// lessons.md already established for `parameter-suggestion.ts` and
// `run-optimization-suggestion.ts`. Used by both NextAuth's `session`
// callback (src/server/auth/config.ts) and `adminProcedure`
// (src/server/api/trpc.ts), so expiry is checked consistently in both
// places rather than drifting between two hand-written conditions.

export function isEffectivelyAdmin(user: {
	role: "member" | "admin";
	elevatedUntil: Date | null;
}): boolean {
	if (user.role !== "admin") {
		return false;
	}
	if (user.elevatedUntil === null) {
		// Not time-boxed: either never elevated via this mechanism, or a
		// permanent ADMIN_EMAILS admin. Never expires.
		return true;
	}
	return user.elevatedUntil.getTime() > Date.now();
}
