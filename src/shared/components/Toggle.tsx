"use client";
import React from "react";
import { cn } from "@/shared/utils/cn";

export default function Toggle({
  checked = false,
  onChange,
  label,
  description,
  disabled = false,
  size = "md",
  className,
  ...rest
}: {
  checked?: boolean;
  onChange?: any;
  label?: any;
  description?: any;
  disabled?: boolean;
  size?: string;
  className?: any;
  [key: string]: any;
}) {
  const sizes: Record<string, any> = {
    sm: { track: "w-7 h-4", thumb: "size-3", translate: "translate-x-3" },
    md: { track: "w-9 h-5", thumb: "size-4", translate: "translate-x-4" },
    lg: { track: "w-11 h-6", thumb: "size-5", translate: "translate-x-5" },
  };

  const handleClick = () => {
    if (!disabled && onChange) onChange(!checked);
  };

  return (
    <div className={cn("flex items-center gap-2.5", disabled && "opacity-40 cursor-not-allowed", className)} {...rest}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={handleClick}
        className={cn(
          "relative inline-flex shrink-0 cursor-pointer rounded-full",
          "transition-colors duration-150 ease-in-out",
          "focus:outline-none focus-visible:ring-1 focus-visible:ring-porcelain/50",
          checked ? "bg-porcelain" : "bg-gunmetal border border-charcoal-grey",
          sizes[size].track,
          disabled && "cursor-not-allowed",
        )}
      >
        <span
          className={cn(
            "pointer-events-none inline-block rounded-full shadow-sm",
            "transform transition duration-150 ease-in-out",
            checked ? `${sizes[size].translate} bg-pitch-black` : "translate-x-0.5 bg-storm-cloud",
            sizes[size].thumb,
            "mt-0.5",
          )}
        />
      </button>
      {(label || description) && (
        <div className="flex flex-col">
          {label && <span className="text-[13px] font-[400] text-porcelain tracking-[-0.12px]">{label}</span>}
          {description && <span className="text-[11px] text-fog-grey">{description}</span>}
        </div>
      )}
    </div>
  );
}
