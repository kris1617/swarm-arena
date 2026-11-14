import { describe, expect, it } from "vitest";

import { isEffectivelyAdmin } from "~/server/auth/elevation";

describe("isEffectivelyAdmin", () => {
	it("returns false for a member regardless of elevatedUntil", () => {
		expect(isEffectivelyAdmin({ role: "member", elevatedUntil: null })).toBe(
			false,
		);
		expect(
			isEffectivelyAdmin({
				role: "member",
				elevatedUntil: new Date(Date.now() + 60_000),
			}),
		).toBe(false);
	});

	it("returns true for a permanent admin (elevatedUntil null)", () => {
		expect(isEffectivelyAdmin({ role: "admin", elevatedUntil: null })).toBe(
			true,
		);
	});

	it("returns true for a still-valid time-boxed grant", () => {
		expect(
			isEffectivelyAdmin({
				role: "admin",
				elevatedUntil: new Date(Date.now() + 60_000),
			}),
		).toBe(true);
	});

	it("returns false for a lapsed time-boxed grant", () => {
		expect(
			isEffectivelyAdmin({
				role: "admin",
				elevatedUntil: new Date(Date.now() - 60_000),
			}),
		).toBe(false);
	});
});
