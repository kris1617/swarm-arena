// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub the tRPC react client this component calls unconditionally
// (`api.simulation.watch.useSubscription()`), capturing the options object
// so the test can invoke `onData`/`onError` directly — same pattern
// `simulation-canvas.test.tsx` uses for `api.simulation.stop.useMutation`.
type LiveParams = {
	foodRegenRate: number;
	protectionThreshold: number;
	energyThreshold: number;
	mutationChance: number;
	mutationMagnitude: number;
};

// per-tribe-behavior-weights Phase 6 (plan F4): a minimal stand-in for
// `TribeConfig` (boids.ts) — this file hand-duplicates its own fixture
// types rather than importing the real ones (see `LiveParams` above), so
// this mirrors that same convention rather than reaching into a
// server-only module from a component test.
type TribeConfigFixture = {
	separation: number;
	alignment: number;
	cohesion: number;
	maxSpeed: number;
	minSpeed: number;
	matePreference: number;
	neighborRadius: number;
	separationRadius: number;
	predatorDetectionRadius: number;
	burstMult: number;
	burstCostMult: number;
	foodStockShare: number;
	foodRegenShare: number;
	foodConsumptionRate: number;
	// per-tribe-predator-config Phase 5: now actually read by the component's
	// new per-tribe live-edit panel (previously type-only, per this type's
	// original comment above).
	crossbreedingEnabled: boolean;
};

// per-tribe-predator-config Phase 5: predator-side sibling fixture, same
// hand-duplicated-stand-in posture as `TribeConfigFixture` above.
type PredatorTribeConfigFixture = {
	separation: number;
	alignment: number;
	cohesion: number;
	maxSpeed: number;
	minSpeed: number;
	matePreference: number;
	detectionRadius: number;
	captureRadiusMult: number;
	crossbreedingEnabled: boolean;
};

const BOID_TRIBE_FIXTURE: TribeConfigFixture = {
	separation: 1,
	alignment: 1,
	cohesion: 1,
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
	crossbreedingEnabled: true,
};

const PREDATOR_TRIBE_FIXTURE: PredatorTribeConfigFixture = {
	separation: 1,
	alignment: 1,
	cohesion: 1,
	maxSpeed: 40,
	minSpeed: 15,
	matePreference: 0.5,
	detectionRadius: 50,
	captureRadiusMult: 1,
	crossbreedingEnabled: true,
};

type CapturedWatchOptions = {
	onData?: (envelope: {
		id: string;
		data: {
			boids: unknown[];
			predators: unknown[];
			liveParams: LiveParams;
			// per-tribe-behavior-weights Phase 6 (plan F4): sibling to
			// `liveParams` on the real `LiveRunSnapshot` (server-run-registry.ts),
			// not nested inside it — `tribeConfigs` has its own dedicated
			// live-edit path (`applyLiveTribeConfigs`), separate from
			// `LiveAdjustableParams`. per-tribe-predator-config Phase 5: now
			// actually read by the new per-tribe live-edit panel — still
			// optional so pre-Phase-5 test cases that never push it keep
			// type-checking.
			tribeConfigs?: TribeConfigFixture[];
			// per-tribe-predator-config Phase 5: predator-side sibling of
			// `tribeConfigs` above — see server-run-registry.ts's
			// `LiveRunSnapshot.predatorTribeConfigs` (this phase's own fix to
			// that type, per the gap note in this change's own task).
			predatorTribeConfigs?: PredatorTribeConfigFixture[];
		};
	}) => void;
	onError?: (error: { message: string }) => void;
};
let capturedWatchOptions: CapturedWatchOptions = {};

// live-parameter-adjustment (S-27) Phase 2: same capture-the-options-object
// pattern `simulation-canvas.test.tsx` uses for `api.simulation.stop
// .useMutation` — `mutate` records what it was called with so a test can
// assert on the sent patch, and `onSuccess`/`onError` are invoked explicitly
// by the test to simulate the mutation settling.
type UpdateRunParamsVariables = { runId: number } & Partial<LiveParams>;
type CapturedUpdateRunParamsOptions = {
	onSuccess?: (
		data: { ok: true; warnings: string[] },
		variables: UpdateRunParamsVariables,
	) => void;
	onError?: (error: { message: string }) => void;
};
let capturedUpdateRunParamsOptions: CapturedUpdateRunParamsOptions = {};
let updateRunParamsMutate: ReturnType<typeof vi.fn>;

