import { ElevationForm } from "~/app/admin/elevation/_components/elevation-form";
import { auth } from "~/server/auth";
import { isEffectivelyAdmin } from "~/server/auth/elevation";

// temporary-admin-elevation (FR-030): reachable by any logged-in user —
// self-elevation needs no prerequisite, by design, so this page is not
// gated on role the way /admin/settings is. Middleware already requires a
// session for every non-public route.
export default async function AdminElevationPage() {
	const session = await auth();
	const isCurrentlyAdmin = session?.user
		? isEffectivelyAdmin(session.user)
		: false;

	return (
		<main className="from-primary to-background text-foreground flex min-h-screen flex-col items-center gap-8 bg-gradient-to-b p-8">
			<h1 className="text-3xl font-bold">Admin Elevation</h1>
			<ElevationForm isCurrentlyAdmin={isCurrentlyAdmin} />
		</main>
	);
}
