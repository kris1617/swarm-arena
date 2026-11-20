// Local-only vision review for the 7 critical/showcase screens (rollout
// Phase 12, test-plan.md Risk #11 — see
// context/changes/test-plan-refresh-2026-11-20/{research,plan}.md Phase 4).
//
// Intent: cover the "must challenge" line from Risk #11's response
// guidance — a judgment call a deterministic pixel diff can't make (e.g.
// overall color/hue coherence across many elements at once) — without
// making a non-deterministic model verdict a CI/deploy gate. This script
// is informational only: it never throws and never sets a non-zero exit
// code, even when every screen fails. By design, `ANTHROPIC_API_KEY` never
// reaches CI (see Phase 1/3's CI-secret decision) — this command is meant
// to be run locally, on demand, via `npm run visual:review`.
//
// ASSUMES A SERVER IS ALREADY RUNNING at the configured base URL. This
// script does not use Playwright's test runner or its `webServer`
// auto-start — it launches and manages its own short-lived browser
// instance. Start the app yourself first, e.g.:
//   npm run build && npm start
// or, for a faster local loop:
//   npm run dev
// then run `npm run visual:review` in another terminal.
//
// Fresh screenshots, not the committed baselines: the 7 PNGs already
// committed at tests/e2e/visual-regression.spec.ts-snapshots/*.png have
// their account-identity footer masked with a solid magenta block (see
// visual-regression.spec.ts's `mask: [page.locator('[data-slot="sidebar-
// footer"]')]`, added in the Phase 3 identity-leak fix). Reading those
// directly would send Claude a screenshot with a garish magenta rectangle
// in it, which would confuse the review. So this script takes its own
// fresh, unmasked screenshots instead, via a short-lived Playwright
// browser session signed in the same way tests/e2e/auth.setup.ts signs in
// (POST to the local-only test-auth bypass route), rather than reusing the
// saved storageState file.
//
// Package note: this repo's devDependencies list only `@playwright/test`,
// not a standalone `playwright` dependency. `@playwright/test` re-exports
// everything from the `playwright` package it depends on (confirmed via
// `require('@playwright/test').chromium` resolving to a real object), so
// `chromium` is imported from `@playwright/test` here rather than adding a
// second dependency.
import Anthropic from "@anthropic-ai/sdk";
import { chromium } from "@playwright/test";

// Matches playwright.config.ts's own PORT/baseURL derivation, so this
// script talks to the same local server an E2E run would.
const PORT = Number(process.env.E2E_PORT ?? 3000);
const BASE_URL = `http://localhost:${PORT}`;

// Same 7 screens as Phase 2's visual-regression.spec.ts, in the same order.
const SCREENS: Array<{ route: string; heading: string }> = [
	{ route: "/simulation", heading: "Flocking Simulation" },
	{ route: "/simulation/kitchen-sink", heading: "Kitchen Sink" },
	{ route: "/dashboard/kitchen-sink", heading: "Dashboard Kitchen Sink" },
	{ route: "/leaderboard/kitchen-sink", heading: "Leaderboard Kitchen Sink" },
	{ route: "/runs/kitchen-sink", heading: "Runs Analysis Kitchen Sink" },
	{ route: "/admin/kitchen-sink", heading: "Admin Kitchen Sink" },
	{ route: "/reference/kitchen-sink", heading: "Reference Kitchen Sink" },
];

// Vision-capable model string per this installed SDK version's exported
// `Model` type (@anthropic-ai/sdk 1.11.0, resources/messages/messages.d.ts).
// This string may need updating as new models ship — if `npm run
// visual:review` starts reporting API errors for every screen, check the
// SDK's current `Model` type export for its replacement.
const VISION_MODEL = "claude-sonnet-5-5";

const REVIEW_PROMPT =
	"You are reviewing a screenshot of a web app screen for visually " +
	"broken or inconsistent rendering: overlapping or clipped elements, " +
	"misaligned layout, inconsistent spacing, color/hue incoherence across " +
	"elements, unreadable contrast, or obviously broken components. Ignore " +
	"placeholder/sample data content. Reply with exactly two lines: the " +
	'first line is either "OK" or "ISSUE", and the second line is one ' +
	"sentence explaining your verdict.";