// live-boid-count-adjustment Phase 3: same capture-the-options-object pattern
// as `updateRunParams` above, for the new `adjustLivePopulation` mutation.
type AdjustPopulationVariables = {
	runId: number;
	field: "boidCount" | "predatorCount";
	delta: number;
};
type CapturedAdjustPopulationOptions = {
	onSuccess?: (
		data: { ok: true; warnings: string[]; newCount: number },
		variables: AdjustPopulationVariables,
	) => void;
	onError?: (error: { message: string }) => void;
};
let capturedAdjustPopulationOptions: CapturedAdjustPopulationOptions = {};
let adjustPopulationMutate: ReturnType<typeof vi.fn>;

// per-tribe-predator-config Phase 5: same capture-the-options-object pattern
// as `updateRunParams`/`adjustLivePopulation` above, for the two new
// tribe-array live-edit mutations the new panel calls.
type UpdateTribeConfigsVariables = {
	runId: number;
	tribeConfigs: TribeConfigFixture[];
};
type CapturedUpdateTribeConfigsOptions = {
	onSuccess?: (
		data: { ok: true; warnings: string[] },
		variables: UpdateTribeConfigsVariables,
	) => void;
	onError?: (error: { message: string }) => void;
};
let capturedUpdateTribeConfigsOptions: CapturedUpdateTribeConfigsOptions = {};
let updateTribeConfigsMutate: ReturnType<typeof vi.fn>;

type UpdatePredatorTribeConfigsVariables = {
	runId: number;
	predatorTribeConfigs: PredatorTribeConfigFixture[];
};
type CapturedUpdatePredatorTribeConfigsOptions = {
	onSuccess?: (
		data: { ok: true; warnings: string[] },
		variables: UpdatePredatorTribeConfigsVariables,
	) => void;
	onError?: (error: { message: string }) => void;
};
let capturedUpdatePredatorTribeConfigsOptions: CapturedUpdatePredatorTribeConfigsOptions =
	{};
let updatePredatorTribeConfigsMutate: ReturnType<typeof vi.fn>;

vi.mock("~/trpc/react", () => ({
	api: {
		simulation: {
			watch: {
				useSubscription: (
					_input: { runId: number },
					options: CapturedWatchOptions = {},
				) => {
					capturedWatchOptions = options;
					return { status: "pending", data: undefined, error: null };
				},
			},
			updateRunParams: {
				useMutation: (options: CapturedUpdateRunParamsOptions = {}) => {
					capturedUpdateRunParamsOptions = options;
					updateRunParamsMutate = vi.fn();
					return {
						mutate: updateRunParamsMutate,
						isPending: false,
						data: undefined,
						error: undefined,
					};
				},
			},
			adjustLivePopulation: {
				useMutation: (options: CapturedAdjustPopulationOptions = {}) => {
					capturedAdjustPopulationOptions = options;
					adjustPopulationMutate = vi.fn();
					return {
						mutate: adjustPopulationMutate,
						isPending: false,
						data: undefined,
						error: undefined,
					};
				},
			},
			// per-tribe-predator-config Phase 5: this component now also calls
			// `getParameterRanges` (to build the per-tribe field defs' min/max,
			// mirroring page.tsx's own `ranges` query) — stub it returning no
			// data, so the component's own `?? DEFAULT_PARAMETER_RANGES`
			// fallback kicks in, same as page.tsx's loading-state behavior.
			getParameterRanges: {
				useQuery: () => ({ data: undefined }),
			},
			updateTribeConfigs: {
				useMutation: (options: CapturedUpdateTribeConfigsOptions = {}) => {
					capturedUpdateTribeConfigsOptions = options;
					updateTribeConfigsMutate = vi.fn();
					return {
						mutate: updateTribeConfigsMutate,
						isPending: false,
						data: undefined,
						error: undefined,
					};
				},
			},
			updatePredatorTribeConfigs: {
				useMutation: (
					options: CapturedUpdatePredatorTribeConfigsOptions = {},
				) => {
					capturedUpdatePredatorTribeConfigsOptions = options;
					updatePredatorTribeConfigsMutate = vi.fn();
					return {
						mutate: updatePredatorTribeConfigsMutate,
						isPending: false,
						data: undefined,
						error: undefined,
					};
				},
			},
		},
	},
}));

