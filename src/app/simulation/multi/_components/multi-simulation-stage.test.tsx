// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub the tRPC react client this component calls unconditionally at the top
// of its body (`api.simulation.stop.useMutation()`), so mounting it in a
// plain DOM (no TRPCReactProvider / QueryClientProvider) doesn't throw.
let capturedMutateOptions: {
	onSuccess?: (data: { score: number }) => void;
	onError?: (error: { message: string }) => void;
} = {};
const mutateMock = vi.fn(
	(_data: unknown, options: typeof capturedMutateOptions = {}) => {
		capturedMutateOptions = options;
	},
);

vi.mock("~/trpc/react", () => ({
	api: {
		simulation: {
			stop: {
				useMutation: () => ({
					mutate: mutateMock,
					isPending: false,
					data: undefined,
					error: undefined,
				}),
			},
		},
	},
}));

// Force a stop on the first tick by stubbing the pure decision core, so the
// test can reach `stopSlot`'s `onError` without driving a real multi-tick
// countdown through the RAF shell. A `vi.fn` (not a plain arrow) so the
// try/catch test can override one call with `.mockImplementationOnce`.
vi.mock("~/server/simulation/multi-run-lifecycle", async () => {
	const actual = await vi.importActual<
		typeof import("~/server/simulation/multi-run-lifecycle")
	>("~/server/simulation/multi-run-lifecycle");
	return {
		...actual,
		computeMultiRunTick: vi.fn(
			(
				_state: unknown,
				timestamp: number,
				slots: Array<{ runId: number }>,
			) => ({
				runStates: Object.fromEntries(
					slots.map((slot) => [
						slot.runId,
						{ boids: [], cohesionSamples: [0.5], elapsedSeconds: 1 },
					]),
				),
				lastTimestamp: timestamp,
				slotsToStop: slots,
				activeDrawBoids: null,
			}),
		),
	};
});

import { computeMultiRunTick } from "~/server/simulation/multi-run-lifecycle";
import { MultiSimulationStage } from "./multi-simulation-stage";

const BASE_PROPS = {
	slots: [],
	activeRunId: null,
	onFinished: vi.fn(),
};

// Fake 2D context implementing exactly the drawing methods the component's
// empty-draw fallback path calls, all as no-ops, plus a settable `fillStyle`
// so assignment doesn't throw.
function createFakeContext() {
	return {
		clearRect: vi.fn(),
		fillRect: vi.fn(),
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
	};
}

describe("MultiSimulationStage RAF scheduling shell", () => {
	let rafMock: ReturnType<typeof vi.fn>;
	let cafMock: ReturnType<typeof vi.fn>;
	let capturedCallback: ((timestamp: number) => void) | undefined;

	beforeEach(() => {
		capturedCallback = undefined;
		capturedMutateOptions = {};
		mutateMock.mockClear();

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
			// biome-ignore lint/suspicious/noExplicitAny: fake context implements only the subset of CanvasRenderingContext2D the component's draw paths actually call.
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
			root.render(<MultiSimulationStage {...BASE_PROPS} />);
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

	it("logs the error before force-finishing the slot when stop fails", () => {
		const slot = {
			runId: 7,
			seed: 1,
			boidCount: 1,
			weights: { separation: 0, alignment: 0, cohesion: 0 },
			maxDurationSeconds: 100,
			status: "running" as const,
			predatorCount: 0,
			protectionThreshold: 0,
			foodStockInitial: 100,
			foodRegenRate: 10,
			flockCount: 2,
			crossbreedingEnabled: true,
			energyThreshold: 50,
			mutationChance: 0.1,
			mutationMagnitude: 0.2,
		};
		const onFinished = vi.fn();

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		act(() => {
			root.render(
				<MultiSimulationStage
					activeRunId={slot.runId}
					onFinished={onFinished}
					slots={[slot]}
				/>,
			);
		});

		// The mocked computeMultiRunTick forces slot 7 into slotsToStop on the
		// very first tick, which schedules the first mutate() call.
		act(() => {
			capturedCallback?.(16);
		});
		expect(mutateMock).toHaveBeenCalledTimes(1);

		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		act(() => {
			capturedMutateOptions.onError?.({ message: "boom" });
		});

		expect(errorSpy).toHaveBeenCalledWith(
			"simulation.stop failed for run 7: boom",
			expect.objectContaining({ message: "boom" }),
		);
		// Still force-finishes the slot afterward (existing behavior, unchanged).
		expect(onFinished).toHaveBeenCalledWith(7, undefined);

		act(() => {
			root.unmount();
		});
		container.remove();
	});

	it("stops the loop and shows a visible error when a tick throws", () => {
		const slot = {
			runId: 9,
			seed: 1,
			boidCount: 1,
			weights: { separation: 0, alignment: 0, cohesion: 0 },
			maxDurationSeconds: 100,
			status: "running" as const,
			predatorCount: 0,
			protectionThreshold: 0,
			foodStockInitial: 100,
			foodRegenRate: 10,
			flockCount: 2,
			crossbreedingEnabled: true,
			energyThreshold: 50,
			mutationChance: 0.1,
			mutationMagnitude: 0.2,
		};

		const onFinished = vi.fn();

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		act(() => {
			root.render(
				<MultiSimulationStage
					activeRunId={slot.runId}
					onFinished={onFinished}
					slots={[slot]}
				/>,
			);
		});

		expect(rafMock).toHaveBeenCalledTimes(1);

		const tickErrorInstance = new Error("boids blew up");
		vi.mocked(computeMultiRunTick).mockImplementationOnce(() => {
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
		// Every running slot is force-finished (no score) so the page's
		// "Dismiss" button appears and the parallel-run cap clears — without
		// this, a tick throw at the cap is an unrecoverable dead end (no
		// Dismiss button, no form, nothing but a full page reload).
		expect(onFinished).toHaveBeenCalledWith(9, undefined);
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
