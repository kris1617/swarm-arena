// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import ErrorBoundary from "./error";

describe("ErrorBoundary (app/error.tsx)", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("logs the caught error and offers a reset button that calls reset()", () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const reset = vi.fn();
		const error = new Error("boom");

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		act(() => {
			root.render(<ErrorBoundary error={error} reset={reset} />);
		});

		expect(errorSpy).toHaveBeenCalledWith(error);

		const button = container.querySelector("button");
		expect(button).not.toBeNull();

		act(() => {
			button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		expect(reset).toHaveBeenCalledTimes(1);

		act(() => {
			root.unmount();
		});
		container.remove();
	});
});
