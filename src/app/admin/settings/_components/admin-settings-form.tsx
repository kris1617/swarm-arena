"use client";

import { useEffect, useState } from "react";

import { Button } from "~/components/ui/button";
import { NumberField } from "~/components/ui/number-field";
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
						<NumberField
							className="bg-transparent px-3 py-1"
							id={`${name}-min`}
							label="Min"
							onChange={(value) => updateRange(name, "min", value)}
							step="any"
							value={ranges[name].min}
						/>
						<NumberField
							className="bg-transparent px-3 py-1"
							id={`${name}-default`}
							label="Default"
							onChange={(value) => updateRange(name, "default", value)}
							step="any"
							value={ranges[name].default}
						/>
						<NumberField
							className="bg-transparent px-3 py-1"
							id={`${name}-max`}
							label="Max"
							onChange={(value) => updateRange(name, "max", value)}
							step="any"
							value={ranges[name].max}
						/>
					</div>
				</fieldset>
			))}
			<NumberField
				id="max-object-count"
				label="Global max object count (FR-018)"
				min={1}
				onChange={setMaxObjectCount}
				value={maxObjectCount}
			/>
			<NumberField
				id="max-concurrent-object-count"
				label="Max combined object count across concurrent server runs (F-07)"
				min={1}
				onChange={setMaxConcurrentObjectCount}
				value={maxConcurrentObjectCount}
			/>
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
