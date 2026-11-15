"use client";

import { useEffect, useState } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
	type ParameterRanges,
	RANGED_PARAMETER_NAMES,
	type RangedParameterName,
} from "~/server/simulation/parameter-ranges";
import { api } from "~/trpc/react";

// S-04 (FR-002 full): one row per ranged parameter — the admin's only
// editable surface for this slice (no "manage other users" capability per
// PRD Open Question #3, still unresolved and out of scope here).
export function AdminSettingsForm() {
	const rangesQuery = api.simulation.getParameterRanges.useQuery();
	const updateMutation = api.simulation.updateParameterRanges.useMutation();

	const [ranges, setRanges] = useState<ParameterRanges | null>(null);
	const [maxObjectCount, setMaxObjectCount] = useState(500);
	const [maxConcurrentObjectCount, setMaxConcurrentObjectCount] = useState(150);

	useEffect(() => {
		if (rangesQuery.data) {
			setRanges(rangesQuery.data.parameterRanges);
			setMaxObjectCount(rangesQuery.data.maxObjectCount);
			setMaxConcurrentObjectCount(rangesQuery.data.maxConcurrentObjectCount);
		}
	}, [rangesQuery.data]);

	if (!ranges) {
		return <p className="text-foreground">Loading...</p>;
	}

	function updateRange(
		name: RangedParameterName,
		field: "min" | "max" | "default",
		value: number,
	) {
		setRanges((current) =>
			current
				? { ...current, [name]: { ...current[name], [field]: value } }
				: current,
		);
	}

	return (
		<form
			className="flex w-full max-w-md flex-col gap-3"
			onSubmit={(e) => {
				e.preventDefault();
				if (!ranges) {
					return;
				}
				updateMutation.mutate({
					parameterRanges: ranges,
					maxObjectCount,
					maxConcurrentObjectCount,
				});
			}}
		>
			{RANGED_PARAMETER_NAMES.map((name) => (
				<fieldset
					className="bg-input flex flex-col gap-1 rounded-2xl px-4 py-3"
					key={name}
				>
					<legend className="text-foreground font-semibold">{name}</legend>
					<div className="flex gap-2">
						<label
							className="flex flex-1 flex-col gap-1"
							htmlFor={`${name}-min`}
						>
							Min
							<Input
								className="text-foreground h-auto rounded-full border-0 bg-transparent px-3 py-1"
								id={`${name}-min`}
								onChange={(e) =>
									updateRange(name, "min", Number(e.target.value))
								}
								step="any"
								type="number"
								value={ranges[name].min}
							/>
						</label>
						<label
							className="flex flex-1 flex-col gap-1"
							htmlFor={`${name}-default`}
						>
							Default
							<Input
								className="text-foreground h-auto rounded-full border-0 bg-transparent px-3 py-1"
								id={`${name}-default`}
								onChange={(e) =>
									updateRange(name, "default", Number(e.target.value))
								}
								step="any"
								type="number"
								value={ranges[name].default}
							/>
						</label>
						<label
							className="flex flex-1 flex-col gap-1"
							htmlFor={`${name}-max`}
						>
							Max
							<Input
								className="text-foreground h-auto rounded-full border-0 bg-transparent px-3 py-1"
								id={`${name}-max`}
								onChange={(e) =>
									updateRange(name, "max", Number(e.target.value))
								}
								step="any"
								type="number"
								value={ranges[name].max}
							/>
						</label>
					</div>
				</fieldset>
			))}
			<label className="flex flex-col gap-1" htmlFor="max-object-count">
				Global max object count (FR-018)
				<Input
					className="bg-input text-foreground h-auto rounded-full border-0 px-4 py-2"
					id="max-object-count"
					min={1}
					onChange={(e) => setMaxObjectCount(Number(e.target.value))}
					type="number"
					value={maxObjectCount}
				/>
			</label>
			<label
				className="flex flex-col gap-1"
				htmlFor="max-concurrent-object-count"
			>
				Max combined object count across concurrent server runs (F-07)
				<Input
					className="bg-input text-foreground h-auto rounded-full border-0 px-4 py-2"
					id="max-concurrent-object-count"
					min={1}
					onChange={(e) => setMaxConcurrentObjectCount(Number(e.target.value))}
					type="number"
					value={maxConcurrentObjectCount}
				/>
			</label>
			<Button
				className="bg-input text-foreground hover:bg-foreground/35 h-auto rounded-full px-10 py-3 font-semibold"
				disabled={updateMutation.isPending}
				type="submit"
			>
				{updateMutation.isPending ? "Saving..." : "Save ranges"}
			</Button>
			{updateMutation.error ? (
				<p className="text-destructive">{updateMutation.error.message}</p>
			) : null}
			{updateMutation.isSuccess ? (
				<p className="text-foreground">Saved.</p>
			) : null}
		</form>
	);
}
