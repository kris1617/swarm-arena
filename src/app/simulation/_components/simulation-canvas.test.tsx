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

	// live-crossbreeding-toggle Phase 3: the client-staged panel's own
	// crossbreedingEnabled Switch, mirroring server-run-viewer.tsx's Phase 2
	// Switch for the same field — covers the Switch's presence under the
	// right heading, that toggling it reaches computeSingleRunTick's real
	// boolean argument via the ref (same mechanism as the numeric fields'
	// Apply flow), and that it records a 0/1-valued parameterChanges entry.
	it("renders a Switch for crossbreedingEnabled under 'Affects future offspring only'", () => {
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		act(() => {
			root.render(<SimulationCanvas {...BASE_PROPS} />);
		});

		const futureHeading = Array.from(container.querySelectorAll("p")).find(
			(p) => p.textContent === "Affects future offspring only",
		);
		const section = futureHeading?.nextElementSibling;
		const toggle = section?.querySelector<HTMLElement>(
			"#live-param-crossbreedingEnabled",
		);
		expect(toggle).not.toBeNull();
		expect(toggle?.getAttribute("role")).toBe("switch");

		act(() => {
			root.unmount();
		});
		container.remove();
	});

	it("toggling crossbreedingEnabled reaches computeSingleRunTick as a real boolean", () => {
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		act(() => {
			root.render(<SimulationCanvas {...BASE_PROPS} />);
		});

		const toggle = container.querySelector<HTMLElement>(
			"#live-param-crossbreedingEnabled",
		);
		if (!toggle) {
			throw new Error("crossbreedingEnabled toggle not found");
		}
		act(() => {
			toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});

		const rafCallback = rafMock.mock.calls[0]?.[0] as
			| ((timestamp: number) => void)
			| undefined;
		act(() => {
			rafCallback?.(16);
		});

		const lastCall = vi.mocked(computeSingleRunTick).mock.calls.at(-1);
		expect(lastCall?.[2]?.crossbreedingEnabled).toBe(false);
		expect(typeof lastCall?.[2]?.crossbreedingEnabled).toBe("boolean");

		act(() => {
			root.unmount();
		});
		container.remove();
	});

	it("records a 0/1-valued parameterChanges entry when crossbreedingEnabled is toggled", () => {
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		act(() => {
			root.render(<SimulationCanvas {...BASE_PROPS} />);
		});

		const toggle = container.querySelector<HTMLElement>(
			"#live-param-crossbreedingEnabled",
		);
		if (!toggle) {
			throw new Error("crossbreedingEnabled toggle not found");
		}
		act(() => {
			toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
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
						field: "crossbreedingEnabled",
						oldValue: 1,
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
