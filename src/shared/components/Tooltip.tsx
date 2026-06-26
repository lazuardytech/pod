"use client";
import React from "react";
import { cn } from "@/shared/utils/cn";

export default function Tooltip({
  text,
  children,
  position = "top",
}: {
  text?: any;
  children?: any;
  position?: string;
  [key: string]: any;
}) {
  const posClass = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
    left: "right-full top-1/2 -translate-y-1/2 mr-2",
    right: "left-full top-1/2 -translate-y-1/2 ml-2",
  }[position];

  return (
    <div className="relative inline-flex group">
      {children}
      <div
        className={cn(
          "pointer-events-none absolute z-50 w-max max-w-52",
          "px-2 py-1 rounded-[4px]",
          "bg-charcoal-grey border border-muted-ash",
          "text-[11px] text-light-steel leading-[1.4] tracking-[-0.1px]",
          "opacity-0 group-hover:opacity-100 transition-opacity duration-100",
          "whitespace-normal shadow-[var(--shadow-xl)]",
          posClass,
        )}
      >
        {text}
      </div>
    </div>
  );
}
