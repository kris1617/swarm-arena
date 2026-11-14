import { describe, expect, it } from "vitest";

import type { PopulationPhase } from "~/server/simulation/boids";
import { suggestRunOptimization } from "~/server/simulation/run-optimization-suggestion";

const BASELINE_PARAMS = {
	predatorCount: 5,
	foodStockInitial: 100,
	foodRegenRate: 10,
};

function phaseHistoryOf(
	phase: PopulationPhase,
	count: number,
): PopulationPhase[] {
	return Array.from({ length: count }, () => phase);
}

describe("suggestRunOptimization", () => {
	it("returns insufficient-data for fewer than 10 phaseHistory entries", () => {
		const result = suggestRunOptimization({
			phaseHistory: phaseHistoryOf("crash", 9),
			...BASELINE_PARAMS,
		});

		expect(result).toEqual({ status: "insufficient-data" });
	});

	it("diagnoses a crash-dominant run with a food/predator suggestion", () => {
		const result = suggestRunOptimization({
			phaseHistory: phaseHistoryOf("crash", 15),
			...BASELINE_PARAMS,
		});

		expect(result.status).toBe("ok");
		if (result.status === "ok") {
			expect(result.dominantPhase).toBe("crash");
			expect(result.rationale).toContain("Crash");
			expect(result.rationale).toContain("food stock");
		}
	});

	it("diagnoses an overshoot-dominant run with a food-regen/boid-count suggestion", () => {
		const result = suggestRunOptimization({
			phaseHistory: phaseHistoryOf("overshoot", 15),
			...BASELINE_PARAMS,
		});

		expect(result.status).toBe("ok");
		if (result.status === "ok") {
			expect(result.dominantPhase).toBe("overshoot");
			expect(result.rationale).toContain("Overshoot");
			expect(result.rationale).toContain("food regen rate");
		}
	});

	it("diagnoses an establishment-dominant run as never having gotten going", () => {
		const result = suggestRunOptimization({
			phaseHistory: phaseHistoryOf("establishment", 15),
			...BASELINE_PARAMS,
		});

		expect(result.status).toBe("ok");
		if (result.status === "ok") {
			expect(result.dominantPhase).toBe("establishment");
			expect(result.rationale).toContain("Establishment");
		}
	});

	it("diagnoses a growth-dominant run as healthy", () => {
		const result = suggestRunOptimization({
			phaseHistory: phaseHistoryOf("growth", 15),
			...BASELINE_PARAMS,
		});

		expect(result.status).toBe("ok");
		if (result.status === "ok") {
			expect(result.dominantPhase).toBe("growth");
			expect(result.rationale).toContain("thriving");
			expect(result.rationale).toContain("No parameter changes needed");
		}
	});

	it("diagnoses a recovery-dominant run as healthy", () => {
		const result = suggestRunOptimization({
			phaseHistory: phaseHistoryOf("recovery", 15),
			...BASELINE_PARAMS,
		});

		expect(result.status).toBe("ok");
		if (result.status === "ok") {
			expect(result.dominantPhase).toBe("recovery");
			expect(result.rationale).toContain("thriving");
		}
	});

	it("breaks a tie between crash and recovery toward the more severe phase", () => {
		const phaseHistory: PopulationPhase[] = [
			...phaseHistoryOf("crash", 5),
			...phaseHistoryOf("recovery", 5),
		];

		const result = suggestRunOptimization({
			phaseHistory,
			...BASELINE_PARAMS,
		});

		expect(result.status).toBe("ok");
		if (result.status === "ok") {
			expect(result.dominantPhase).toBe("crash");
		}
	});

	it("breaks a tie between overshoot and establishment toward the more severe phase", () => {
		const phaseHistory: PopulationPhase[] = [
			...phaseHistoryOf("establishment", 5),
			...phaseHistoryOf("overshoot", 5),
		];

		const result = suggestRunOptimization({
			phaseHistory,
			...BASELINE_PARAMS,
		});

		expect(result.status).toBe("ok");
		if (result.status === "ok") {
			expect(result.dominantPhase).toBe("overshoot");
		}
	});
});
