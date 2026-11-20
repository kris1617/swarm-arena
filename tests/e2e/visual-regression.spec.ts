// risk: a future token/spacing/width regression on a tracked critical
//       screen ships unnoticed because nothing but a human eyeballing the
//       page would catch it — the kitchen-sink pages exist specifically to
//       exercise every design-token/component permutation, so a pixel-level
//       diff against a known-good baseline is the cheapest test that gives
//       real signal here.
//
// test-plan.md §2 Risk #11 / §3 Phase 2.
//
// Each test reuses the default shared storageState (chromium project in
// playwright.config.ts) — no new fixture. The wait-for-heading readiness
// signal and route list mirror page-smoke-sweep.spec.ts's shared-session
// describe block exactly.
import { expect, test } from "@playwright/test";

test.describe("visual regression — critical screens", () => {
	test("/simulation matches its baseline", async ({ page }) => {
		await page.goto("/simulation");
		await expect(
			page.getByRole("heading", { name: "Flocking Simulation", level: 1 }),
		).toBeVisible();
		await expect(page).toHaveScreenshot();
	});

	test("/simulation/kitchen-sink matches its baseline", async ({ page }) => {
		await page.goto("/simulation/kitchen-sink");
		await expect(
			page.getByRole("heading", { name: "Kitchen Sink", level: 1 }),
		).toBeVisible();
		await expect(page).toHaveScreenshot();
	});

	test("/dashboard/kitchen-sink matches its baseline", async ({ page }) => {
		await page.goto("/dashboard/kitchen-sink");
		await expect(
			page.getByRole("heading", { name: "Dashboard Kitchen Sink", level: 1 }),
		).toBeVisible();
		await expect(page).toHaveScreenshot();
	});

	test("/leaderboard/kitchen-sink matches its baseline", async ({ page }) => {
		await page.goto("/leaderboard/kitchen-sink");
		await expect(
			page.getByRole("heading", {
				name: "Leaderboard Kitchen Sink",
				level: 1,
			}),
		).toBeVisible();
		await expect(page).toHaveScreenshot();
	});

	test("/runs/kitchen-sink matches its baseline", async ({ page }) => {
		await page.goto("/runs/kitchen-sink");
		await expect(
			page.getByRole("heading", {
				name: "Runs Analysis Kitchen Sink",
				level: 1,
			}),
		).toBeVisible();
		await expect(page).toHaveScreenshot();
	});

	test("/admin/kitchen-sink matches its baseline", async ({ page }) => {
		await page.goto("/admin/kitchen-sink");
		await expect(
			page.getByRole("heading", { name: "Admin Kitchen Sink", level: 1 }),
		).toBeVisible();
		await expect(page).toHaveScreenshot();
	});

	test("/reference/kitchen-sink matches its baseline", async ({ page }) => {
		await page.goto("/reference/kitchen-sink");
		await expect(
			page.getByRole("heading", { name: "Reference Kitchen Sink", level: 1 }),
		).toBeVisible();
		await expect(page).toHaveScreenshot();
	});
});
