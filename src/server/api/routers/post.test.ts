import { describe, expect, it } from "vitest";

import { createCaller } from "~/server/api/root";
import { db } from "~/server/db";

describe("postRouter.hello", () => {
	it("echoes the input text back in a greeting", async () => {
		const caller = createCaller({ db, headers: new Headers(), session: null });

		const result = await caller.post.hello({ text: "world" });

		expect(result).toEqual({ greeting: "Hello world" });
	});
});
