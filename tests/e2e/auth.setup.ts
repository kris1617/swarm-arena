import { expect, test as setup } from "@playwright/test";

const authFile = "playwright/.auth/user.json";

// This app has no credentials provider (GitHub OAuth only), so there is no
// real sign-in form to drive. Instead this calls the local-only test-auth
// bypass (src/app/api/test-auth/login/route.ts, gated on NODE_ENV !==
// "production" and E2E_TEST_AUTH_SECRET) to get a real database session for
// a seeded test user, then saves it the same way a UI sign-in would.
setup("create a test-user session and save it", async ({ page }) => {
	const email = process.env.E2E_USERNAME;
	const secret = process.env.E2E_TEST_AUTH_SECRET;
	if (!email || !secret) {
		throw new Error(
			"Set E2E_USERNAME and E2E_TEST_AUTH_SECRET (see context/foundation/test-stack.md, ## E2E)",
		);
	}

	// page.request (not the standalone `request` fixture) shares the page's
	// browser context, so the Set-Cookie this returns lands in the context
	// storageState() saves below.
	const response = await page.request.post("/api/test-auth/login", {
		data: { email, secret },
	});
	expect(response.ok(), await response.text()).toBeTruthy();

	// Confirm the session the route created is one the middleware accepts,
	// not just that the route returned 200.
	await page.goto("/");
	await expect(page).not.toHaveURL(/\/login/);

	await page.context().storageState({ path: authFile });
});
