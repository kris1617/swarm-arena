import { TRPCError } from "@trpc/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { logTRPCError } from "./trpc";

describe("logTRPCError", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("logs the error, path, and user id when ctx has an authenticated session", () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const error = new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

		logTRPCError({
			path: "simulation.stop",
			error,
			ctx: { session: { user: { id: "user-123" } } },
		});

		expect(errorSpy).toHaveBeenCalledTimes(1);
		expect(errorSpy).toHaveBeenCalledWith(
			"[tRPC]",
			{ path: "simulation.stop", userId: "user-123" },
			error,
		);
	});

	it("logs the error and path without throwing when ctx is undefined", () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const error = new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

		expect(() =>
			logTRPCError({ path: "post.create", error, ctx: undefined }),
		).not.toThrow();

		expect(errorSpy).toHaveBeenCalledWith(
			"[tRPC]",
			{ path: "post.create", userId: undefined },
			error,
		);
	});

	it("logs without a user id when ctx.session is null", () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const error = new TRPCError({ code: "UNAUTHORIZED" });

		expect(() =>
			logTRPCError({
				path: "simulation.start",
				error,
				ctx: { session: null },
			}),
		).not.toThrow();

		expect(errorSpy).toHaveBeenCalledWith(
			"[tRPC]",
			{ path: "simulation.start", userId: undefined },
			error,
		);
	});
});
