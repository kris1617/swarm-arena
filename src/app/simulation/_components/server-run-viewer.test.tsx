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

type CapturedWatchOptions = {
	onData?: (envelope: {
		id: string;
		data: {
			boids: unknown[];
			predators: unknown[];
			liveParams: LiveParams;
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
});
