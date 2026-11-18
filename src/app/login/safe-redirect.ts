/**
 * Resolves next-auth's `callbackUrl` query param into a safe redirect
 * target. next-auth's middleware appends this as an **absolute** URL
 * (`request.nextUrl.href`), not a relative path — so this resolves `raw`
 * via `new URL(raw, currentOrigin)` and only accepts the result when its
 * origin matches `currentOrigin`, closing the open-redirect class
 * (protocol-relative URLs, cross-origin absolute URLs).
 *
 * `currentOrigin` is a parameter rather than read via `headers()`
 * internally, so this stays pure and directly unit-testable.
 */
export function resolveSafeRedirect(
	raw: string | string[] | undefined,
	currentOrigin: string,
	fallback: string,
): string {
	const value = Array.isArray(raw) ? raw[0] : raw;

	if (!value) {
		return fallback;
	}

	try {
		const resolved = new URL(value, currentOrigin);
		if (resolved.origin !== currentOrigin) {
			return fallback;
		}
		return `${resolved.pathname}${resolved.search}${resolved.hash}`;
	} catch {
		return fallback;
	}
}
