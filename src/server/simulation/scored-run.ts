// scored-run (domain-distillation D-01 / R-04 follow-up): a guardian
// aggregate so "read a score without checking comparability" is a type
// error instead of a convention four independent call sites had to
// remember by hand. See context/domain/02-invariant-aggregate-refactor.md
// for the full invariant analysis.

export type ScoredRunDisclosure = {
	score: number;
	comparable: boolean;
	disclaimer: string | null;
};

export class ScoredRun {
	private constructor(
		private readonly runId: number,
		private readonly score: number,
		private readonly wasEverThrottled: boolean,
		// per-tribe-food-config Phase 5: a second, independent reason a run's
		// score may not be directly comparable — extends the existing
		// pattern wasEverThrottled established, not a replacement for it.
		private readonly wasEverFoodImbalanced: boolean,
		// second-predator-tribe-prey-target Phase 3: a third, independent
		// reason — same pattern as wasEverFoodImbalanced above, not a
		// replacement for either existing reason.
		private readonly wasEverPredatorTribeImbalanced: boolean,
	) {}

	// The ONLY constructor. Returns null for an unscored row rather than
	// fabricating a score — matches this codebase's existing null-marker
	// convention (see getRunsComparison), but makes it the aggregate's job.
	static from(row: {
		id: number;
		score: number | null;
		wasEverThrottled: boolean;
		wasEverFoodImbalanced: boolean;
		wasEverPredatorTribeImbalanced: boolean;
	}): ScoredRun | null {
		if (row.score === null) {
			return null;
		}
		return new ScoredRun(
			row.id,
			row.score,
			row.wasEverThrottled,
			row.wasEverFoodImbalanced,
			row.wasEverPredatorTribeImbalanced,
		);
	}

	// The ONLY way to read a displayable score. There is no `.score`
	// getter that skips the comparability check.
	disclose(): ScoredRunDisclosure {
		const throttledReason = this.wasEverThrottled
			? `Run #${this.runId} ticked at an accelerated rate while unwatched — its score may not be directly comparable.`
			: null;
		const imbalancedReason = this.wasEverFoodImbalanced
			? `Run #${this.runId} showed uneven per-tribe food contribution — its score may not be directly comparable to a single-tribe or evenly-balanced run.`
			: null;
		const predatorTribeImbalancedReason = this.wasEverPredatorTribeImbalanced
			? `Run #${this.runId} showed an imbalanced predator-tribe population — its score may not be directly comparable to a single-predator-tribe or evenly-balanced run.`
			: null;
		return {
			score: this.score,
			comparable:
				!this.wasEverThrottled &&
				!this.wasEverFoodImbalanced &&
				!this.wasEverPredatorTribeImbalanced,
			disclaimer:
				[throttledReason, imbalancedReason, predatorTribeImbalancedReason]
					.filter((reason) => reason !== null)
					.join(" ") || null,
		};
	}
}
