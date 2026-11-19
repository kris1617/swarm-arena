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
