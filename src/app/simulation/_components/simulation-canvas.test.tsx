// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub the tRPC react client this component calls unconditionally at the top
// of its body (`api.simulation.stop.useMutation()`), so mounting it in a
// plain DOM (no TRPCReactProvider / QueryClientProvider) doesn't throw.
let capturedStopOptions: {
	onError?: (error: { message: string }, variables: { runId: number }) => void;
} = {};

vi.mock("~/trpc/react", () => ({
	api: {
		simulation: {
			stop: {
				useMutation: (options: typeof capturedStopOptions = {}) => {
					capturedStopOptions = options;
					return {
						mutate: vi.fn(),
						isPending: false,
						data: undefined,
						error: undefined,
					};
				},
			},
		},
	},
}));

// Spy-wrapped real implementation — the existing double-step test needs
// genuine tick behavior, while the new try/catch test overrides one call
// with `.mockImplementationOnce` to force the loop's exception path.
vi.mock("~/server/simulation/single-run-lifecycle", async () => {
	const actual = await vi.importActual<
		typeof import("~/server/simulation/single-run-lifecycle")
	>("~/server/simulation/single-run-lifecycle");
	return {
		...actual,
		computeSingleRunTick: vi.fn(actual.computeSingleRunTick),
	};
});

import { computeSingleRunTick } from "~/server/simulation/single-run-lifecycle";
import { colorToCss, SimulationCanvas } from "./simulation-canvas";

const BASE_PROPS = {
	runId: 1,
	seed: 1,
	boidCount: 1,
	weights: { separation: 0, alignment: 0, cohesion: 0 },
	maxDurationSeconds: 100,
	predatorCount: 0,
	protectionThreshold: 0,
	foodStockInitial: 100,
	foodRegenRate: 0,
	flockCount: 2,
	crossbreedingEnabled: true,
	energyThreshold: 50,
	mutationChance: 0.1,
	mutationMagnitude: 0.2,
	xyArea: 200,
	zDepth: 200,
	onFinished: vi.fn(),
};

// Fake 2D context implementing exactly the drawing methods `drawScene`,
// `drawWorldBoundary`, and `drawMinimap` (S-24 Phase 3's own minimap/
// boundary-indicator pass, both enabled by default) call, all as no-ops,
// plus settable `fillStyle`/`strokeStyle`/`lineWidth` so assignment doesn't
// throw.
function createFakeContext() {
	return {
		clearRect: vi.fn(),
		fillRect: vi.fn(),
		strokeRect: vi.fn(),
		save: vi.fn(),
		translate: vi.fn(),
		rotate: vi.fn(),
		beginPath: vi.fn(),
		moveTo: vi.fn(),
		lineTo: vi.fn(),
		closePath: vi.fn(),
		fill: vi.fn(),
		restore: vi.fn(),
		fillStyle: "",
		strokeStyle: "",
		lineWidth: 1,
	};
}

describe("colorToCss", () => {
	it("converts a pure-red unit-interval color to its rgb() string", () => {
		expect(colorToCss({ r: 1, g: 0, b: 0 })).toBe("rgb(255, 0, 0)");
	});

	it("converts black to rgb(0, 0, 0)", () => {
		expect(colorToCss({ r: 0, g: 0, b: 0 })).toBe("rgb(0, 0, 0)");
	});

	// Documents the rounding rule: each channel is scaled to [0,255] and
	// rounded with Math.round, so 0.5 -> 127.5 -> 128 (round-half-up), not
	// truncated to 127.
	it("rounds a fractional channel with Math.round semantics", () => {
		expect(colorToCss({ r: 0.5, g: 0.5, b: 0.5 })).toBe("rgb(128, 128, 128)");
	});

	// Defensive clamp: genes.color should already be in [0,1] (inheritGenes
	// clamps at birth), but colorToCss clamps again rather than trusting the
	// caller, so an out-of-range value never produces an invalid CSS string.
	it("clamps out-of-range channels instead of producing invalid output", () => {
		expect(colorToCss({ r: 1.5, g: -0.5, b: 0 })).toBe("rgb(255, 0, 0)");
	});
});

describe("SimulationCanvas RAF scheduling shell", () => {
	let rafMock: ReturnType<typeof vi.fn>;
	let cafMock: ReturnType<typeof vi.fn>;
	let capturedCallback: ((timestamp: number) => void) | undefined;

	beforeEach(() => {
		capturedCallback = undefined;
		capturedStopOptions = {};

		// Record calls but never actually schedule a real callback — the test
		// advances ticks manually by invoking the captured callback itself.
		rafMock = vi.fn((callback: (timestamp: number) => void) => {
			capturedCallback = callback;
			return 1;
		});
		cafMock = vi.fn();
		vi.stubGlobal("requestAnimationFrame", rafMock);
		vi.stubGlobal("cancelAnimationFrame", cafMock);

		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
			// biome-ignore lint/suspicious/noExplicitAny: fake context implements only the subset of CanvasRenderingContext2D that drawScene actually calls.
			createFakeContext() as any,
		);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("schedules exactly one more frame per processed tick, not more (no double-step)", () => {
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		act(() => {
			root.render(<SimulationCanvas {...BASE_PROPS} />);
		});

		// Initial schedule-on-mount.
		expect(rafMock).toHaveBeenCalledTimes(1);
		expect(capturedCallback).toBeDefined();

		act(() => {
			capturedCallback?.(16);
		});

		// The one tick just processed schedules exactly one more frame: two
		// total, not three or more (which would indicate a double-step).
		expect(rafMock).toHaveBeenCalledTimes(2);

		act(() => {
			root.unmount();
		});
		container.remove();
	});

	it("logs the run id when the stop mutation fails", () => {
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		act(() => {
			root.render(<SimulationCanvas {...BASE_PROPS} />);
		});

		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		act(() => {
			capturedStopOptions.onError?.({ message: "boom" }, { runId: 1 });
		});

		expect(errorSpy).toHaveBeenCalledWith(
			"simulation.stop failed for run 1: boom",
			expect.objectContaining({ message: "boom" }),
		);

		act(() => {
			root.unmount();
		});
		container.remove();
	});

	it("stops the loop and shows a visible error when a tick throws", () => {
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		act(() => {
			root.render(<SimulationCanvas {...BASE_PROPS} />);
		});

		expect(rafMock).toHaveBeenCalledTimes(1);

		const tickErrorInstance = new Error("boids blew up");
		vi.mocked(computeSingleRunTick).mockImplementationOnce(() => {
			throw tickErrorInstance;
		});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		act(() => {
			capturedCallback?.(16);
		});

		// No further frame scheduled — the loop stopped, it didn't double-step
		// into a broken state.
		expect(rafMock).toHaveBeenCalledTimes(1);
		expect(cafMock).toHaveBeenCalled();
		expect(container.textContent).toContain("Simulation error: boids blew up");
		// Logged too — the DOM message alone leaves no trace if the tab closes
		// before anyone reads it.
		expect(errorSpy.mock.calls).toContainEqual([
			"simulation tick failed:",
			tickErrorInstance,
		]);

		act(() => {
			root.unmount();
		});
		container.remove();
	});
});
