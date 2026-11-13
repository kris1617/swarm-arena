// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invalidate = vi.fn();
let capturedCreateOptions: { onError?: (error: { message: string }) => void } =
	{};

vi.mock("~/trpc/react", () => ({
	api: {
		post: {
			getLatest: {
				useSuspenseQuery: () => [null],
			},
			create: {
				useMutation: (options: {
					onError?: (error: { message: string }) => void;
				}) => {
					capturedCreateOptions = options;
					return {
						mutate: vi.fn(),
						isPending: false,
					};
				},
			},
		},
		useUtils: () => ({ post: { invalidate } }),
	},
}));

import { LatestPost } from "./post";

describe("LatestPost", () => {
	beforeEach(() => {
		capturedCreateOptions = {};
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("logs when post.create fails", () => {
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		act(() => {
			root.render(<LatestPost />);
		});

		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		act(() => {
			capturedCreateOptions.onError?.({ message: "boom" });
		});

		expect(errorSpy).toHaveBeenCalledWith(
			"post.create failed: boom",
			expect.objectContaining({ message: "boom" }),
		);

		act(() => {
			root.unmount();
		});
		container.remove();
	});
});
