// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub the tRPC react client this component calls unconditionally at the top
// of its body (`api.simulation.stop.useMutation()`), so mounting it in a
// plain DOM (no TRPCReactProvider / QueryClientProvider) doesn't throw.
vi.mock("~/trpc/react", () => ({
	api: {
		simulation: {
			stop: {
				useMutation: () => ({
					mutate: vi.fn(),
					isPending: false,
					data: undefined,
					error: undefined,
				}),
			},
		},
	},
}));

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
});
