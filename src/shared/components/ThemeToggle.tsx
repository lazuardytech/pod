"use client";
import LucideIcon from "@/shared/components/LucideIcon";
import { useTheme } from "@/shared/hooks/useTheme";
import { cn } from "@/shared/utils/cn";

export default function ThemeToggle({
  className,
  variant = "default",
}: {
  className?: string;
  variant?: string;
}) {
  const { isDark, toggleTheme } = useTheme();

  const variants: Record<string, string> = {
    default: cn(
      "flex items-center justify-center size-10 rounded-full",
      "text-text-muted hover:text-text-main",
      "hover:bg-surface-2 transition-colors",
    ),
    card: cn(
      "flex items-center justify-center size-11 rounded-full",
      "bg-surface/60 hover:bg-surface",
      "border border-border",
      "backdrop-blur-md shadow-sm hover:shadow-[var(--shadow-warm)]",
      "text-text-muted hover:text-brand-500",
      "transition-all group",
    ),
  };

  return (
    <button
      onClick={toggleTheme}
      className={cn(variants[variant], className)}
      aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
      title={`Switch to ${isDark ? "light" : "dark"} mode`}
    >
      <LucideIcon
        name={isDark ? "light_mode" : "dark_mode"}
        className={cn(
          "text-[22px]",
          variant === "card" && "transition-transform duration-300 group-hover:rotate-12",
        )}
      />
    </button>
  );
}