// Partial mock: keep the real exports, spy-wrap `drawScene` (so the test can
// assert it was called with the pushed snapshot's data) and the S-24 Phase 3
// `drawWorldBoundary`/`drawMinimap` passes (enabled by default, same as
// drawScene they'd otherwise touch the real canvas methods) without needing
// a real canvas 2d context (happy-dom's canvas support is limited).
vi.mock("./simulation-canvas", async () => {
	const actual = await vi.importActual<typeof import("./simulation-canvas")>(
		"./simulation-canvas",
	);
	return {
		...actual,
		drawScene: vi.fn(),
		drawWorldBoundary: vi.fn(),
		drawMinimap: vi.fn(),
	};
});

import { ServerRunViewer } from "./server-run-viewer";
import { drawScene } from "./simulation-canvas";

// Shared fixture for the 5 live-adjustable fields — individual tests
// override whichever field(s) they care about via object spread.
const LIVE_PARAMS_FIXTURE: LiveParams = {
	foodRegenRate: 10,
	protectionThreshold: 10,
	energyThreshold: 50,
	mutationChance: 0.1,
	mutationMagnitude: 0.2,
};

describe("ServerRunViewer", () => {
	let container: HTMLDivElement;
	let root: ReturnType<typeof createRoot>;

	beforeEach(() => {
		capturedWatchOptions = {};
		capturedUpdateRunParamsOptions = {};
		capturedAdjustPopulationOptions = {};
		capturedUpdateTribeConfigsOptions = {};
		capturedUpdatePredatorTribeConfigsOptions = {};
		vi.mocked(drawScene).mockClear();
		// happy-dom doesn't implement a real canvas 2d context; stub
		// getContext so the component's `if (ctx)` guard passes and
		// `drawScene` actually gets invoked.
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
			{} as unknown as CanvasRenderingContext2D,
		);
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
	});

	it("calls drawScene with the pushed snapshot's boids/predators on onData", () => {
		act(() => {
			root.render(
				<ServerRunViewer
					onClose={vi.fn()}
					runId={42}
					xyArea={200}
					zDepth={200}
				/>,
			);
		});

		const fixtureBoids = [{ x: 1 }];
		const fixturePredators = [{ x: 2 }];
		act(() => {
			capturedWatchOptions.onData?.({
				id: "0",
				data: {
					boids: fixtureBoids,
					predators: fixturePredators,
					liveParams: LIVE_PARAMS_FIXTURE,
				},
			});
		});

		expect(drawScene).toHaveBeenCalledTimes(1);
		const call = vi.mocked(drawScene).mock.calls.at(0);
		expect(call?.[1]).toBe(fixtureBoids);
		expect(call?.[2]).toBe(fixturePredators);
	});

	it("renders the error message when onError fires", () => {
		act(() => {
			root.render(
				<ServerRunViewer
					onClose={vi.fn()}
					runId={42}
					xyArea={200}
					zDepth={200}
				/>,
			);
		});

		act(() => {
			capturedWatchOptions.onError?.({ message: "boom" });
		});

		expect(container.textContent).toContain("boom");
	});

	it("clears a stale error once new data arrives (impl-review F1)", () => {
		act(() => {
			root.render(
				<ServerRunViewer
					onClose={vi.fn()}
					runId={42}
					xyArea={200}
					zDepth={200}
				/>,
			);
		});

		act(() => {
			capturedWatchOptions.onError?.({ message: "boom" });
		});
		expect(container.textContent).toContain("boom");

		act(() => {
			capturedWatchOptions.onData?.({
				id: "0",
				data: { boids: [], predators: [], liveParams: LIVE_PARAMS_FIXTURE },
			});
		});

		expect(container.textContent).not.toContain("boom");
	});

	it("calls onClose exactly once when Stop viewing is clicked", () => {
		const onClose = vi.fn();
		act(() => {
			root.render(
				<ServerRunViewer
					onClose={onClose}
					runId={42}
					xyArea={200}
					zDepth={200}
				/>,
			);
		});

		// S-24 Phase 2: the camera overlay's "Re-center" button now also
		// renders inside this component, so a plain `querySelector("button")`
		// (the first button in document order) would grab that one instead —
		// select by visible text to keep targeting "Stop viewing" specifically.
		const buttons = Array.from(container.querySelectorAll("button"));
		const button = buttons.find((b) => b.textContent === "Stop viewing");
		expect(button).not.toBeUndefined();
		act(() => {
			button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});

		expect(onClose).toHaveBeenCalledTimes(1);
	});

	describe("live-parameter-adjustment (S-27) Phase 2: live-edit panel", () => {
		function renderViewer() {
			act(() => {
				root.render(
					<ServerRunViewer
						onClose={vi.fn()}
						runId={42}
						xyArea={200}
						zDepth={200}
					/>,
				);
			});
		}

		function pushLiveParams(liveParams: LiveParams) {
			act(() => {
				capturedWatchOptions.onData?.({
					id: "0",
					data: { boids: [], predators: [], liveParams },
				});
			});
		}

		function getFieldInput(field: keyof LiveParams): HTMLInputElement {
			const input = container.querySelector(`#live-param-${field}`);
			expect(input).not.toBeNull();
			return input as HTMLInputElement;
		}

		function setFieldValue(field: keyof LiveParams, value: number) {
			const input = getFieldInput(field);
			act(() => {
				const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
					window.HTMLInputElement.prototype,
					"value",
				)?.set;
				nativeInputValueSetter?.call(input, String(value));
				input.dispatchEvent(new Event("input", { bubbles: true }));
			});
		}

		it("pre-fills the panel from the subscription's first pushed liveParams", () => {
			renderViewer();
			pushLiveParams(LIVE_PARAMS_FIXTURE);

			// per-tribe-predator-config Phase 4: crossbreedingEnabled no longer
			// lives in LIVE_FIELDS/LiveParams at all (moved to the per-tribe
			// array live-edit path) — every remaining field is a plain
			// NumberField <input>.
			for (const field of Object.keys(LIVE_PARAMS_FIXTURE) as Array<
				keyof LiveParams
			>) {
				expect(getFieldInput(field).value).toBe(
					String(LIVE_PARAMS_FIXTURE[field]),
				);
			}
		});

		it("clicking Apply after changing 2 of 5 fields sends only those 2 fields", () => {
			renderViewer();
			pushLiveParams(LIVE_PARAMS_FIXTURE);

			setFieldValue("energyThreshold", 75);
			setFieldValue("foodRegenRate", 25);

			const buttons = Array.from(container.querySelectorAll("button"));
			const applyButton = buttons.find((b) => b.textContent === "Apply");
			expect(applyButton).not.toBeUndefined();
			act(() => {
				applyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
			});

			expect(updateRunParamsMutate).toHaveBeenCalledTimes(1);
			expect(updateRunParamsMutate).toHaveBeenCalledWith({
				runId: 42,
				energyThreshold: 75,
				foodRegenRate: 25,
			});
		});

		it("disables the Apply button immediately after a successful apply (cooldown)", () => {
			renderViewer();
			pushLiveParams(LIVE_PARAMS_FIXTURE);

			setFieldValue("energyThreshold", 75);

			const findApplyButton = () =>
				Array.from(container.querySelectorAll("button")).find(
					(b) => b.textContent === "Apply" || b.textContent === "Applied",
				);

			act(() => {
				findApplyButton()?.dispatchEvent(
					new MouseEvent("click", { bubbles: true }),
				);
			});

			// Simulate the mutation settling successfully.
			act(() => {
				capturedUpdateRunParamsOptions.onSuccess?.(
					{ ok: true, warnings: [] },
					{ runId: 42, energyThreshold: 75 },
				);
			});

			const button = findApplyButton();
			expect(button?.textContent).toBe("Applied");
			expect(button?.hasAttribute("disabled")).toBe(true);
		});

		it("does not overwrite a field being actively edited when a new subscription push arrives", () => {
			renderViewer();
			pushLiveParams(LIVE_PARAMS_FIXTURE);

			// User starts editing energyThreshold, but hasn't applied yet.
			setFieldValue("energyThreshold", 77);

			// The ~150ms subscription push races in with a different value for
			// the same field (e.g. another client's edit, or the server's
			// unchanged current value) — the in-progress edit must survive it.
			pushLiveParams({ ...LIVE_PARAMS_FIXTURE, energyThreshold: 33 });

			expect(getFieldInput("energyThreshold").value).toBe("77");
			// A field the user hasn't touched still re-syncs from the push.
			expect(getFieldInput("mutationChance").value).toBe(
				String(LIVE_PARAMS_FIXTURE.mutationChance),
			);
		});

		it("renders both group headings for the live-parameter panel", () => {
			renderViewer();
			pushLiveParams(LIVE_PARAMS_FIXTURE);

			expect(container.textContent).toContain("Takes effect immediately");
			expect(container.textContent).toContain("Affects future offspring only");
		});
	});

	describe("live-boid-count-adjustment Phase 3: population step buttons", () => {
		function renderViewer() {
			act(() => {
				root.render(
					<ServerRunViewer
						onClose={vi.fn()}
						runId={42}
						xyArea={200}
						zDepth={200}
					/>,
				);
			});
		}

		function pushSnapshot(boids: unknown[], predators: unknown[]) {
			act(() => {
				capturedWatchOptions.onData?.({
					id: "0",
					data: { boids, predators, liveParams: LIVE_PARAMS_FIXTURE },
				});
			});
		}

		function findButton(label: string) {
			return Array.from(container.querySelectorAll("button")).find(
				(b) => b.textContent === label,
			);
		}

		it("renders a boid-count and predator-count control with the current count and two buttons, under 'Takes effect immediately'", () => {
			renderViewer();
			pushSnapshot([{ x: 1 }, { x: 2 }], [{ x: 3 }]);

			expect(container.textContent).toContain("Boid count: current 2");
			expect(container.textContent).toContain("Predator count: current 1");

			const immediateHeading = Array.from(container.querySelectorAll("p")).find(
				(p) => p.textContent === "Takes effect immediately",
			);
			expect(immediateHeading).not.toBeUndefined();
			const immediateSection = immediateHeading?.nextElementSibling;
			expect(immediateSection?.textContent).toContain("Boid count");
			expect(immediateSection?.textContent).toContain("Predator count");

			// Two buttons (-10/+10) per control, four total.
			expect(findButton("-10")).not.toBeUndefined();
			expect(findButton("+10")).not.toBeUndefined();
		});

		it("clicking a boid-count +10 button calls adjustLivePopulation.mutate with field 'boidCount' and delta 10", () => {
			renderViewer();
			pushSnapshot([{ x: 1 }], []);

			const plusButtons = Array.from(
				container.querySelectorAll("button"),
			).filter((b) => b.textContent === "+10");
			expect(plusButtons.length).toBeGreaterThan(0);
			act(() => {
				plusButtons[0]?.dispatchEvent(
					new MouseEvent("click", { bubbles: true }),
				);
			});

			expect(adjustPopulationMutate).toHaveBeenCalledTimes(1);
			expect(adjustPopulationMutate).toHaveBeenCalledWith({
				runId: 42,
				field: "boidCount",
				delta: 10,
			});
		});

		it("clicking a predator-count -10 button calls adjustLivePopulation.mutate with field 'predatorCount' and delta -10", () => {
			renderViewer();
			pushSnapshot([], [{ x: 1 }]);

			const minusButtons = Array.from(
				container.querySelectorAll("button"),
			).filter((b) => b.textContent === "-10");
			// Second control rendered is the predator-count row.
			expect(minusButtons.length).toBeGreaterThan(1);
			act(() => {
				minusButtons[1]?.dispatchEvent(
					new MouseEvent("click", { bubbles: true }),
				);
			});

			expect(adjustPopulationMutate).toHaveBeenCalledTimes(1);
			expect(adjustPopulationMutate).toHaveBeenCalledWith({
				runId: 42,
				field: "predatorCount",
				delta: -10,
			});
		});

		it("renders a warning returned from adjustLivePopulation in the panel's warning list", () => {
			renderViewer();
			pushSnapshot([{ x: 1 }], []);

			const plusButton = Array.from(container.querySelectorAll("button")).find(
				(b) => b.textContent === "+10",
			);
			act(() => {
				plusButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
			});

			act(() => {
				capturedAdjustPopulationOptions.onSuccess?.(
					{
						ok: true,
						warnings: ["boidCount + predatorCount would be 11, over the limit"],
						newCount: 11,
					},
					{ runId: 42, field: "boidCount", delta: 10 },
				);
			});

			expect(container.textContent).toContain(
				"boidCount + predatorCount would be 11, over the limit",
			);
		});
	});

	describe("per-tribe-predator-config Phase 5: per-tribe live-edit panel", () => {
		function renderViewer() {
			act(() => {
				root.render(
					<ServerRunViewer
						onClose={vi.fn()}
						runId={42}
						xyArea={200}
						zDepth={200}
					/>,
				);
			});
		}

		function pushTribeSnapshot(
			tribeConfigs: TribeConfigFixture[],
			predatorTribeConfigs: PredatorTribeConfigFixture[],
		) {
			act(() => {
				capturedWatchOptions.onData?.({
					id: "0",
					data: {
						boids: [],
						predators: [],
						liveParams: LIVE_PARAMS_FIXTURE,
						tribeConfigs,
						predatorTribeConfigs,
					},
				});
			});
		}

		function getTribeFieldInput(
			species: "boid" | "predator",
			index: number,
			field: string,
		): HTMLInputElement {
			const input = container.querySelector(
				`#tribe-live-${species}-${index}-${field}`,
			);
			expect(input).not.toBeNull();
			return input as HTMLInputElement;
		}

		function setTribeFieldValue(
			species: "boid" | "predator",
			index: number,
			field: string,
			value: number,
		) {
			const input = getTribeFieldInput(species, index, field);
			act(() => {
				const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
					window.HTMLInputElement.prototype,
					"value",
				)?.set;
				nativeInputValueSetter?.call(input, String(value));
				input.dispatchEvent(new Event("input", { bubbles: true }));
			});
		}

		it("renders one tribe card per boid/predator tribe in the pushed snapshot, pre-filled with their current values", () => {
			renderViewer();
			pushTribeSnapshot(
				[BOID_TRIBE_FIXTURE, { ...BOID_TRIBE_FIXTURE, maxSpeed: 99 }],
				[PREDATOR_TRIBE_FIXTURE],
			);

			expect(container.textContent).toContain("Boid tribe 1");
			expect(container.textContent).toContain("Boid tribe 2");
			expect(container.textContent).toContain("Predator tribe 1");
			expect(getTribeFieldInput("boid", 0, "maxSpeed").value).toBe(
				String(BOID_TRIBE_FIXTURE.maxSpeed),
			);
			expect(getTribeFieldInput("boid", 1, "maxSpeed").value).toBe("99");
			expect(getTribeFieldInput("predator", 0, "detectionRadius").value).toBe(
				String(PREDATOR_TRIBE_FIXTURE.detectionRadius),
			);

			const crossbreedingSwitch = container.querySelector(
				"#tribe-live-boid-0-crossbreedingEnabled",
			);
			expect(crossbreedingSwitch).not.toBeNull();
		});

		it("editing a field marks it dirty and survives a later subscription push for a different value", () => {
			renderViewer();
			pushTribeSnapshot([BOID_TRIBE_FIXTURE], [PREDATOR_TRIBE_FIXTURE]);

			setTribeFieldValue("boid", 0, "maxSpeed", 123);

			// A later push races in with a different value for the same field
			// (e.g. the run's own unchanged current value) — the in-progress
			// edit must survive it, same "dirty cell is never overwritten"
			// contract `syncLiveParams` already gives the scalar panel.
			pushTribeSnapshot(
				[{ ...BOID_TRIBE_FIXTURE, maxSpeed: 55 }],
				[PREDATOR_TRIBE_FIXTURE],
			);

			expect(getTribeFieldInput("boid", 0, "maxSpeed").value).toBe("123");
			// A field the user hasn't touched still re-syncs from the push.
			expect(getTribeFieldInput("boid", 0, "minSpeed").value).toBe(
				String(BOID_TRIBE_FIXTURE.minSpeed),
			);
		});

		it("clicking 'Apply boid tribes' sends the FULL current boid tribe array, not a partial patch", () => {
			renderViewer();
			const secondTribe = { ...BOID_TRIBE_FIXTURE, maxSpeed: 77 };
			pushTribeSnapshot(
				[BOID_TRIBE_FIXTURE, secondTribe],
				[PREDATOR_TRIBE_FIXTURE],
			);

			// Only tribe 0's maxSpeed is edited — tribe 1 is left untouched.
			setTribeFieldValue("boid", 0, "maxSpeed", 200);

			const applyButton = Array.from(container.querySelectorAll("button")).find(
				(b) => b.textContent === "Apply boid tribes",
			);
			expect(applyButton).not.toBeUndefined();
			act(() => {
				applyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
			});

			expect(updateTribeConfigsMutate).toHaveBeenCalledTimes(1);
			expect(updateTribeConfigsMutate).toHaveBeenCalledWith({
				runId: 42,
				tribeConfigs: [{ ...BOID_TRIBE_FIXTURE, maxSpeed: 200 }, secondTribe],
			});
		});

		it("clicking 'Apply predator tribes' sends the FULL current predator tribe array", () => {
			renderViewer();
			pushTribeSnapshot([BOID_TRIBE_FIXTURE], [PREDATOR_TRIBE_FIXTURE]);

			setTribeFieldValue("predator", 0, "detectionRadius", 80);

			const applyButton = Array.from(container.querySelectorAll("button")).find(
				(b) => b.textContent === "Apply predator tribes",
			);
			expect(applyButton).not.toBeUndefined();
			act(() => {
				applyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
			});

			expect(updatePredatorTribeConfigsMutate).toHaveBeenCalledTimes(1);
			expect(updatePredatorTribeConfigsMutate).toHaveBeenCalledWith({
				runId: 42,
				predatorTribeConfigs: [
					{ ...PREDATOR_TRIBE_FIXTURE, detectionRadius: 80 },
				],
			});
		});

		it("a successful Apply clears dirty state so the next push can overwrite the field again", () => {
			renderViewer();
			pushTribeSnapshot([BOID_TRIBE_FIXTURE], [PREDATOR_TRIBE_FIXTURE]);

			setTribeFieldValue("boid", 0, "maxSpeed", 200);

			const applyButton = Array.from(container.querySelectorAll("button")).find(
				(b) => b.textContent === "Apply boid tribes",
			);
			act(() => {
				applyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
			});

			act(() => {
				capturedUpdateTribeConfigsOptions.onSuccess?.(
					{ ok: true, warnings: [] },
					{
						runId: 42,
						tribeConfigs: [{ ...BOID_TRIBE_FIXTURE, maxSpeed: 200 }],
					},
				);
			});

			// No longer dirty — a later push can now move the field again.
			pushTribeSnapshot(
				[{ ...BOID_TRIBE_FIXTURE, maxSpeed: 61 }],
				[PREDATOR_TRIBE_FIXTURE],
			);
			expect(getTribeFieldInput("boid", 0, "maxSpeed").value).toBe("61");
		});

		it("a successful predator-tribe Apply clears dirty state for predator fields too", () => {
			renderViewer();
			pushTribeSnapshot([BOID_TRIBE_FIXTURE], [PREDATOR_TRIBE_FIXTURE]);

			setTribeFieldValue("predator", 0, "detectionRadius", 80);

			const applyButton = Array.from(container.querySelectorAll("button")).find(
				(b) => b.textContent === "Apply predator tribes",
			);
			act(() => {
				applyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
			});

			act(() => {
				capturedUpdatePredatorTribeConfigsOptions.onSuccess?.(
					{ ok: true, warnings: [] },
					{
						runId: 42,
						predatorTribeConfigs: [
							{ ...PREDATOR_TRIBE_FIXTURE, detectionRadius: 80 },
						],
					},
				);
			});

			pushTribeSnapshot(
				[BOID_TRIBE_FIXTURE],
				[{ ...PREDATOR_TRIBE_FIXTURE, detectionRadius: 33 }],
			);
			expect(getTribeFieldInput("predator", 0, "detectionRadius").value).toBe(
				"33",
			);
		});
	});
});
