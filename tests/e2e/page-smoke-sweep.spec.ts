// risk: a page/route renders a broken, crashed, or stale/unintended state
//       to a signed-in user — unhandled client-side exception, un-replaced
//       scaffold content, non-functional UI element — invisible to server
//       logs and the existing unit/integration suite, since the two
//       confirmed incidents this pattern protects against
//       (admin-settings-range-backfill, root-page-scaffold-redirect) were
//       both client-side-only failures that returned HTTP 200.
//
// test-plan.md §2 Risk #10 / §3 Phase 11.
import { expect, type Page, test } from "@playwright/test";
import { signInAsAdminTestUser } from "./admin-fixture";

// Mirrors auth-ux.spec.ts's signInAsFreshTestUser — no cross-file import
// precedent exists for Playwright specs in this repo, so this duplicates
// the minimal helper rather than exporting one from auth-ux.spec.ts.
async function signInAsFreshTestUser(page: Page): Promise<string> {
	const secret = process.env.E2E_TEST_AUTH_SECRET;
	if (!secret) {
		throw new Error(
			"Set E2E_TEST_AUTH_SECRET (see context/foundation/test-stack.md, ## E2E)",
		);
	}
	const email = `page-sweep-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.com`;

	const response = await page.request.post("/api/test-auth/login", {
		data: { email, secret },
	});
	expect(response.ok(), await response.text()).toBeTruthy();

	await page.goto("/dashboard");
	await expect(page).not.toHaveURL(/\/login/);

	return email;
}

type ConsoleErrors = { errors: string[] };

function trackConsoleErrors(page: Page): ConsoleErrors {
	const tracked: ConsoleErrors = { errors: [] };
	page.on("console", (msg) => {
		if (msg.type() === "error") tracked.errors.push(msg.text());
	});
	page.on("pageerror", (err) => tracked.errors.push(err.message));
	return tracked;
}

test.describe("page smoke sweep — shared session", () => {
	test("/ redirects a signed-in session straight to /dashboard", async ({
		page,
	}) => {
		const tracked = trackConsoleErrors(page);
		await page.goto("/");
		await expect(page).toHaveURL(/\/dashboard$/);
		expect(tracked.errors).toEqual([]);
	});

	test("/dashboard renders without error", async ({ page }) => {
		const tracked = trackConsoleErrors(page);
		await page.goto("/dashboard");
		await expect(
			page.getByRole("heading", { name: "Your Simulations", level: 1 }),
		).toBeVisible();
		expect(tracked.errors).toEqual([]);
	});

	test("/simulation renders without error", async ({ page }) => {
		const tracked = trackConsoleErrors(page);
		await page.goto("/simulation");
		await expect(
			page.getByRole("heading", { name: "Flocking Simulation", level: 1 }),
		).toBeVisible();
		expect(tracked.errors).toEqual([]);
	});

	test("/simulation/kitchen-sink renders without error", async ({ page }) => {
		const tracked = trackConsoleErrors(page);
		await page.goto("/simulation/kitchen-sink");
		await expect(
			page.getByRole("heading", { name: "Kitchen Sink", level: 1 }),
		).toBeVisible();
		expect(tracked.errors).toEqual([]);
	});

	test("/runs/compare renders without error", async ({ page }) => {
		// Visited without the required `ids` query param, this route
		// deliberately renders a graceful StatusMessage rather than its
		// `<h1>Compare runs</h1>` — that heading only exists in the branch
		// where a real comparison loaded successfully.
		const tracked = trackConsoleErrors(page);
		await page.goto("/runs/compare");
		await expect(
			page.getByText("Could not load this comparison."),
		).toBeVisible();
		expect(tracked.errors).toEqual([]);
	});

	test("/leaderboard renders without error", async ({ page }) => {
		const tracked = trackConsoleErrors(page);
		await page.goto("/leaderboard");
		await expect(
			page.getByRole("heading", { name: "Leaderboard", level: 1 }),
		).toBeVisible();
		expect(tracked.errors).toEqual([]);
	});

	test("/reference renders without error", async ({ page }) => {
		const tracked = trackConsoleErrors(page);
		await page.goto("/reference");
		await expect(
			page.getByRole("heading", { name: "Reference", level: 1 }),
		).toBeVisible();
		expect(tracked.errors).toEqual([]);
	});

	test("/reference/parameters renders without error", async ({ page }) => {
		const tracked = trackConsoleErrors(page);
		await page.goto("/reference/parameters");
		await expect(
			page.getByRole("heading", { name: "Parameters", level: 1 }),
		).toBeVisible();
		expect(tracked.errors).toEqual([]);
	});

	test("/reference/population-lifecycle renders without error", async ({
		page,
	}) => {
		const tracked = trackConsoleErrors(page);
		await page.goto("/reference/population-lifecycle");
		await expect(
			page.getByRole("heading", { name: "Population Lifecycle", level: 1 }),
		).toBeVisible();
		expect(tracked.errors).toEqual([]);
	});

	test("/reference/scoring renders without error", async ({ page }) => {
		const tracked = trackConsoleErrors(page);
		await page.goto("/reference/scoring");
		await expect(
			page.getByRole("heading", { name: "Scoring", level: 1 }),
		).toBeVisible();
		expect(tracked.errors).toEqual([]);
	});

	test("/reference/storyline renders without error", async ({ page }) => {
		const tracked = trackConsoleErrors(page);
		await page.goto("/reference/storyline");
		await expect(
			page.getByRole("heading", { name: "Storyline", level: 1 }),
		).toBeVisible();
		expect(tracked.errors).toEqual([]);
	});

	test("/admin/elevation renders without error for a non-admin", async ({
		page,
	}) => {
		const tracked = trackConsoleErrors(page);
		await page.goto("/admin/elevation");
		await expect(
			page.getByRole("heading", { name: "Admin Elevation", level: 1 }),
		).toBeVisible();
		expect(tracked.errors).toEqual([]);
	});
});

