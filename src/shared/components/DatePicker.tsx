"use client";
import type { HTMLAttributes } from "react";
import { format } from "date-fns";
import { useState } from "react";
import LucideIcon from "@/shared/components/LucideIcon";
import { Button } from "@/shared/components/ui/button";
import { Calendar } from "@/shared/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import { cn } from "@/shared/utils/cn";

type DatePickerProps = {
  value?: Date | null;
  onChange?: (date: Date | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
} & Omit<HTMLAttributes<HTMLDivElement>, "onChange" | "value" | "children">;

export default function DatePicker({
  value,
  onChange,
  placeholder = "Pick a date",
  disabled = false,
  className,
  ...rest
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const displayValue = value ? format(value, "MMM d, yyyy") : null;

  return (
    <div className={cn("relative", className)} {...rest}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          disabled={disabled}
          className={cn(
            "flex h-9 w-full items-center gap-2 rounded-lg border px-3 text-sm transition-colors",
            "border-charcoal-grey bg-gunmetal text-porcelain",
            "hover:border-muted-ash",
            "focus:outline-none focus:ring-2 focus:ring-ring/50",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            !displayValue && "text-storm-cloud",
          )}
        >
          <LucideIcon name="calendar_today" className="text-[16px] text-storm-cloud shrink-0" />
          <span className="flex-1 text-left truncate">{displayValue || placeholder}</span>
          {value && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-5"
              onClick={(e) => {
                e.stopPropagation();
                onChange?.(null);
              }}
              aria-label="Clear date"
            >
              <LucideIcon name="close" className="text-[14px]" />
            </Button>
          )}
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={value || undefined}
            onSelect={(date) => {
              onChange?.(date || null);
              setOpen(false);
            }}
            autoFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
