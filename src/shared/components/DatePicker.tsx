"use client";
import React from "react";
import { format } from "date-fns";
import { useEffect, useRef, useState } from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import { cn } from "@/shared/utils/cn";
import LucideIcon from "@/shared/components/LucideIcon";

/**
 * DatePicker — shadcn-style date picker using react-day-picker.
 * Props:
 *   value: Date | null
 *   onChange: (date: Date | null) => void
 *   placeholder: string
 *   disabled: boolean
 *   className: string
 */
export default function DatePicker({
  value,
  onChange,
  placeholder = "Pick a date",
  disabled = false,
  className,
  ...rest
}: {
  value?: any;
  onChange?: any;
  placeholder?: any;
  disabled?: boolean;
  className?: any;
  [key: string]: any;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<any>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const handler = (e: any) => {
      if (containerRef.current && !containerRef.current!.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const displayValue = value ? format(value, "MMM d, yyyy") : null;

  return (
    <div ref={containerRef} className={cn("relative", className)} {...rest}>
      {/* Trigger button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev: any) => !prev)}
        className={cn(
          "flex h-9 w-full items-center gap-2 rounded-lg border px-3 text-sm transition-colors",
          "border-black/10 dark:border-white/10 bg-surface text-text-main",
          "hover:border-black/20 dark:hover:border-white/20",
          "focus:outline-none focus:ring-2 focus:ring-primary/20",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          !displayValue && "text-text-muted",
        )}
      >
        <LucideIcon name="calendar_today" className="text-[16px] text-text-muted shrink-0" />
        <span className="flex-1 text-left truncate">{displayValue || placeholder}</span>
        {value && (
          <LucideIcon
            name="close"
            role="button"
            tabIndex={0}
            aria-label="Clear date"
            className="text-[14px] text-text-muted hover:text-text-main shrink-0"
            onClick={(e: any) => {
              e.stopPropagation();
              onChange(null);
            }}
            onKeyDown={(e: any) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                onChange(null);
              }
            }}
          />
        )}
      </button>

      {/* Calendar popover */}
      {open && (
        <div
          className={cn(
            "absolute z-50 mt-1 rounded-lg border border-black/10 dark:border-white/10",
            "min-w-[260px] bg-surface shadow-xl shadow-black/20 p-3",
            "left-0 top-full",
          )}
        >
          <DayPicker
            {...({
              mode: "single",
              selected: value || undefined,
              onSelect: (date: Date | undefined) => {
                onChange(date || null);
                setOpen(false);
              },
              initialFocus: true,
              classNames: {
                months: "flex flex-col",
                month: "space-y-3",
                month_caption: "relative flex items-center justify-center px-8 py-1",
                caption_label: "text-sm font-medium text-text-main",
                nav: "absolute inset-x-0 top-1",
                button_previous: cn(
                  "flex items-center justify-center size-7 rounded-md border border-black/10 dark:border-white/10",
                  "text-text-muted hover:bg-surface-2 hover:text-text-main transition-colors",
                ),
                button_next: cn(
                  "flex items-center justify-center size-7 rounded-md border border-black/10 dark:border-white/10",
                  "text-text-muted hover:bg-surface-2 hover:text-text-main transition-colors",
                ),
                chevron: "size-4 text-text-muted",
                month_grid: "w-full border-collapse",
                weekdays: "flex w-full",
                weekday: "w-9 text-center text-[11px] font-medium text-text-muted",
                weeks: "mt-1 flex flex-col gap-1",
                week: "flex w-full",
                day: cn("h-9 w-9 p-0 text-center text-sm", "focus-within:relative focus-within:z-20"),
                day_button: cn(
                  "size-9 rounded-md text-sm font-normal",
                  "text-text-main hover:bg-surface-2 transition-colors cursor-pointer",
                  "focus:outline-none focus:ring-2 focus:ring-primary/20",
                ),
                selected: "bg-primary text-primary-fg hover:bg-primary hover:text-primary-fg font-medium",
                today: "border border-primary/40 text-primary font-medium",
                outside: "text-text-muted opacity-40",
                disabled: "text-text-muted opacity-30",
                hidden: "invisible",
              },
              components: {
                Chevron: ({ orientation, className }: { orientation?: string; className?: string }) => (
                  <LucideIcon
                    name={orientation === "left" ? "chevron_left" : "chevron_right"}
                    className={cn("text-[16px]", className)}
                  />
                ),
              },
            } as any)}
          />
        </div>
      )}
    </div>
  );
}
