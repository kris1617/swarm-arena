import { describe, expect, it } from "vitest";

import {
	addSlot,
	MAX_PARALLEL_RUNS,
	markStopped,
	type RunSlot,
	type RunSlotsState,
	removeSlot,
	setActive,
} from "~/server/simulation/run-slots";

const WEIGHTS = { separation: 1, alignment: 1, cohesion: 1 };

function makeSlotInput(runId: number): Omit<RunSlot, "status"> {
	return {
		runId,
		seed: runId,
		boidCount: 50,
		weights: WEIGHTS,
		maxDurationSeconds: 30,
	};
}

const EMPTY_STATE: RunSlotsState = { slots: [], activeRunId: null };

describe("addSlot", () => {
	it("rejects a 5th slot once 4 exist (state unchanged, cap holds)", () => {
		let state = EMPTY_STATE;
		for (let runId = 1; runId <= MAX_PARALLEL_RUNS; runId++) {
			state = addSlot(state, makeSlotInput(runId));
		}
		expect(state.slots).toHaveLength(MAX_PARALLEL_RUNS);

		const result = addSlot(state, makeSlotInput(999));

		expect(result).toBe(state);
		expect(result.slots).toHaveLength(MAX_PARALLEL_RUNS);
	});

	it("makes the newly added slot active", () => {
		const first = addSlot(EMPTY_STATE, makeSlotInput(1));
		expect(first.activeRunId).toBe(1);

		const second = addSlot(first, makeSlotInput(2));
		expect(second.activeRunId).toBe(2);
	});

	it("appends a new running slot with the given config", () => {
		const state = addSlot(EMPTY_STATE, makeSlotInput(1));

		expect(state.slots).toEqual([{ ...makeSlotInput(1), status: "running" }]);
	});
});

describe("setActive", () => {
	it("changes only activeRunId without altering any slot's other fields", () => {
		let state = addSlot(EMPTY_STATE, makeSlotInput(1));
		state = addSlot(state, makeSlotInput(2));
		const slotsBefore = state.slots;

		const result = setActive(state, 1);

		expect(result.activeRunId).toBe(1);
		expect(result.slots).toEqual(slotsBefore);
	});

	it("is a no-op if runId isn't present", () => {
		const state = addSlot(EMPTY_STATE, makeSlotInput(1));

		const result = setActive(state, 999);

		expect(result).toBe(state);
	});
});

describe("markStopped", () => {
	it("sets status and score on the matching slot", () => {
		const state = addSlot(EMPTY_STATE, makeSlotInput(1));

		const result = markStopped(state, 1, 12.5);

		expect(result.slots[0]?.status).toBe("stopped");
		expect(result.slots[0]?.score).toBe(12.5);
	});

	it("is a no-op on an already-stopped slot", () => {
		const state = markStopped(addSlot(EMPTY_STATE, makeSlotInput(1)), 1, 5);

		const result = markStopped(state, 1, 999);

		expect(result).toBe(state);
		expect(result.slots[0]?.score).toBe(5);
	});

	it("is a no-op if runId isn't present", () => {
		const state = addSlot(EMPTY_STATE, makeSlotInput(1));

		const result = markStopped(state, 999, 5);

		expect(result).toBe(state);
	});
});

describe("removeSlot", () => {
	it("is a no-op on a running slot", () => {
		const state = addSlot(EMPTY_STATE, makeSlotInput(1));

		const result = removeSlot(state, 1);

		expect(result).toBe(state);
		expect(result.slots).toHaveLength(1);
	});

	it("succeeds on a stopped slot", () => {
		const running = addSlot(EMPTY_STATE, makeSlotInput(1));
		const stopped = markStopped(running, 1, 5);

		const result = removeSlot(stopped, 1);

		expect(result.slots).toHaveLength(0);
	});

	it("reassigns activeRunId to a remaining slot when the active slot is removed", () => {
		let state = addSlot(EMPTY_STATE, makeSlotInput(1));
		state = addSlot(state, makeSlotInput(2));
		state = setActive(state, 1);
		state = markStopped(state, 1, 5);

		const result = removeSlot(state, 1);

		expect(result.activeRunId).toBe(2);
		expect(result.slots.map((slot) => slot.runId)).toEqual([2]);
	});

	it("sets activeRunId to null when the last (active) slot is removed", () => {
		let state = addSlot(EMPTY_STATE, makeSlotInput(1));
		state = markStopped(state, 1, 5);

		const result = removeSlot(state, 1);

		expect(result.activeRunId).toBeNull();
		expect(result.slots).toHaveLength(0);
	});

	it("leaves activeRunId untouched when a non-active stopped slot is removed", () => {
		let state = addSlot(EMPTY_STATE, makeSlotInput(1));
		state = addSlot(state, makeSlotInput(2));
		state = setActive(state, 2);
		state = markStopped(state, 1, 5);

		const result = removeSlot(state, 1);

		expect(result.activeRunId).toBe(2);
		expect(result.slots.map((slot) => slot.runId)).toEqual([2]);
	});
});
