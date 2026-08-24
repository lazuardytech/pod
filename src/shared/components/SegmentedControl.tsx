"use client";
import type { ReactNode } from "react";
import LucideIcon from "@/shared/components/LucideIcon";
import { ToggleGroup, ToggleGroupItem } from "@/shared/components/ui/toggle-group";
import { cn } from "@/shared/utils/cn";

export type SegmentedOption = {
  value: string;
  label: ReactNode;
  icon?: string;
};

type SegmentedControlProps = {
  options?: SegmentedOption[];
  value?: string;
  onChange?: (value: string) => void;
  size?: string;
  iconSize?: number;
  className?: string;
  "aria-label"?: string;
};

export default function SegmentedControl({
  options = [],
  value,
  onChange,
  size = "md",
  iconSize = 14,
  className,
  "aria-label": ariaLabel,
}: SegmentedControlProps) {
  const uiSize = size === "sm" ? "sm" : size === "lg" ? "lg" : "default";

  return (
    <ToggleGroup
      value={value ? [value] : []}
      onValueChange={(next) => {
        const picked = next[0];
        if (picked) onChange?.(picked);
      }}
      variant="outline"
      size={uiSize}
      spacing={0}
      aria-label={ariaLabel}
      className={cn("inline-flex items-center overflow-x-auto", className)}
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          className={cn(
            "shrink-0 rounded-[8px] font-[510] text-text-muted",
            "data-pressed:bg-primary data-pressed:text-primary-fg data-pressed:hover:bg-primary",
            "aria-pressed:bg-primary aria-pressed:text-primary-fg aria-pressed:hover:bg-primary",
            "data-[state=on]:bg-primary data-[state=on]:text-primary-fg",
            size === "sm" && "h-7 px-3 text-[12px]",
            size === "md" && "h-9 px-4 text-sm",
            size === "lg" && "h-11 px-4 text-base",
          )}
        >
          {option.icon && <LucideIcon name={option.icon} size={iconSize} />}
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
