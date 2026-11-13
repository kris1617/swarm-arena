// Seed test — the pattern every generated E2E test copies.
// Protects: unauthenticated visitor hitting a protected route is gated to
// /login (src/middleware.ts matcher excludes only /login, /api/auth/*,
// static assets — every other route, including /, requires a session).
//
// Not a risk in context/foundation/test-plan.md (that plan currently routes
// every risk to unit/integration), picked by request when setting up E2E
// infrastructure for this project.
import { expect, test } from "@playwright/test";

// The risk is the signed-out path itself, so this test opts out of any
// saved session rather than loading one.
test.use({ storageState: { cookies: [], origins: [] } });

test("unauthenticated visit to / is gated by sign-in", async ({ page }) => {
	// Setup: a visitor without a session opens a protected route.
	await page.goto("/");

	// The gate sends them to /login with the original destination preserved,
	// and no protected content is rendered.
	await page.waitForURL("**/login**");
	await expect(
		page.getByRole("heading", { name: "Sign in", level: 1 }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Sign in with GitHub" }),
	).toBeVisible();

	// No data created by this test, so nothing to clean up.
});
