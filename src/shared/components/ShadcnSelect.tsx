"use client";
import React from "react";
import PropTypes from "prop-types";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/shared/utils/cn";
import LucideIcon from "@/shared/components/LucideIcon";

export default function ShadcnSelect({
  value,
  onValueChange,
  options = [],
  placeholder = "Select an option",
  ariaLabel,
  disabled = false,
  className,
  triggerClassName,
  contentClassName,
  itemClassName,
  name,
}: {
  value?: any;
  onValueChange?: any;
  options?: any[];
  placeholder?: any;
  ariaLabel?: any;
  disabled?: boolean;
  className?: any;
  triggerClassName?: any;
  contentClassName?: any;
  itemClassName?: any;
  name?: any;
  [key: string]: any;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  const selectedOption = useMemo(() => options.find((option) => option.value === value) || null, [options, value]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    };

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-charcoal-grey bg-gunmetal px-3 text-[13px] text-porcelain shadow-[var(--shadow-sm)] transition-colors duration-100",
          "hover:bg-charcoal-grey/70 focus:outline-none focus:border-porcelain/50 focus:ring-1 focus:ring-porcelain/25",
          "disabled:cursor-not-allowed disabled:opacity-40",
          open && "border-porcelain/50 ring-1 ring-porcelain/25",
          triggerClassName,
        )}
      >
        <span className={cn("truncate text-left", !selectedOption && "text-fog-grey")}>
          {selectedOption?.label || placeholder}
        </span>
        <LucideIcon
          name="keyboard_arrow_down"
          className={cn(
            "shrink-0 text-[16px] text-storm-cloud transition-transform duration-100",
            open && "rotate-180",
          )}
        />
      </button>
      {name ? <input type="hidden" name={name} value={value || ""} /> : null}
      {open && (
        <div
          role="listbox"
          className={cn(
            "absolute left-0 top-full z-50 mt-1 max-h-64 min-w-full overflow-auto rounded-md border border-charcoal-grey bg-graphite p-1 shadow-[var(--shadow-xl)]",
            contentClassName,
          )}
        >
          {options.map((option) => {
            const isSelected = option.value === value;

            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onValueChange(option.value);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-[6px] px-2.5 py-2 text-left text-[13px] text-porcelain transition-colors duration-100",
                  "hover:bg-deep-slate focus:bg-deep-slate focus:outline-none",
                  isSelected && "bg-deep-slate",
                  itemClassName,
                )}
              >
                <span className="flex-1 truncate">{option.label}</span>
                {isSelected && <LucideIcon name="check" className="shrink-0 text-[14px] text-porcelain" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

ShadcnSelect.propTypes = {
  value: PropTypes.string,
  onValueChange: PropTypes.func.isRequired,
  options: PropTypes.arrayOf(
    PropTypes.shape({
      label: PropTypes.string.isRequired,
      value: PropTypes.string.isRequired,
    }),
  ),
  placeholder: PropTypes.string,
  ariaLabel: PropTypes.string,
  disabled: PropTypes.bool,
  className: PropTypes.string,
  triggerClassName: PropTypes.string,
  contentClassName: PropTypes.string,
  itemClassName: PropTypes.string,
  name: PropTypes.string,
};
