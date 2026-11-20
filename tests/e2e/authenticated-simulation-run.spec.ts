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
// simulation-run-delete Phase 4: `api.simulation.deleteRun` now exists — the
// "delete a completed run from the dashboard" test below closes this file's
// own stated cleanup gap for the run it creates. The two tests above/below
// it still don't clean up after themselves (they don't need the deleted row
// gone for their own assertions), same posture a real user's run would have
// if they never deleted it.
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
	const startButton = page.getByRole("button", {
		name: "Start",
		exact: true,
	});
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
	const stopButton = page.getByRole("button", { name: "Stop", exact: true });
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
	await expect(
		page.getByRole("button", { name: "Start", exact: true }),
	).toBeVisible();
});

// risk: a user deletes a completed run from the dashboard (the Builder
// badge's last outstanding CRUD gap — simulation runs already had
// create/read/update but no delete), but the row stays visible because the
// confirm dialog never fires the mutation, or the list never refetches.
test("signed-in user deletes a completed run from the dashboard", async ({
	page,
}) => {
	// Setup: start and stop a run the same way the test above does, with a
	// boid/predator combination distinct from every other fixture in this
	// file so the dashboard row below can be found unambiguously.
	await page.goto("/simulation");
	await expect(
		page.getByRole("heading", { name: "Flocking Simulation" }),
	).toBeVisible();
	const startButton = page.getByRole("button", {
		name: "Start",
		exact: true,
	});
	await expect(startButton).toBeVisible();

	await page.getByRole("spinbutton", { name: "Boid count (1-500)" }).fill("4");
	await page
		.getByRole("spinbutton", { name: "Predator count (0-500)" })
		.fill("1");

	await startButton.click();
	await expect(startButton).toBeHidden();
	const stopButton = page.getByRole("button", { name: "Stop", exact: true });
	await expect(stopButton).toBeVisible();
	await stopButton.click();
	await expect(stopButton).toBeHidden();
	await expect(page.getByText(/^Score: /)).toBeVisible();

	// Action: find this run in the dashboard's Completed section. The visible
	// label and the delete button's accessible name share the same run id, so
	// read it off the label first rather than assuming row order.
	await page.goto("/dashboard");
	const rowLabel = page.getByText(/Run #\d+ — 4 boids, 1 predators/).first();
	await expect(rowLabel).toBeVisible();
	const labelText = await rowLabel.textContent();
	const runIdMatch = labelText?.match(/Run #(\d+)/);
	if (!runIdMatch) {
		throw new Error(
			`could not read a run id out of the dashboard label: ${labelText}`,
		);
	}
	const runId = runIdMatch[1];

	await page.getByRole("button", { name: `Delete run #${runId}` }).click();
	const confirmDialog = page.getByRole("alertdialog");
	await expect(confirmDialog).toBeVisible();
	await confirmDialog
		.getByRole("button", { name: "Delete", exact: true })
		.click();

	// Assertion: the row is gone from the Completed list — not just the
	// dialog closing.
	await expect(rowLabel).toBeHidden();
});

// risk: a signed-in user starts a server-run simulation, saves & pauses it,
// then deletes it from the dashboard — but the save-and-pause mutation
// targets the wrong run (a stale "running" DB row left over from an earlier,
// separate `npx playwright test` invocation — db.sqlite persists across
// webServer restarts even though the in-memory server-run-registry.ts
// doesn't), or the Saved-section delete (proven live only for Completed rows
// so far) never actually removes the row. Self-contained: this test starts
// the run itself and interacts with it entirely within its own lifetime,
// rather than relying on `.last()`/`.first()` over a list that could still
// contain another leftover row.
test("signed-in user starts a run on the server, saves & pauses it, then deletes it from the dashboard", async ({
	page,
}) => {
	await page.goto("/simulation");
	await expect(
		page.getByRole("heading", { name: "Flocking Simulation" }),
	).toBeVisible();

	// Distinct from every other fixture in this file, so the dashboard row
	// below is unambiguous even under `fullyParallel`.
	await page.getByRole("spinbutton", { name: "Boid count (1-500)" }).fill("6");
	await page
		.getByRole("spinbutton", { name: "Predator count (0-500)" })
		.fill("2");

	// Snapshot the server-run rows that exist before this test starts its
	// own, so the row this test just created can be told apart from any
	// stale leftover row rather than assumed to be the only one.
	const existingRunLabels = new Set(
		await page.getByRole("button", { name: /^Run #\d+$/ }).allTextContents(),
	);

	// Action: start a run on the server.
	await page.getByRole("button", { name: "Start on server" }).click();

	let newRunLabel: string | undefined;
	await expect
		.poll(async () => {
			const labels = await page
				.getByRole("button", { name: /^Run #\d+$/ })
				.allTextContents();
			newRunLabel = labels.find((label) => !existingRunLabels.has(label));
			return newRunLabel;
		})
		.toBeTruthy();
	if (!newRunLabel) {
		throw new Error("no new server run appeared after Start on server");
	}
	const runIdMatch = newRunLabel.match(/\d+/);
	if (!runIdMatch) {
		throw new Error(`could not read a run id out of: ${newRunLabel}`);
	}
	const runId = runIdMatch[0];

	// Action: save & pause it — scoped to this run's own row (its button's
	// immediate container), never `.first()`/`.last()` on the shared
	// running-runs list.
	const newRunRow = page
		.getByRole("button", { name: newRunLabel, exact: true })
		.locator("xpath=..");
	const savePauseButton = newRunRow.getByRole("button", {
		name: "Save & Pause",
	});
	await expect(savePauseButton).toBeVisible();
	await savePauseButton.click();

	// The mutation landed — same pattern as "Delete run #N" button
	// disappearance elsewhere in this file.
	await expect(savePauseButton).toBeHidden();

	// Action: find this run in the dashboard's Saved section and delete it.
	await page.goto("/dashboard");
	const rowLabel = page.getByText(
		new RegExp(`Run #${runId} — 6 boids, 2 predators`),
	);
	await expect(rowLabel).toBeVisible();

	await page.getByRole("button", { name: `Delete run #${runId}` }).click();
	const confirmDialog = page.getByRole("alertdialog");
	await expect(confirmDialog).toBeVisible();
	await confirmDialog
		.getByRole("button", { name: "Delete", exact: true })
		.click();

	// Assertion: the row is gone from the Saved list — not just the dialog
	// closing.
	await expect(rowLabel).toBeHidden();
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
