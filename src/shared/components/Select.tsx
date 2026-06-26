"use client";
import React from "react";
import { useId } from "react";
import { cn } from "@/shared/utils/cn";
import LucideIcon from "@/shared/components/LucideIcon";

function deriveName(label: any) {
  if (typeof label !== "string" || !label) return "";
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export default function Select({
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
  ...props
}: {
  label?: any;
  options?: any[];
  value?: any;
  onChange?: any;
  placeholder?: any;
  error?: any;
  hint?: any;
  disabled?: boolean;
  required?: boolean;
  className?: any;
  selectClassName?: any;
  id?: any;
  name?: any;
  [key: string]: any;
}) {
  const reactId = useId();
  const selectId = id || `select-${reactId}`;
  const selectName = name || deriveName(label) || selectId;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <label htmlFor={selectId} className="text-[12px] font-[510] text-storm-cloud tracking-[-0.1px]">
          {label}
          {required && <span className="text-warning-red ml-1">*</span>}
        </label>
      )}
      <div className="relative">
        <select
          id={selectId}
          name={selectName}
          value={value}
          onChange={onChange}
          disabled={disabled}
          className={cn(
            "h-9 w-full px-3.5 pr-9 text-[13px] text-porcelain",
            "bg-gunmetal border border-charcoal-grey rounded-[6px] appearance-none",
            "focus:outline-none focus:border-porcelain/50 focus:ring-1 focus:ring-porcelain/25",
            "transition-colors duration-100 disabled:opacity-40 disabled:cursor-not-allowed",
            "text-[16px] sm:text-[13px]",
            error && "border-warning-red focus:border-warning-red focus:ring-warning-red/25",
            selectClassName,
          )}
          {...props}
        >
          <option value="" disabled className="bg-graphite text-storm-cloud">
            {placeholder}
          </option>
          {options.map((option: any) => (
            <option key={option.value} value={option.value} className="bg-graphite text-porcelain">
              {option.label}
            </option>
          ))}
        </select>
        <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-storm-cloud">
          <LucideIcon name="expand_more" className="text-[16px]" />
        </div>
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
