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
// client-staged-live-parameter-parity Phase 3: exposed so tests can inspect
// what buildStopInput() actually sent. Must stay the SAME vi.fn() instance
// across every useMutation() call for a test (the component re-renders —
// e.g. on each Apply click's state updates — well before Stop is clicked),
// or a later render would silently swap in a fresh, never-called mock out
// from under an assertion made after the click. Reset in each describe
// block's own beforeEach instead of being reassigned here.
let capturedStopMutate: ReturnType<typeof vi.fn> = vi.fn();

vi.mock("~/trpc/react", () => ({
	api: {
		simulation: {
			stop: {
				useMutation: (options: typeof capturedStopOptions = {}) => {
					capturedStopOptions = options;
					return {
						mutate: capturedStopMutate,
						isPending: false,
						data: undefined,
						error: undefined,
					};
				},
			},
			// client-staged-live-parameter-parity Phase 2: the live-edit panel's
			// NumberField bounds come from this query (same shape page.tsx's
			// staging form already consumes) — stubbed `undefined` so the
			// component falls back to DEFAULT_PARAMETER_RANGES, same as a real
			// not-yet-resolved query.
			getParameterRanges: {
				useQuery: () => ({ data: undefined }),
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

// per-tribe-behavior-weights Phase 2: one TribeConfig per flock (flockCount
// below is 2), replacing the old single shared `weights` prop — zero
// separation/alignment/cohesion matches the old BASE_PROPS.weights value
// exactly, so existing assertions keep their same steering behavior.
const BASE_TRIBE_CONFIG = {
	separation: 0,
	alignment: 0,
	cohesion: 0,
	maxSpeed: 40,
	minSpeed: 15,
	matePreference: 0.5,
	neighborRadius: 70,
	separationRadius: 25,
	predatorDetectionRadius: 50,
	burstMult: 1,
	burstCostMult: 1,
	foodStockShare: 50,
	foodRegenShare: 5,
	foodConsumptionRate: 0.5,
	// per-tribe-predator-config Phase 4: replaces the old run-level flag
	// removed in Phase 2 — see TribeConfig.crossbreedingEnabled in boids.ts.
	crossbreedingEnabled: true,
};

const BASE_PROPS = {
	runId: 1,
	seed: 1,
	boidCount: 1,
	tribeConfigs: [BASE_TRIBE_CONFIG, BASE_TRIBE_CONFIG],
	maxDurationSeconds: 100,
	predatorCount: 0,
	protectionThreshold: 0,
	foodStockInitial: 100,
	foodRegenRate: 0,
	flockCount: 2,
	// predator-tribe-concept Phase 2: predators' own independent tribe
	// space — a single default-valued tribe (predatorCount is 0 above, so
	// no fixture here exercises per-predator-tribe seeding behavior).
	predatorFlockCount: 1,
	predatorTribeConfigs: [
		{
			separation: 0,
			alignment: 0,
			cohesion: 0,
			maxSpeed: 40,
			minSpeed: 15,
			matePreference: 0.5,
			detectionRadius: 50,
			captureRadiusMult: 1,
			// per-tribe-predator-config Phase 4: see BASE_TRIBE_CONFIG's own
			// comment above for the semantics.
			crossbreedingEnabled: true,
		},
	],
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
		capturedStopMutate = vi.fn();

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

	// genetic-diversity-trend Phase 1: the client-staged path's own copy of
	// the sample array, sourced from computeSingleRunTick's real result and
	// sent in the stop payload — mirrors how the other 4 sample refs are
	// already exercised via the RAF-driven tick above.
	it("includes geneticDiversitySamples sourced from computeSingleRunTick in the stop payload", () => {
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		act(() => {
			root.render(<SimulationCanvas {...BASE_PROPS} />);
		});

		act(() => {
			capturedCallback?.(16);
		});

		const stopButton = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent === "Stop",
		);
		act(() => {
			stopButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});

		const lastResult = vi.mocked(computeSingleRunTick).mock.results.at(-1);
		if (lastResult?.type !== "return") {
			throw new Error("expected computeSingleRunTick's last call to return");
		}
		expect(lastResult.value.geneticDiversitySamples.length).toBeGreaterThan(0);
		expect(capturedStopMutate).toHaveBeenCalledWith(
			expect.objectContaining({
				geneticDiversitySamples: lastResult.value.geneticDiversitySamples,
			}),
		);

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

	// spatial-grid-dense-clustering-fallback Phase 3: 80 colocated boids
	// (same positions, lifespan 1000) guarantees stepBoids' own queryRadius
	// candidate set exceeds DENSE_CLUSTER_CANDIDATE_CAP (64), tripping
	// runTick's warn-sink every tick — proves the client-staged path's own
	// hasWarnedDenseClusteringRef flips exactly once and console.warn's call
	// count stays at 1 across many subsequent driven ticks.
	it("flips hasWarnedDenseClusteringRef exactly once and logs console.warn exactly once across many dense-clustering ticks", () => {
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);
		const warnSpy = vi
			.spyOn(console, "warn")
			.mockImplementation(() => undefined);

		act(() => {
			root.render(
				<SimulationCanvas
					{...BASE_PROPS}
					boidCount={80}
					xyArea={1}
					zDepth={1}
				/>,
			);
		});

		let timestamp = 16;
		for (let i = 0; i < 10; i++) {
			const callback = capturedCallback;
			act(() => {
				callback?.(timestamp);
			});
			timestamp += 16;
		}

		const lastResult = vi.mocked(computeSingleRunTick).mock.results.at(-1);
		if (lastResult?.type !== "return") {
			throw new Error("expected computeSingleRunTick's last call to return");
		}
		expect(lastResult.value.hasWarnedDenseClustering).toBe(true);
		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(warnSpy).toHaveBeenCalledWith(
			"dense clustering truncated a spatial-grid query this tick",
		);

		warnSpy.mockRestore();
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

// client-staged-live-parameter-parity Phase 2: the live-edit panel inside
// SimulationCanvas — covers the 5-field/2-heading shape, a staged-then-
// applied value reaching the ref the tick loop reads, and the soft
// out-of-range warning.
describe("SimulationCanvas live-edit panel", () => {
	let rafMock: ReturnType<typeof vi.fn>;
	let cafMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		capturedStopOptions = {};
		capturedStopMutate = vi.fn();
		rafMock = vi.fn(() => 1);
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

	function setNumberFieldValue(
		container: HTMLElement,
		field: string,
		value: string,
	) {
		const input = container.querySelector<HTMLInputElement>(
			`#live-param-${field}`,
		);
		if (!input) {
			throw new Error(`live-param-${field} input not found`);
		}
		const setter = Object.getOwnPropertyDescriptor(
			HTMLInputElement.prototype,
			"value",
		)?.set;
		setter?.call(input, value);
		input.dispatchEvent(new Event("input", { bubbles: true }));
		return input;
	}

	function clickApplyFor(container: HTMLElement, field: string) {
		const input = container.querySelector<HTMLInputElement>(
			`#live-param-${field}`,
		);
		const wrapper = input?.closest("label")?.parentElement;
		const button = wrapper?.querySelector("button");
		if (!button) {
			throw new Error(`Apply button for ${field} not found`);
		}
		button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	}

	it("renders exactly 5 live fields under the 2 expected headings", () => {
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		act(() => {
			root.render(<SimulationCanvas {...BASE_PROPS} />);
		});

		expect(container.textContent).toContain("Takes effect immediately");
		expect(container.textContent).toContain("Affects future offspring only");

		const liveFields = [
			"foodRegenRate",
			"protectionThreshold",
			"energyThreshold",
			"mutationChance",
			"mutationMagnitude",
		];
		for (const field of liveFields) {
			expect(container.querySelector(`#live-param-${field}`)).not.toBeNull();
		}
		expect(container.querySelectorAll("input[id^='live-param-']")).toHaveLength(
			5,
		);

		act(() => {
			root.unmount();
		});
		container.remove();
	});

	it("applying a staged value reaches the ref the tick loop reads", () => {
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		act(() => {
			root.render(<SimulationCanvas {...BASE_PROPS} />);
		});

		act(() => {
			setNumberFieldValue(container, "mutationMagnitude", "0");
		});
		act(() => {
			clickApplyFor(container, "mutationMagnitude");
		});

		// Drive one tick manually (rAF is mocked to never auto-fire) and
		// inspect the options computeSingleRunTick was actually called with —
		// the only way the applied value could reach it is via the ref,
		// since the mount effect's dependency array is `[runId]` only.
		const rafCallback = rafMock.mock.calls[0]?.[0] as
			| ((timestamp: number) => void)
			| undefined;
		act(() => {
			rafCallback?.(16);
		});

		const lastCall = vi.mocked(computeSingleRunTick).mock.calls.at(-1);
		expect(lastCall?.[2]?.mutationMagnitude).toBe(0);

		act(() => {
			root.unmount();
		});
		container.remove();
	});

	it("applying an out-of-range value shows checkLiveParamRangesSoft's warning format", () => {
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		act(() => {
			root.render(<SimulationCanvas {...BASE_PROPS} />);
		});

		act(() => {
			setNumberFieldValue(container, "mutationChance", "5");
		});
		act(() => {
			clickApplyFor(container, "mutationChance");
		});

		expect(container.textContent).toContain(
			"mutationChance (5) is outside the configured range 0-1",
		);

		act(() => {
			root.unmount();
		});
		container.remove();
	});

	// client-staged-live-parameter-parity Phase 3: buildStopInput()'s
	// parameterChanges field — exercised indirectly via the Stop button
	// (buildStopInput isn't exported; `stopRun.mutate(...)`'s captured call
	// args are the only observable surface).
	it("includes parameterChanges with entries matching applied edits when stopped", () => {
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		act(() => {
			root.render(<SimulationCanvas {...BASE_PROPS} />);
		});

		act(() => {
			setNumberFieldValue(container, "mutationMagnitude", "0");
		});
		act(() => {
			clickApplyFor(container, "mutationMagnitude");
		});

		const stopButton = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent === "Stop",
		);
		act(() => {
			stopButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});

		expect(capturedStopMutate).toHaveBeenCalledWith(
			expect.objectContaining({
				parameterChanges: [
					expect.objectContaining({
						field: "mutationMagnitude",
						oldValue: BASE_PROPS.mutationMagnitude,
						newValue: 0,
					}),
				],
			}),
		);

		act(() => {
			root.unmount();
		});
		container.remove();
	});

	// per-tribe-predator-config Phase 4: the 3 tests formerly here
	// (`renders a Switch for crossbreedingEnabled...`,
	// `toggling crossbreedingEnabled reaches computeSingleRunTick...`,
	// `records a 0/1-valued parameterChanges entry...`) tested a
	// client-staged crossbreedingEnabled Switch that Phase 2 already removed
	// from SimulationCanvas itself (the field moved into per-tribe config,
	// with no client-staged live-edit equivalent) — removed as dead-feature
	// tests, not carried forward, since nothing in this component renders
	// that Switch anymore.

	it("sends an empty parameterChanges array when no edits were made", () => {
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		act(() => {
			root.render(<SimulationCanvas {...BASE_PROPS} />);
		});

		const stopButton = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent === "Stop",
		);
		act(() => {
			stopButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});

		expect(capturedStopMutate).toHaveBeenCalledWith(
			expect.objectContaining({ parameterChanges: [] }),
		);

		act(() => {
			root.unmount();
		});
		container.remove();
	});
});
