"use client";
import type { InputHTMLAttributes, ReactNode } from "react";
import { useId } from "react";
import LucideIcon from "@/shared/components/LucideIcon";
import { Input as UiInput } from "@/shared/components/ui/input";
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

type InputProps = {
  label?: ReactNode;
  type?: string;
  placeholder?: string;
  value?: string | number;
  onChange?: InputHTMLAttributes<HTMLInputElement>["onChange"];
  error?: ReactNode;
  hint?: ReactNode;
  icon?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  inputClassName?: string;
  id?: string;
  name?: string;
} & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  | "type"
  | "value"
  | "onChange"
  | "disabled"
  | "required"
  | "id"
  | "name"
  | "placeholder"
  | "className"
>;

export default function Input({
  label,
  type = "text",
  placeholder,
  value,
  onChange,
  error,
  hint,
  icon,
  disabled = false,
  required = false,
  className,
  inputClassName,
  id,
  name,
  ...props
}: InputProps) {
  const reactId = useId();
  const inputId = id || `input-${reactId}`;
  const inputName = name || deriveName(label) || inputId;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <Label
          htmlFor={inputId}
          className="text-[12px] font-[510] text-storm-cloud tracking-[-0.1px]"
        >
          {label}
          {required && <span className="text-warning-red ml-1">*</span>}
        </Label>
      )}
      <div className="relative">
        {icon && (
          <LucideIcon
            name={icon}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-storm-cloud pointer-events-none"
          />
        )}
        <UiInput
          id={inputId}
          name={inputName}
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          disabled={disabled}
          required={required}
          aria-invalid={Boolean(error)}
          className={cn(
            "h-9 text-[13px] bg-gunmetal border-charcoal-grey text-porcelain rounded-[6px]",
            icon && "pl-9",
            error && "border-warning-red",
            inputClassName,
          )}
          {...props}
        />
      </div>
      {error && <p className="text-[11px] text-warning-red">{error}</p>}
      {hint && !error && <p className="text-[11px] text-fog-grey">{hint}</p>}
    </div>
  );
}
