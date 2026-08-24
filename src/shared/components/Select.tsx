"use client";
import type { ChangeEvent, ReactNode, SelectHTMLAttributes } from "react";
import { useId } from "react";
import {
  Select as UiSelectRoot,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/shared/components/ui/select";
import { Label } from "@/shared/components/ui/label";
import { cn } from "@/shared/utils/cn";

function deriveName(label: unknown) {
  if (typeof label !== "string" || !label) return "";
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export type SelectOption = {
  value: string;
  label: ReactNode;
};

type SelectProps = {
  label?: ReactNode;
  options?: SelectOption[];
  value?: string;
  onChange?: SelectHTMLAttributes<HTMLSelectElement>["onChange"];
  placeholder?: ReactNode;
  error?: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  selectClassName?: string;
  id?: string;
  name?: string;
} & Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "value" | "onChange" | "disabled" | "required" | "id" | "name" | "className"
>;

function PodSelect({
  label,
  options = [],
  value,
  onChange,
  placeholder = "Select an option",
  error,
  hint,
  disabled = false,
  required = false,
  className,
  selectClassName,
  id,
  name,
}: SelectProps) {
  const reactId = useId();
  const selectId = id || `select-${reactId}`;
  const selectName = name || deriveName(label) || selectId;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <Label
          htmlFor={selectId}
          className="text-[12px] font-[510] text-storm-cloud tracking-[-0.1px]"
        >
          {label}
          {required && <span className="text-warning-red ml-1">*</span>}
        </Label>
      )}
      <UiSelectRoot
        value={value ?? ""}
        onValueChange={(next) => {
          onChange?.({
            target: { value: next, name: selectName },
          } as ChangeEvent<HTMLSelectElement>);
        }}
        disabled={disabled}
        name={selectName}
      >
        <SelectTrigger
          id={selectId}
          className={cn(
            "h-9 w-full text-[13px] bg-gunmetal border-charcoal-grey text-porcelain rounded-[6px]",
            error && "border-warning-red",
            selectClassName,
          )}
        >
          <span data-slot="select-value" className="flex flex-1 truncate text-left">
            {options.find((o) => o.value === (value ?? ""))?.label ?? placeholder}
          </span>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </UiSelectRoot>
      {error && <p className="text-[11px] text-warning-red">{error}</p>}
      {hint && !error && <p className="text-[11px] text-fog-grey">{hint}</p>}
    </div>
  );
}

export default PodSelect;
