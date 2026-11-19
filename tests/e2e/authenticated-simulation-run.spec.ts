// risk: a signed-in user starting and stopping a simulation run never sees
//       it complete — the canvas never replaces the config form after
//       "Start" (e.g. the session isn't recognized, or the start mutation's
//       success handler fails to swap UI state), or stopping never returns a
//       scored summary with a working "Start New Run" control.
// seed: tests/e2e/seed.spec.ts
//
// Not a risk in context/foundation/test-plan.md (whose current risk map
// routes every risk to unit/integration); picked ad-hoc to exercise the
// authenticated path now that the local test-auth bypass makes it possible.
//
// No cleanup: src/server/api/routers/simulation.ts exposes only `start` and
// `stop` — there is no delete procedure to remove the run/score rows this
// test creates, the same way a real user's run would stay in the database.
import { expect, test } from "@playwright/test";

test("signed-in user starts a run, sees it running, and stops it to a scored summary", async ({
	page,
}) => {
	// Setup: a signed-in session (via storageState from tests/e2e/auth.setup.ts)
	// reaches the protected config form.
	await page.goto("/simulation");
	await expect(
		page.getByRole("heading", { name: "Flocking Simulation" }),
	).toBeVisible();
	const startButton = page.getByRole("button", { name: "Start" });
	await expect(startButton).toBeVisible();

	// Keep the run itself cheap/fast — only the state transitions matter here.
	await page.getByRole("spinbutton", { name: "Boid count (1-500)" }).fill("5");
	await page
		.getByRole("spinbutton", { name: "Predator count (0-500)" })
		.fill("0");

	// Action: start the run.
	await startButton.click();

	// The config form is gone; the canvas is running with a Stop control.
	await expect(startButton).toBeHidden();
	const stopButton = page.getByRole("button", { name: "Stop" });
	await expect(stopButton).toBeVisible();

	// Action: stop the run.
	await stopButton.click();

	// Stopping scores the run and offers a way back to a fresh config form —
	// the business outcome this test protects, not just "some button exists".
	await expect(stopButton).toBeHidden();
	await expect(page.getByText(/^Score: /)).toBeVisible();
	const startNewRunButton = page.getByRole("button", {
		name: "Start New Run",
	});
	await expect(startNewRunButton).toBeVisible();

	// Closing the loop: the flow can run again, not just once.
	await startNewRunButton.click();
	await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
});

// risk: a numeric field's HTML `min` attribute can fall off the `step`
// grid for the field's actual default value (e.g. min={2.5} with step="1"
// and a default of 20), which makes the browser treat the form as
// invalid and silently block the native submit — the "Start" button
// click does nothing, with no visible error. Unit/integration tests on
// buildStartInput() can never see this, since the bug never reaches
// React; only the real DOM's constraint validation surfaces it.
test("simulation config form is valid at its own untouched default values", async ({
	page,
}) => {
	await page.goto("/simulation");
	await expect(
		page.getByRole("heading", { name: "Flocking Simulation" }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Start", exact: true }),
	).toBeVisible();

	// No field is touched — this proves the defaults themselves satisfy
	// every field's min/max/step, which is exactly what a misaligned
	// `min` (off the `step` grid) would violate.
	expect(
		await page.evaluate(() => document.querySelector("form")?.checkValidity()),
	).toBe(true);
});
