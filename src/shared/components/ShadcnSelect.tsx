"use client";
import PodSelect, { type SelectOption } from "./Select.tsx";

export type ShadcnSelectOption = {
  label: string;
  value: string;
};

type ShadcnSelectProps = {
  value?: string;
  onValueChange?: (value: string) => void;
  options?: ShadcnSelectOption[];
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  contentClassName?: string;
  itemClassName?: string;
  name?: string;
};

export default function ShadcnSelect({
  value,
  onValueChange,
  options = [],
  placeholder = "Select an option",
  ariaLabel,
  disabled = false,
  className,
  triggerClassName,
  name,
}: ShadcnSelectProps) {
  const mapped: SelectOption[] = options.map((o) => ({ value: o.value, label: o.label }));

  return (
    <PodSelect
      aria-label={ariaLabel}
      options={mapped}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      className={className}
      selectClassName={triggerClassName}
      name={name}
      onChange={
        onValueChange ? (e) => onValueChange((e.target as HTMLSelectElement).value) : undefined
      }
    />
  );
}
