"use client";
import React from "react";
import LucideIcon from "@/shared/components/LucideIcon";
import { cn } from "@/shared/utils/cn";

const variants = {
  default: "bg-gunmetal text-storm-cloud",
  primary: "bg-porcelain/8 text-porcelain",
  success: "bg-emerald/10 text-emerald",
  warning: "bg-yellow-500/10 text-yellow-400",
  error: "bg-warning-red/10 text-warning-red",
  info: "bg-aether-blue/10 text-aether-blue",
  violet: "bg-amethyst/10 text-amethyst",
};

const sizes = {
  sm: "px-1.5 py-0 text-[10px] gap-1",
  md: "px-1.5 py-0 text-[11px] gap-1",
  lg: "px-2 py-0.5 text-[12px] gap-1.5",
};

const dotColors = {
  default: "bg-storm-cloud",
  primary: "bg-porcelain",
  success: "bg-emerald",
  warning: "bg-yellow-400",
  error: "bg-warning-red",
  info: "bg-aether-blue",
  violet: "bg-amethyst",
};

export default function Badge({ children, variant = "default", size = "md", dot = false, icon, className }) {
  return (
    <span
      className={cn("inline-flex items-center font-[400] rounded-[4px]", variants[variant], sizes[size], className)}
    >
      {dot && <span className={cn("size-1.5 rounded-full shrink-0", dotColors[variant])} />}
      {icon && <LucideIcon name={icon} className="text-[12px]" />}
      {children}
    </span>
  );
}
