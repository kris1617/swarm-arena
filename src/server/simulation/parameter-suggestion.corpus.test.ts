// suggestion-quality-corpus-test Phase 2: asserts `suggestParameterChange`
// against the real 20-run parameter-sweep corpus (`loadCorpusFixture`),
// instead of the synthetic rows in `parameter-suggestion.test.ts`. Same
// pure function, real simulation data.
import { describe, expect, it } from "vitest";

import { loadCorpusFixture } from "~/server/simulation/corpus-fixture";
import {
	type SuggestionInputRow,
	suggestParameterChange,
} from "~/server/simulation/parameter-suggestion";

describe("suggestParameterChange against the real parameter-sweep corpus", () => {
	it("suggests increasing foodRegenRate with medium confidence across all 20 runs", () => {
		const rows: SuggestionInputRow[] = loadCorpusFixture().map((row) => ({
			...row.params,
			score: row.score,
		}));

		const result = suggestParameterChange(rows);

		expect(result.status).toBe("ok");
		if (result.status !== "ok") {
			throw new Error(
				`expected status "ok", got "${result.status}" — cannot assert suggestion fields`,
			);
		}

		expect(result.parameter).toBe("foodRegenRate");
		expect(result.direction).toBe("increase");
		expect(result.confidence).toBe("medium");
		expect(result.sampleSize).toBe(20);
		expect(result.rationale).toContain("Food regen rate");
	});
});
