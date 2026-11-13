import { afterEach, describe, expect, it, vi } from "vitest";

import { onRequestError } from "./instrumentation";

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
