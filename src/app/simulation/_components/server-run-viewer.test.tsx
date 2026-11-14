// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub the tRPC react client this component calls unconditionally
// (`api.simulation.watch.useSubscription()`), capturing the options object
// so the test can invoke `onData`/`onError` directly — same pattern
// `simulation-canvas.test.tsx` uses for `api.simulation.stop.useMutation`.
type CapturedWatchOptions = {
	onData?: (envelope: {
		id: string;
		data: { boids: unknown[]; predators: unknown[] };
	}) => void;
	onError?: (error: { message: string }) => void;
};
let capturedWatchOptions: CapturedWatchOptions = {};

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
		},
	},
}));

// Partial mock: keep the real exports, spy-wrap only `drawScene` so the
// test can assert it was called with the pushed snapshot's data without
// needing a real canvas 2d context (happy-dom's canvas support is limited).
vi.mock("./simulation-canvas", async () => {
	const actual = await vi.importActual<typeof import("./simulation-canvas")>(
		"./simulation-canvas",
	);
	return {
		...actual,
		drawScene: vi.fn(),
	};
});

import { ServerRunViewer } from "./server-run-viewer";
import { drawScene } from "./simulation-canvas";

describe("ServerRunViewer", () => {
	let container: HTMLDivElement;
	let root: ReturnType<typeof createRoot>;

	beforeEach(() => {
		capturedWatchOptions = {};
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
			root.render(<ServerRunViewer onClose={vi.fn()} runId={42} />);
		});

		const fixtureBoids = [{ x: 1 }];
		const fixturePredators = [{ x: 2 }];
		act(() => {
			capturedWatchOptions.onData?.({
				id: "0",
				data: { boids: fixtureBoids, predators: fixturePredators },
			});
		});

		expect(drawScene).toHaveBeenCalledTimes(1);
		const call = vi.mocked(drawScene).mock.calls.at(0);
		expect(call?.[1]).toBe(fixtureBoids);
		expect(call?.[2]).toBe(fixturePredators);
	});

	it("renders the error message when onError fires", () => {
		act(() => {
			root.render(<ServerRunViewer onClose={vi.fn()} runId={42} />);
		});

		act(() => {
			capturedWatchOptions.onError?.({ message: "boom" });
		});

		expect(container.textContent).toContain("boom");
	});

	it("clears a stale error once new data arrives (impl-review F1)", () => {
		act(() => {
			root.render(<ServerRunViewer onClose={vi.fn()} runId={42} />);
		});

		act(() => {
			capturedWatchOptions.onError?.({ message: "boom" });
		});
		expect(container.textContent).toContain("boom");

		act(() => {
			capturedWatchOptions.onData?.({
				id: "0",
				data: { boids: [], predators: [] },
			});
		});

		expect(container.textContent).not.toContain("boom");
	});

	it("calls onClose exactly once when Stop viewing is clicked", () => {
		const onClose = vi.fn();
		act(() => {
			root.render(<ServerRunViewer onClose={onClose} runId={42} />);
		});

		const button = container.querySelector("button");
		expect(button).not.toBeNull();
		act(() => {
			button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});

		expect(onClose).toHaveBeenCalledTimes(1);
	});
});
