import { cn } from "cn";

import { Input } from "~/components/ui/input";

type NumberFieldProps = {
	label: React.ReactNode;
	id: string;
	min?: number;
	max?: number;
	step?: string;
	value: number;
	onChange: (value: number) => void;
	className?: string;
};

export function NumberField({
	label,
	id,
	min,
	max,
	step,
	value,
	onChange,
	className,
}: NumberFieldProps) {
	return (
		<label className="flex flex-col gap-1" htmlFor={id}>
			{label}
			<Input
				className={cn(
					"bg-input text-foreground h-auto rounded-full border-0 px-4 py-2",
					className,
				)}
				id={id}
				max={max}
				min={min}
				onChange={(e) => onChange(Number(e.target.value))}
				step={step}
				type="number"
				value={value}
			/>
		</label>
	);
}
