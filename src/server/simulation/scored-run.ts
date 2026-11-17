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
	) {}

	// The ONLY constructor. Returns null for an unscored row rather than
	// fabricating a score — matches this codebase's existing null-marker
	// convention (see getRunsComparison), but makes it the aggregate's job.
	static from(row: {
		id: number;
		score: number | null;
		wasEverThrottled: boolean;
	}): ScoredRun | null {
		if (row.score === null) {
			return null;
		}
		return new ScoredRun(row.id, row.score, row.wasEverThrottled);
	}

	// The ONLY way to read a displayable score. There is no `.score`
	// getter that skips the comparability check.
	disclose(): ScoredRunDisclosure {
		return {
			score: this.score,
			comparable: !this.wasEverThrottled,
			disclaimer: this.wasEverThrottled
				? `Run #${this.runId} ticked at an accelerated rate while unwatched — its score may not be directly comparable.`
				: null,
		};
	}
}
