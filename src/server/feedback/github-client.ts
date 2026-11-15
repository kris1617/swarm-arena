// in-app-feedback-module (roadmap S-26): the first outbound third-party HTTP
// call in this codebase. Pure, DOM-free, framework-free — no ~/server/db,
// tRPC, or React import — so it's directly testable with an injected fake
// `fetch`, following this codebase's established testable-core discipline
// (watchServerRun, computeSingleRunTick).

// Carries the HTTP status and raw response body text of a failed GitHub API
// call, so a caller (e.g. send-report.ts, a later phase) can store a useful
// `lastError` instead of a generic Error's message.
export class GithubApiError extends Error {
	status: number;
	body: string;

	constructor(status: number, body: string) {
		super(`GitHub API request failed with status ${status}`);
		this.name = "GithubApiError";
		this.status = status;
		this.body = body;
	}
}

export async function createGithubIssue(
	params: {
		token: string;
		owner: string;
		repo: string;
		title: string;
		body: string;
		labels: string[];
	},
	fetchImpl: typeof fetch = fetch,
): Promise<{ issueNumber: number; issueUrl: string }> {
	const response = await fetchImpl(
		`https://api.github.com/repos/${params.owner}/${params.repo}/issues`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${params.token}`,
				Accept: "application/vnd.github+json",
				"X-GitHub-Api-Version": "2022-11-28",
				"User-Agent": "swarm-arena-feedback-bot",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				title: params.title,
				body: params.body,
				labels: params.labels,
			}),
		},
	);

	if (!response.ok) {
		throw new GithubApiError(response.status, await response.text());
	}

	const json = (await response.json()) as { number: number; html_url: string };
	return { issueNumber: json.number, issueUrl: json.html_url };
}

export function mapCategoryToGithubLabel(
	category: "bug" | "idea",
): "bug" | "enhancement" {
	return category === "bug" ? "bug" : "enhancement";
}

export function formatIssueTitle(
	category: "bug" | "idea",
	title: string,
): string {
	return category === "bug" ? `[Bug] ${title}` : `[Idea] ${title}`;
}
