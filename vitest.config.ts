import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		tsconfigPaths: true,
	},
	test: {
		environment: "node",
		env: {
			DATABASE_URL: "file:./db.sqlite",
			NODE_ENV: "test",
		},
	},
});
