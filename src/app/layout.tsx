import "~/styles/globals.css";

import type { Metadata } from "next";
import { Geist } from "next/font/google";

import { AppShell } from "~/components/app-shell";
import { auth } from "~/server/auth";
import { TRPCReactProvider } from "~/trpc/react";

export const metadata: Metadata = {
	title: "Swarm Arena",
	description:
		"Configure boid swarm simulations, score the results, and compare variants side by side.",
	icons: [{ rel: "icon", url: "/favicon.ico" }],
};

const geist = Geist({
	subsets: ["latin"],
	variable: "--font-geist-sans",
});

export default async function RootLayout({
	children,
}: Readonly<{ children: React.ReactNode }>) {
	const session = await auth();

	return (
		<html className={`${geist.variable}`} lang="en">
			<body>
				<TRPCReactProvider>
					{session?.user ? (
						<AppShell
							user={{
								name: session.user.name ?? null,
								email: session.user.email ?? null,
								image: session.user.image ?? null,
							}}
						>
							{children}
						</AppShell>
					) : (
						children
					)}
				</TRPCReactProvider>
			</body>
		</html>
	);
}
