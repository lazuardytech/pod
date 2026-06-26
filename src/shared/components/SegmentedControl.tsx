"use client";
import React from "react";
import { cn } from "@/shared/utils/cn";
import LucideIcon from "@/shared/components/LucideIcon";

export default function SegmentedControl({
  options = [],
  value,
  onChange,
  size = "md",
  iconSize = 14,
  className,
  ...rest
}: {
  options?: any[];
  value?: any;
  onChange?: any;
  size?: string;
  iconSize?: number;
  className?: any;
  [key: string]: any;
}) {
  const sizes = {
    sm: "h-7 text-[12px]",
    md: "h-9 text-sm",
    lg: "h-11 text-base",
  };

  return (
    <div
      className={cn(
        "inline-flex items-center p-1 rounded-[10px] overflow-x-auto bg-surface-2 border border-charcoal-grey",
        className,
      )}
      {...rest}
    >
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "shrink-0 px-4 rounded-[8px] font-[510] transition-all flex items-center gap-1.5",
            sizes[size],
            value === option.value ? "bg-surface text-text-main shadow-sm" : "text-text-muted hover:text-text-main",
          )}
        >
          {option.icon && <LucideIcon name={option.icon} size={iconSize} />}
          {option.label}
        </button>
      ))}
    </div>
  );
}
