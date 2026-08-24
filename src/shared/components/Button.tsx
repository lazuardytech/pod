"use client";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import LucideIcon from "@/shared/components/LucideIcon";
import { Button as UiButton } from "@/shared/components/ui/button";
import { cn } from "@/shared/utils/cn";

const variantMap: Record<string, "default" | "secondary" | "outline" | "ghost" | "destructive"> = {
  primary: "default",
  secondary: "secondary",
  outline: "outline",
  ghost: "ghost",
  danger: "destructive",
  success: "default",
};

const sizeMap: Record<string, "default" | "sm" | "lg" | "icon" | "icon-sm"> = {
  sm: "sm",
  md: "default",
  lg: "lg",
  icon: "icon-sm",
};

const iconSizes: Record<string, number> = {
  sm: 12,
  md: 13,
  lg: 14,
  icon: 14,
};

type ButtonProps = {
  children?: ReactNode;
  variant?: string;
  size?: string;
  icon?: string;
  iconRight?: string;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  className?: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "disabled" | "children">;

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
}: ButtonProps) {
  const iconSize = iconSizes[size] ?? iconSizes.md;
  const uiVariant = variantMap[variant] ?? "default";
  const uiSize = sizeMap[size] ?? "default";
  const isIconOnly = !children && Boolean(icon || iconRight);

  return (
    <UiButton
      variant={uiVariant}
      size={isIconOnly ? "icon-sm" : uiSize}
      disabled={disabled || loading}
      className={cn(
        variant === "success" && "bg-emerald text-porcelain hover:bg-emerald/90",
        variant === "primary" && "bg-porcelain text-pitch-black hover:bg-white",
        fullWidth && "w-full",
        className,
      )}
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
    </UiButton>
  );
}

type IconButtonProps = {
  icon: string;
  title?: string;
  size?: "sm" | "md" | "lg";
  variant?: string;
  className?: string;
  loading?: boolean;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">;

export function IconButton({
  icon,
  title,
  size = "md",
  variant = "ghost",
  className,
  loading = false,
  ...props
}: IconButtonProps) {
  const dim = size === "sm" ? "size-5" : size === "lg" ? "size-9" : "size-7";
  return (
    <Button
      variant={variant}
      size="icon"
      icon={icon}
      title={title}
      aria-label={title}
      loading={loading}
      className={cn(dim, "rounded-[4px] p-0", className)}
      {...props}
    />
  );
}