interface ScreenVerdict {
	route: string;
	status: "ok" | "issue" | "skipped";
	reasoning: string;
}

async function signIn(
	request: import("@playwright/test").APIRequestContext,
): Promise<void> {
	const email = process.env.E2E_USERNAME;
	const secret = process.env.E2E_TEST_AUTH_SECRET;
	if (!email || !secret) {
		throw new Error(
			"Set E2E_USERNAME and E2E_TEST_AUTH_SECRET (see context/foundation/test-stack.md, ## E2E)",
		);
	}
	const response = await request.post(`${BASE_URL}/api/test-auth/login`, {
		data: { email, secret },
	});
	if (!response.ok()) {
		throw new Error(
			`test-auth login failed (${response.status()}): ${await response.text()}`,
		);
	}
}

async function reviewScreenshot(
	client: Anthropic,
	route: string,
	pngBuffer: Buffer,
): Promise<ScreenVerdict> {
	try {
		const message = await client.messages.create({
			model: VISION_MODEL,
			max_tokens: 256,
			messages: [
				{
					role: "user",
					content: [
						{
							type: "image",
							source: {
								type: "base64",
								media_type: "image/png",
								data: pngBuffer.toString("base64"),
							},
						},
						{ type: "text", text: REVIEW_PROMPT },
					],
				},
			],
		});
		const textBlock = message.content.find((block) => block.type === "text");
		const raw = textBlock && "text" in textBlock ? textBlock.text.trim() : "";
		const [firstLine, ...rest] = raw.split("\n");
		const status: ScreenVerdict["status"] =
			firstLine?.trim().toUpperCase() === "ISSUE" ? "issue" : "ok";
		return {
			route,
			status,
			reasoning: rest.join(" ").trim() || raw || "(no reasoning returned)",
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.log(`vision review skipped for ${route}: ${message}`);
		return { route, status: "skipped", reasoning: message };
	}
}

async function main(): Promise<void> {
	const apiKey = process.env.ANTHROPIC_API_KEY;
	const client = apiKey ? new Anthropic({ apiKey }) : null;
	if (!client) {
		console.log(
			"ANTHROPIC_API_KEY is not set — every screen will be skipped. " +
				"See context/foundation/test-stack.md, ## E2E, for how to set it locally.",
		);
	}

	const browser = await chromium.launch();
	try {
		const context = await browser.newContext();
		await signIn(context.request);
		const page = await context.newPage();

		const verdicts: ScreenVerdict[] = [];
		for (const { route, heading } of SCREENS) {
			try {
				await page.goto(`${BASE_URL}${route}`);
				await page
					.getByRole("heading", { name: heading, level: 1 })
					.waitFor({ state: "visible", timeout: 15_000 });
				const pngBuffer = await page.screenshot({ fullPage: true });

				if (!client) {
					console.log(
						`vision review skipped for ${route}: ANTHROPIC_API_KEY is not set`,
					);
					verdicts.push({
						route,
						status: "skipped",
						reasoning: "ANTHROPIC_API_KEY is not set",
					});
					continue;
				}

				verdicts.push(await reviewScreenshot(client, route, pngBuffer));
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.log(`vision review skipped for ${route}: ${message}`);
				verdicts.push({ route, status: "skipped", reasoning: message });
			}
		}

		console.log("\nVision review verdicts:");
		for (const verdict of verdicts) {
			const label =
				verdict.status === "ok"
					? "OK"
					: verdict.status === "issue"
						? "ISSUE"
						: "SKIPPED";
			console.log(`  ${verdict.route}: ${label} — ${verdict.reasoning}`);
		}
	} finally {
		await browser.close();
	}
}

main().catch((error: unknown) => {
	// Informational, non-blocking tool per the Phase 1 decision: log and
	// exit 0 even on an unexpected top-level failure (e.g. no server
	// reachable at BASE_URL), rather than failing the process.
	const message = error instanceof Error ? error.message : String(error);
	console.log(`vision review could not run: ${message}`);
});
