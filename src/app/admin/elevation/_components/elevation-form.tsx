"use client";

import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { NumberField } from "~/components/ui/number-field";
import { api } from "~/trpc/react";

const DEFAULT_DURATION_MINUTES = 60;

export function ElevationForm({
	isCurrentlyAdmin,
}: {
	isCurrentlyAdmin: boolean;
}) {
	const utils = api.useUtils();

	const [selfDuration, setSelfDuration] = useState(DEFAULT_DURATION_MINUTES);
	const elevateSelfMutation = api.user.elevateSelf.useMutation({
		onSuccess: () => utils.invalidate(),
	});
	const revertSelfMutation = api.user.revertSelf.useMutation({
		onSuccess: () => utils.invalidate(),
	});

	const [targetEmail, setTargetEmail] = useState("");
	const [targetDuration, setTargetDuration] = useState(
		DEFAULT_DURATION_MINUTES,
	);
	const elevateAccountMutation = api.user.elevateAccount.useMutation({
		onSuccess: () => {
			setTargetEmail("");
			void elevatedAccountsQuery.refetch();
		},
	});
	const revertAccountMutation = api.user.revertAccount.useMutation({
		onSuccess: () => void elevatedAccountsQuery.refetch(),
	});

	const elevatedAccountsQuery = api.user.listElevatedAccounts.useQuery(
		undefined,
		{ enabled: isCurrentlyAdmin },
	);

	return (
		<div className="flex w-full max-w-md flex-col gap-6">
			<section className="bg-input text-foreground flex flex-col gap-3 rounded-2xl px-4 py-3">
				<h2 className="font-semibold">Your account</h2>
				<NumberField
					className="bg-background"
					id="self-duration"
					label="Duration (minutes)"
					max={1440}
					min={1}
					onChange={setSelfDuration}
					value={selfDuration}
				/>
				<Button
					className="bg-background text-foreground hover:bg-foreground/15 h-auto rounded-full px-6 py-2 font-semibold"
					disabled={elevateSelfMutation.isPending}
					onClick={() =>
						elevateSelfMutation.mutate({ durationMinutes: selfDuration })
					}
					type="button"
				>
					{elevateSelfMutation.isPending ? "Elevating..." : "Become admin"}
				</Button>
				{elevateSelfMutation.error ? (
					<p className="text-destructive">
						{elevateSelfMutation.error.message}
					</p>
				) : null}
				{isCurrentlyAdmin ? (
					<Button
						className="bg-background text-foreground hover:bg-foreground/15 h-auto rounded-full px-6 py-2 font-semibold"
						disabled={revertSelfMutation.isPending}
						onClick={() => revertSelfMutation.mutate()}
						type="button"
					>
						{revertSelfMutation.isPending
							? "Reverting..."
							: "Revert my elevation"}
					</Button>
				) : null}
			</section>

			{isCurrentlyAdmin ? (
				<section className="bg-input text-foreground flex flex-col gap-3 rounded-2xl px-4 py-3">
					<h2 className="font-semibold">Elevate another account</h2>
					<label className="flex flex-col gap-1" htmlFor="target-email">
						Email
						<Input
							className="bg-background text-foreground h-auto rounded-full border-0 px-4 py-2"
							id="target-email"
							onChange={(e) => setTargetEmail(e.target.value)}
							type="email"
							value={targetEmail}
						/>
					</label>
					<NumberField
						className="bg-background"
						id="target-duration"
						label="Duration (minutes)"
						max={1440}
						min={1}
						onChange={setTargetDuration}
						value={targetDuration}
					/>
					<Button
						className="bg-background text-foreground hover:bg-foreground/15 h-auto rounded-full px-6 py-2 font-semibold"
						disabled={elevateAccountMutation.isPending || !targetEmail}
						onClick={() =>
							elevateAccountMutation.mutate({
								email: targetEmail,
								durationMinutes: targetDuration,
							})
						}
						type="button"
					>
						{elevateAccountMutation.isPending
							? "Elevating..."
							: "Elevate account"}
					</Button>
					{elevateAccountMutation.error ? (
						<p className="text-destructive">
							{elevateAccountMutation.error.message}
						</p>
					) : null}

					<h3 className="font-semibold">Currently elevated</h3>
					{elevatedAccountsQuery.data &&
					elevatedAccountsQuery.data.length > 0 ? (
						<ul className="flex flex-col gap-2">
							{elevatedAccountsQuery.data.map((account) => (
								<li
									className="bg-background flex items-center justify-between gap-2 rounded-full px-4 py-2"
									key={account.id}
								>
									<span>{account.email}</span>
									<Button
										className="hover:bg-foreground/15 h-auto rounded-full px-4 py-1 font-semibold"
										disabled={revertAccountMutation.isPending}
										onClick={() =>
											revertAccountMutation.mutate({
												email: account.email ?? "",
											})
										}
										type="button"
									>
										Revoke
									</Button>
								</li>
							))}
						</ul>
					) : (
						<p>No other accounts currently elevated.</p>
					)}
				</section>
			) : null}
		</div>
	);
}
