"use client";
import type { HTMLAttributes, ReactNode } from "react";
import LucideIcon from "@/shared/components/LucideIcon";
import { cn } from "@/shared/utils/cn";

export function Spinner({ size = "md", className }: { size?: string; className?: string }) {
  const sizes: Record<string, string> = {
    sm: "text-[16px]",
    md: "text-[20px]",
    lg: "text-[28px]",
    xl: "text-[40px]",
  };

  return (
    <LucideIcon
      name="progress_activity"
      className={cn("animate-spin text-storm-cloud", sizes[size], className)}
    />
  );
}

export function PageLoading({ message = "Loading..." }: { message?: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-pitch-black">
      <Spinner size="xl" />
      {message && <p className="mt-3 text-[13px] text-fog-grey tracking-[-0.12px]">{message}</p>}
    </div>
  );
}

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
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

type LoadingProps = {
  type?: string;
  size?: string;
  className?: string;
  message?: ReactNode;
};

export default function Loading({ type = "spinner", ...props }: LoadingProps) {
  switch (type) {
    case "page":
      return <PageLoading {...props} />;
    case "skeleton":
      return <Skeleton {...props} />;
    case "card":
      return <CardSkeleton />;
    default:
      return <Spinner {...props} />;
  }
}
