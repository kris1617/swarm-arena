"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Select } from "~/components/ui/select";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "~/components/ui/sheet";
import { SidebarMenuButton } from "~/components/ui/sidebar";
import { Textarea } from "~/components/ui/textarea";
import { api } from "~/trpc/react";

type SubmitResult = { status: "sent"; issueUrl: string } | { status: "queued" };

export function FeedbackSheet() {
	const pathname = usePathname();
	const [category, setCategory] = useState<"bug" | "idea">("bug");
	const [title, setTitle] = useState("");
	const [description, setDescription] = useState("");
	const [result, setResult] = useState<SubmitResult | null>(null);

	const createReport = api.feedback.create.useMutation({
		onSuccess: (data) => {
			setResult(data);
			setTitle("");
			setDescription("");
		},
	});

	return (
		<Sheet>
			<SheetTrigger asChild>
				<SidebarMenuButton>Report feedback</SidebarMenuButton>
			</SheetTrigger>
			<SheetContent>
				<SheetHeader>
					<SheetTitle>Report feedback</SheetTitle>
					<SheetDescription>
						Tell us about a bug or share an idea — it&apos;s filed directly as a
						GitHub issue.
					</SheetDescription>
				</SheetHeader>
				{result ? (
					<div className="flex flex-col gap-2 p-4">
						{result.status === "sent" ? (
							<p className="text-foreground">
								Thanks —{" "}
								<a
									className="text-primary underline-offset-4 hover:underline"
									href={result.issueUrl}
									rel="noreferrer"
									target="_blank"
								>
									view the issue
								</a>
								.
							</p>
						) : (
							<p className="text-foreground">Thanks — we&apos;ll follow up.</p>
						)}
						<Button onClick={() => setResult(null)} variant="outline">
							Submit another report
						</Button>
					</div>
				) : (
					<form
						className="flex flex-col gap-4 p-4"
						onSubmit={(e) => {
							e.preventDefault();
							createReport.mutate({
								category,
								title,
								description,
								pagePath: pathname,
								userAgent: navigator.userAgent,
							});
						}}
					>
						<label className="flex flex-col gap-1" htmlFor="feedback-category">
							Category
							<Select
								id="feedback-category"
								onChange={(e) => setCategory(e.target.value as "bug" | "idea")}
								value={category}
							>
								<option value="bug">Bug</option>
								<option value="idea">Idea</option>
							</Select>
						</label>
						<label className="flex flex-col gap-1" htmlFor="feedback-title">
							Title
							<Input
								id="feedback-title"
								onChange={(e) => setTitle(e.target.value)}
								required
								value={title}
							/>
						</label>
						<label
							className="flex flex-col gap-1"
							htmlFor="feedback-description"
						>
							Description
							<Textarea
								id="feedback-description"
								onChange={(e) => setDescription(e.target.value)}
								required
								value={description}
							/>
						</label>
						{createReport.error ? (
							<p className="text-destructive">{createReport.error.message}</p>
						) : null}
						<SheetFooter>
							<Button disabled={createReport.isPending} type="submit">
								{createReport.isPending ? "Submitting..." : "Submit"}
							</Button>
						</SheetFooter>
					</form>
				)}
			</SheetContent>
		</Sheet>
	);
}
