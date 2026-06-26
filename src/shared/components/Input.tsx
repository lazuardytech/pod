"use client";
import React from "react";
import { useId } from "react";
import { cn } from "@/shared/utils/cn";
import LucideIcon from "@/shared/components/LucideIcon";

/**
 * Slugify a label for use as a form field name when no explicit `name` prop is provided.
 * Returns "" for falsy input so the caller can decide to omit the attribute entirely.
 */
function deriveName(label: any) {
  if (typeof label !== "string" || !label) return "";
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

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
}: {
  label?: any;
  type?: string;
  placeholder?: any;
  value?: any;
  onChange?: any;
  error?: any;
  hint?: any;
  icon?: any;
  disabled?: boolean;
  required?: boolean;
  className?: any;
  inputClassName?: any;
  id?: any;
  name?: any;
  [key: string]: any;
}) {
  // Stable, deterministic per-instance ID for label association and browser autofill.
  const reactId = useId();
  const inputId = id || `input-${reactId}`;
  const inputName = name || deriveName(label) || inputId;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <label htmlFor={inputId} className="text-[12px] font-[510] text-storm-cloud tracking-[-0.1px]">
          {label}
          {required && <span className="text-warning-red ml-1">*</span>}
        </label>
      )}
      <div className="relative">
        {icon && (
          <div className="absolute inset-y-0 left-0 flex items-center pl-3 pr-2 pointer-events-none text-storm-cloud">
            <LucideIcon name={icon} className="text-[16px]" />
          </div>
        )}
        <input
          id={inputId}
          name={inputName}
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          disabled={disabled}
          className={cn(
            "h-9 w-full px-3.5 text-[13px] text-porcelain bg-gunmetal",
            "rounded-[6px] border border-charcoal-grey",
            "placeholder:text-fog-grey",
            "focus:outline-none focus:border-porcelain/50 focus:ring-1 focus:ring-porcelain/25",
            "transition-colors duration-100",
            "disabled:opacity-40 disabled:cursor-not-allowed",
            "text-[16px] sm:text-[13px]",
            icon && "pl-9",
            error && "border-warning-red focus:border-warning-red focus:ring-warning-red/25",
            inputClassName,
          )}
          {...props}
        />
      </div>
      {error && (
        <p className="text-[11px] text-warning-red flex items-center gap-1">
          <LucideIcon name="error" className="text-[13px]" />
          {error}
        </p>
      )}
      {hint && !error && <p className="text-[11px] text-fog-grey">{hint}</p>}
    </div>
  );
}
