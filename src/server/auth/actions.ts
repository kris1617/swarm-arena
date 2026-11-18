"use server";

import { signOut } from "~/server/auth";

// Server Function invoked from Client Components (e.g. AppShell's sign-out
// form) — Next.js requires actions a Client Component invokes to live in a
// file with a top-level "use server" directive, not inline, see
// node_modules/next/dist/docs/01-app/02-guides/forms.md.
export async function signOutAction() {
	await signOut({ redirectTo: "/login?signedOut=1" });
}
