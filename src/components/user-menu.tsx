"use client";

import { useState } from "react";
import { SignOutButton } from "~/components/sign-out-button";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { SidebarMenuButton } from "~/components/ui/sidebar";
import { signOutAction } from "~/server/auth/actions";

function initialsFor(user: {
	name: string | null;
	email: string | null;
}): string {
	if (user.name) {
		const words = user.name.trim().split(/\s+/).filter(Boolean);
		if (words.length === 0) return "?";
		const first = words[0]?.[0] ?? "";
		const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "";
		const initials = `${first}${last}`.toUpperCase();
		return initials || "?";
	}
	if (user.email) {
		return user.email[0]?.toUpperCase() ?? "?";
	}
	return "?";
}

export function UserMenu({
	user,
}: {
	user: { name: string | null; email: string | null; image: string | null };
}) {
	const [confirmOpen, setConfirmOpen] = useState(false);
	const label = user.name ?? user.email ?? "Account";
	const initials = initialsFor(user);

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<SidebarMenuButton>
						<Avatar size="sm">
							<AvatarImage src={user.image ?? undefined} />
							<AvatarFallback>{initials}</AvatarFallback>
						</Avatar>
						<span className="truncate">{label}</span>
					</SidebarMenuButton>
				</DropdownMenuTrigger>
				<DropdownMenuContent>
					<DropdownMenuItem
						onSelect={(event) => {
							event.preventDefault();
							setConfirmOpen(true);
						}}
						variant="destructive"
					>
						Sign out
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			{/* Deliberately a sibling of DropdownMenu with its own controlled
			`open` state, not an AlertDialogTrigger nested inside the
			DropdownMenuItem above — Radix's DropdownMenu unmounts its content
			as soon as an item is selected, which would unmount a nested
			AlertDialog before it could render. Do not nest the trigger back in. */}
			<AlertDialog onOpenChange={setConfirmOpen} open={confirmOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Sign out?</AlertDialogTitle>
						<AlertDialogDescription>
							You'll be signed out of Swarm Arena and returned to the login
							page.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction asChild>
							<form action={signOutAction}>
								<SignOutButton />
							</form>
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
