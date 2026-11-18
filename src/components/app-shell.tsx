"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FeedbackSheet } from "~/components/feedback-sheet";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader,
	SidebarInset,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarProvider,
} from "~/components/ui/sidebar";
import { UserMenu } from "~/components/user-menu";

type NavItem = {
	label: string;
	href: string;
};

const NAV_ITEMS: NavItem[] = [
	{ label: "Dashboard", href: "/dashboard" },
	{ label: "Simulation", href: "/simulation" },
	{ label: "Leaderboard", href: "/leaderboard" },
	{ label: "Reference", href: "/reference" },
];

export function AppShell({
	children,
	user,
}: {
	children: React.ReactNode;
	user: { name: string | null; email: string | null; image: string | null };
}) {
	const pathname = usePathname();

	return (
		<SidebarProvider>
			<Sidebar>
				<SidebarHeader>
					<span className="px-2 py-1 text-sm font-semibold">Swarm Arena</span>
				</SidebarHeader>
				<SidebarContent>
					<SidebarMenu>
						{NAV_ITEMS.map((item) => (
							<SidebarMenuItem key={item.href}>
								<SidebarMenuButton asChild isActive={pathname === item.href}>
									<Link href={item.href}>{item.label}</Link>
								</SidebarMenuButton>
							</SidebarMenuItem>
						))}
					</SidebarMenu>
				</SidebarContent>
				<SidebarFooter>
					<FeedbackSheet />
					<UserMenu user={user} />
				</SidebarFooter>
			</Sidebar>
			<SidebarInset>{children}</SidebarInset>
		</SidebarProvider>
	);
}