test.describe("page smoke sweep — gated routes", () => {
	// Each test here needs a distinct identity from the shared session
	// (promoted to admin, or driving a run-creation flow under its own
	// user) rather than mutating the default storageState user that every
	// other test in this file relies on.
	test.use({ storageState: { cookies: [], origins: [] } });

	test("/admin/settings renders without error for a real admin", async ({
		page,
	}) => {
		await signInAsAdminTestUser(page);
		const tracked = trackConsoleErrors(page);
		await page.goto("/admin/settings");
		// A non-admin would be redirected to /simulation — staying here
		// confirms the admin fixture actually worked, not just that some
		// page rendered.
		await expect(page).toHaveURL(/\/admin\/settings$/);
		await expect(
			page.getByRole("heading", {
				name: "Simulation Parameter Ranges",
				level: 1,
			}),
		).toBeVisible();
		expect(tracked.errors).toEqual([]);
	});

	test("/runs/[runId] renders without error for a real run", async ({
		page,
	}) => {
		await signInAsFreshTestUser(page);

		// Drive the same cheap start/stop sequence
		// authenticated-simulation-run.spec.ts uses, to produce a real
		// scored run — no seed/fixture inserts a run row directly.
		await page.goto("/simulation");
		await page
			.getByRole("spinbutton", { name: "Boid count (1-500)" })
			.fill("5");
		await page
			.getByRole("spinbutton", { name: "Predator count (0-500)" })
			.fill("0");
		// exact: true — the page also renders a "Start on server" button,
		// which a substring match on "Start" would collide with.
		const startButton = page.getByRole("button", {
			name: "Start",
			exact: true,
		});
		await startButton.click();
		const stopButton = page.getByRole("button", { name: "Stop", exact: true });
		await expect(stopButton).toBeVisible();
		await stopButton.click();
		await expect(page.getByText(/^Score: /)).toBeVisible();

		// Reach the run via the dashboard's own link, the same way a real
		// user would — not a hardcoded id.
		await page.goto("/dashboard");
		const runLink = page.getByRole("link", { name: "View analysis" }).first();
		await expect(runLink).toBeVisible();
		await runLink.click();

		const tracked = trackConsoleErrors(page);
		await expect(page).toHaveURL(/\/runs\/\d+$/);
		await expect(
			page.getByRole("heading", { name: /^Run #\d+ Analysis/, level: 1 }),
		).toBeVisible();
		expect(tracked.errors).toEqual([]);
	});
});
