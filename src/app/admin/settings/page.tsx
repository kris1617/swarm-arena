import { redirect } from "next/navigation";

import { AdminSettingsForm } from "~/app/admin/settings/_components/admin-settings-form";
import { auth } from "~/server/auth";

// S-04 (FR-002 full): the first UI gated on `role`, not just login.
// Middleware (`src/middleware.ts`) already requires a session for every
// non-public route; this page adds the role check middleware doesn't do.
export default async function AdminSettingsPage() {
	const session = await auth();
	if (session?.user?.role !== "admin") {
		redirect("/simulation");
	}

	return (
		<main className="from-primary to-background text-foreground flex min-h-screen flex-col items-center justify-center gap-8 bg-gradient-to-b p-8">
			<h1 className="text-3xl font-bold">Simulation Parameter Ranges</h1>
			<AdminSettingsForm />
		</main>
	);
}
