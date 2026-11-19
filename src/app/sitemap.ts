import type { MetadataRoute } from "next";

// domain-migration-swarmarena-fun (phase 4): every route except /login is
// auth-gated (see src/middleware.ts's matcher), so /login is the only page
// worth advertising to crawlers — this list is intentionally minimal, not
// an oversight.
export default function sitemap(): MetadataRoute.Sitemap {
	return [
		{
			url: "https://swarmarena.fun/login",
		},
	];
}
