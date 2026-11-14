"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
import { signOutAction } from "~/server/auth/actions";

type NavItem = {
	label: string;
	href: string;
};

// S-19/S-20 add their own entries here when those pages ship — see plan's
// "What We're NOT Doing".
const NAV_ITEMS: NavItem[] = [
	{ label: "Dashboard", href: "/dashboard" },
	{ label: "Simulation", href: "/simulation" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
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
					<form action={signOutAction}>
						<SidebarMenuButton type="submit">Sign out</SidebarMenuButton>
					</form>
				</SidebarFooter>
			</Sidebar>
			<SidebarInset>{children}</SidebarInset>
		</SidebarProvider>
	);
}
