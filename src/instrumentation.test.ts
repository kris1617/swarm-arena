import { afterEach, describe, expect, it, vi } from "vitest";

// Mocked so this test never pulls in the real retry-worker module (which
// imports ~/server/db/~/env) — only that `register()` dynamically imports
// and calls `startFeedbackRetryWorker` is under test here.
vi.mock("~/server/feedback/retry-worker", () => ({
	startFeedbackRetryWorker: vi.fn(),
}));

// Mocked for the same reason as above — only that `register()` dynamically
// imports and calls `startOrphanSweep` is under test here.
vi.mock("~/server/simulation/orphan-sweep", () => ({
	startOrphanSweep: vi.fn(),
}));

import { startFeedbackRetryWorker } from "~/server/feedback/retry-worker";
import { startOrphanSweep } from "~/server/simulation/orphan-sweep";
import { onRequestError, register } from "./instrumentation";

const mockedStartFeedbackRetryWorker = vi.mocked(startFeedbackRetryWorker);
const mockedStartOrphanSweep = vi.mocked(startOrphanSweep);

describe("register", () => {
	afterEach(() => {
		mockedStartFeedbackRetryWorker.mockReset();
		mockedStartOrphanSweep.mockReset();
	});

	it("starts the feedback retry worker", async () => {
		await register();

		expect(mockedStartFeedbackRetryWorker).toHaveBeenCalledTimes(1);
	});

	it("starts the orphan reconciliation sweep", async () => {
		await register();

		expect(mockedStartOrphanSweep).toHaveBeenCalledTimes(1);
	});
});

describe("onRequestError", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("logs the error, request path, and route context", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const error = new Error("render failed");

		await onRequestError(
			error,
			{ path: "/simulation", method: "GET", headers: {} },
			{
				routerKind: "App Router",
				routePath: "/simulation",
				routeType: "render",
				renderSource: "react-server-components",
				revalidateReason: undefined,
			},
		);

		expect(errorSpy).toHaveBeenCalledWith("[instrumentation]", {
			path: "/simulation",
			routePath: "/simulation",
			routeType: "render",
			error,
		});
	});
});
