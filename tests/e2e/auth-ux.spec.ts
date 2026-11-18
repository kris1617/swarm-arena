// Covers the google-style-auth-ux change (context/changes/google-style-auth-ux/plan.md,
// Phase 4): the redesigned /login card + error banner + deep-link-preserving
// sign-in (Phase 2), and the authenticated user menu's sign-out confirm
// dialog (Phase 3).
//
// GitHub's real OAuth consent screen is out of reach for Playwright, so the
// unauthenticated cases below stop at the pre-redirect UI and the redirect
// target (asserting the browser is on its way to github.com), never a
// completed OAuth round-trip. The authenticated cases reach a signed-in
// state via the same local-only test-auth bypass tests/e2e/auth.setup.ts
// uses (src/app/api/test-auth/login/route.ts), each with its own unique
// email so parallel runs don't collide.
import { expect, test } from "@playwright/test";

test.describe("unauthenticated /login", () => {
	// The risk here is the signed-out path itself, so these tests opt out of
	// the project's default signed-in storageState rather than loading it.
	test.use({ storageState: { cookies: [], origins: [] } });

	test("renders the sign-in card with the GitHub icon and sign-in button", async ({
		page,
	}) => {
		await page.goto("/login");

		await expect(
			page.getByRole("heading", { name: "Swarm Arena", level: 1 }),
		).toBeVisible();
		await expect(page.getByText("Sign in to continue")).toBeVisible();

		const signInButton = page.getByRole("button", {
			name: "Continue with GitHub",
		});
		await expect(signInButton).toBeVisible();
		// The button's accessible name is the GitHub icon's <title> ("GitHub")
		// followed by the visible label — proves the icon itself is present,
		// not just the text.
		await expect(signInButton).toHaveAccessibleName(
			/^GitHub Continue with GitHub$/,
		);
	});

	test("maps a known error code to friendly copy and falls back for an unknown one", async ({
		page,
	}) => {
		await page.goto("/login?error=AccessDenied");
		await expect(
			page.getByText("GitHub denied access to this account."),
		).toBeVisible();

		await page.goto("/login?error=NotARealCode");
		await expect(
			page.getByText("Something went wrong signing in. Please try again."),
		).toBeVisible();
	});

	test("a deep-link redirect preserves an absolute callbackUrl and sign-in heads toward GitHub", async ({
		page,
	}) => {
		// Setup: visit a protected route while signed out.
		await page.goto("/dashboard");
		await page.waitForURL(/\/login\?/);

		// The middleware's own redirect (not a hand-crafted one) appends an
		// absolute callbackUrl pointing back at the originally requested route.
		const redirectedUrl = new URL(page.url());
		const callbackUrl = redirectedUrl.searchParams.get("callbackUrl");
		expect(callbackUrl).toBeTruthy();
		expect(callbackUrl).toMatch(/^https?:\/\//);
		expect(callbackUrl).toContain("/dashboard");

		// Action: click sign-in — never completes GitHub's real consent screen,
		// only confirms the browser is actually routed there.
		await page.getByRole("button", { name: "Continue with GitHub" }).click();
		await page.waitForURL(/github\.com/);
		expect(page.url()).toContain("github.com");
	});

	test("a cross-origin callbackUrl never reaches a trusted redirect position", async ({
		page,
	}) => {
		await page.goto("/login?callbackUrl=https://evil.example.com");

		await page.getByRole("button", { name: "Continue with GitHub" }).click();
		await page.waitForURL(/github\.com/);
		expect(page.url()).not.toContain("evil.example.com");
	});
});

test.describe("authenticated user menu", () => {
	// Each test reaches a signed-in state itself (via the local-only
	// test-auth bypass, same mechanism as tests/e2e/auth.setup.ts) with its
	// own unique email, rather than relying on the shared default
	// storageState — keeps sign-out in this file from affecting other tests
	// sharing that session.
	test.use({ storageState: { cookies: [], origins: [] } });

	async function signInAsFreshTestUser(page: import("@playwright/test").Page) {
		const secret = process.env.E2E_TEST_AUTH_SECRET;
		if (!secret) {
			throw new Error(
				"Set E2E_TEST_AUTH_SECRET (see context/foundation/test-stack.md, ## E2E)",
			);
		}
		const email = `auth-ux-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.com`;

		const response = await page.request.post("/api/test-auth/login", {
			data: { email, secret },
		});
		expect(response.ok(), await response.text()).toBeTruthy();

		await page.goto("/dashboard");
		await expect(page).not.toHaveURL(/\/login/);

		return email;
	}

	test("sign-out confirm dialog can be cancelled without signing out, then confirmed to sign out", async ({
		page,
	}) => {
		const email = await signInAsFreshTestUser(page);

		const trigger = page.getByRole("button", { name: email });
		await expect(trigger).toBeVisible();

		// Cancelling the confirm dialog keeps the session intact.
		await trigger.click();
		await page.getByRole("menuitem", { name: "Sign out" }).click();
		const dialog = page.getByRole("alertdialog", { name: "Sign out?" });
		await expect(dialog).toBeVisible();
		await dialog.getByRole("button", { name: "Cancel" }).click();
		await expect(dialog).toBeHidden();

		await page.reload();
		await expect(page).not.toHaveURL(/\/login/);
		await expect(page.getByRole("button", { name: email })).toBeVisible();

		// Confirming actually signs out and lands on the acknowledgment page.
		await trigger.click();
		await page.getByRole("menuitem", { name: "Sign out" }).click();
		await expect(dialog).toBeVisible();
		await dialog.getByRole("button", { name: "Sign out" }).click();

		await page.waitForURL(/\/login\?signedOut=1/);
		await expect(page.getByText("You've been signed out.")).toBeVisible();
	});
});
