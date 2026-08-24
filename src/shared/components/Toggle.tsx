"use client";
import type { HTMLAttributes, ReactNode } from "react";
import { Label } from "@/shared/components/ui/label";
import { Switch } from "@/shared/components/ui/switch";
import { cn } from "@/shared/utils/cn";

type ToggleProps = {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  size?: string;
  className?: string;
} & Omit<HTMLAttributes<HTMLDivElement>, "onChange" | "children">;

export default function Toggle({
  checked = false,
  onChange,
  label,
  description,
  disabled = false,
  size = "md",
  className,
  ...rest
}: ToggleProps) {
  const switchSize = size === "sm" ? "sm" : "default";

  return (
    <div
      className={cn(
        "flex items-center gap-2.5",
        disabled && "opacity-40 cursor-not-allowed",
        className,
      )}
      {...rest}
    >
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} size={switchSize} />
      {(label || description) && (
        <div className="flex flex-col">
          {label && (
            <Label className="text-[13px] font-[400] text-porcelain tracking-[-0.12px]">
              {label}
            </Label>
          )}
          {description && <span className="text-[11px] text-fog-grey">{description}</span>}
        </div>
      )}
    </div>
  );
}
