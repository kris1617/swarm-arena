// A real admin-role test user for specs that need `/admin/settings`.
//
// The shared `/api/test-auth/login` bypass route creates a plain
// {role: "member"} user and bypasses NextAuth's adapter entirely, so
// ADMIN_EMAILS's allowlist (which only fires on the adapter's own
// `createUser` event during a real OAuth sign-in) never applies to a
// bypass-created user. This fixture promotes one directly via Drizzle
// instead of relying on either mechanism.
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "~/server/db";
import { users } from "~/server/db/schema";

// Imports the app's own shared `db` singleton (never a raw
// `createClient(...)`) — this test process, the app's webServer process,
// and any parallel `npm test` vitest run all point at the same SQLite
// file, and `~/server/db`'s module sets a `busy_timeout` pragma on first
// import in a process, which a freshly-constructed client would not get.
export async function signInAsAdminTestUser(page: Page): Promise<string> {
	const secret = process.env.E2E_TEST_AUTH_SECRET;
	if (!secret) {
		throw new Error(
			"Set E2E_TEST_AUTH_SECRET (see context/foundation/test-stack.md, ## E2E)",
		);
	}
	const email = `admin-fixture-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.com`;

	const response = await page.request.post("/api/test-auth/login", {
		data: { email, secret },
	});
	expect(response.ok(), await response.text()).toBeTruthy();

	await db.update(users).set({ role: "admin" }).where(eq(users.email, email));

	await page.goto("/dashboard");
	await expect(page).not.toHaveURL(/\/login/);

	return email;
}
