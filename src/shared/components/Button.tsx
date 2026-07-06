"use client";
import LucideIcon from "@/shared/components/LucideIcon";
import { cn } from "@/shared/utils/cn";

const variants: Record<string, any> = {
  primary:
    "bg-porcelain hover:bg-white text-pitch-black font-[590] shadow-[var(--shadow-sm)] disabled:opacity-40 disabled:cursor-not-allowed btn-cta",
  secondary:
    "bg-gunmetal hover:bg-charcoal-grey text-porcelain border border-charcoal-grey hover:border-muted-ash disabled:opacity-40 disabled:cursor-not-allowed html:not(.dark):bg-[#e8e8e8] html:not(.dark):hover:bg-[#d4d4d4] html:not(.dark):text-[#111111] html:not(.dark):border-[#d4d4d4]",
  outline:
    "border border-charcoal-grey text-porcelain hover:bg-deep-slate hover:border-muted-ash disabled:opacity-40 disabled:cursor-not-allowed html:not(.dark):border-[#d4d4d4] html:not(.dark):text-[#111111] html:not(.dark):hover:bg-[#ebebeb]",
  ghost:
    "text-storm-cloud hover:bg-deep-slate hover:text-porcelain disabled:opacity-40 disabled:cursor-not-allowed",
  danger:
    "bg-warning-red hover:bg-[#d94f4f] text-porcelain shadow-[var(--shadow-sm)] disabled:opacity-40 disabled:cursor-not-allowed",
  success:
    "bg-emerald hover:bg-[#1f8a38] text-porcelain shadow-[var(--shadow-sm)] disabled:opacity-40 disabled:cursor-not-allowed",
};

const sizes: Record<string, any> = {
  sm: "h-8 px-3 text-[12px] gap-1.5 rounded-[6px]",
  md: "h-9 px-3.5 text-[13px] gap-2 rounded-[6px]",
  lg: "h-10 px-4 text-[13px] gap-2 rounded-[6px]",
};

const iconSizes: Record<string, number> = {
  sm: 12,
  md: 13,
  lg: 14,
};

export default function Button({
  children,
  variant = "primary",
  size = "md",
  icon,
  iconRight,
  disabled = false,
  loading = false,
  fullWidth = false,
  className,
  ...props
}: {
  children?: any;
  variant?: string;
  size?: string;
  icon?: any;
  iconRight?: any;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  className?: any;
  [key: string]: any;
}) {
  const iconSize = iconSizes[size] ?? iconSizes.md;

  return (
    <button
      className={cn(
        "inline-flex items-center justify-center font-[400] transition-all duration-100 ease-out cursor-pointer",
        "active:scale-[0.97] disabled:active:scale-100",
        variants[variant],
        sizes[size],
        fullWidth && "w-full",
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <LucideIcon name="progress_activity" size={iconSize} className="animate-spin shrink-0" />
      ) : icon ? (
        <LucideIcon name={icon} size={iconSize} className="shrink-0" />
      ) : null}
      {children}
      {iconRight && !loading && (
        <LucideIcon name={iconRight} size={iconSize} className="shrink-0" />
      )}
    </button>
  );
}
