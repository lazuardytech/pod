"use client";
import React from "react";
import { cn } from "@/shared/utils/cn";
import LucideIcon from "@/shared/components/LucideIcon";

export function Spinner({ size = "md", className }) {
  const sizes = {
    sm: "text-[16px]",
    md: "text-[20px]",
    lg: "text-[28px]",
    xl: "text-[40px]",
  };

  return (
    <LucideIcon name="progress_activity" className={cn("animate-spin text-storm-cloud", sizes[size], className)} />
  );
}

export function PageLoading({ message = "Loading..." }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-pitch-black">
      <Spinner size="xl" />
      {message && <p className="mt-3 text-[13px] text-fog-grey tracking-[-0.12px]">{message}</p>}
    </div>
  );
}

export function Skeleton({ className, ...props }) {
  return <div className={cn("animate-pulse rounded-[6px] bg-deep-slate", className)} {...props} />;
}

export function CardSkeleton() {
  return (
    <div className="p-3 rounded-[6px] border border-charcoal-grey bg-graphite shadow-[var(--shadow-sm)]">
      <div className="flex items-center justify-between mb-3">
        <Skeleton className="h-3.5 w-20" />
        <Skeleton className="size-7 rounded-[6px]" />
      </div>
      <Skeleton className="h-6 w-14 mb-1.5" />
      <Skeleton className="h-3 w-16" />
    </div>
  );
}

export default function Loading({ type = "spinner", ...props }) {
  switch (type) {
    case "page":
      return <PageLoading {...props} />;
    case "skeleton":
      return <Skeleton {...props} />;
    case "card":
      return <CardSkeleton {...props} />;
    default:
      return <Spinner {...props} />;
  }
}
