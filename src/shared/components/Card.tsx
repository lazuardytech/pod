"use client";
import type { HTMLAttributes, ReactNode } from "react";
import LucideIcon from "@/shared/components/LucideIcon";
import { Card as UiCard } from "@/shared/components/ui/card";
import { cn } from "@/shared/utils/cn";

type CardProps = {
  children?: ReactNode;
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: string;
  action?: ReactNode;
  padding?: string;
  hover?: boolean;
  elev?: boolean;
  nested?: boolean;
  className?: string;
} & Omit<HTMLAttributes<HTMLDivElement>, "title" | "children">;

export default function Card({
  children,
  title,
  subtitle,
  icon,
  action,
  padding = "md",
  hover = false,
  elev = false,
  nested = false,
  className,
  ...props
}: CardProps) {
  const paddings: Record<string, string> = {
    none: "",
    xs: "px-2 py-2",
    sm: "p-3",
    md: "p-3",
    lg: "p-4",
  };

  const bg = nested
    ? "bg-pitch-black"
    : elev
      ? "bg-deep-slate shadow-[var(--shadow-subtle)]"
      : "bg-graphite shadow-[var(--shadow-sm)]";

  return (
    <UiCard
      className={cn(
        bg,
        "rounded-[6px] border-charcoal-grey gap-0 py-0",
        hover &&
          "hover:border-muted-ash hover:bg-deep-slate transition-colors duration-100 cursor-pointer",
        paddings[padding],
        className,
      )}
      {...props}
    >
      {(title || action) && (
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {icon && (
              <div className="flex items-center justify-center size-7 rounded-[6px] bg-deep-slate text-storm-cloud">
                <LucideIcon name={icon} className="text-[16px]" />
              </div>
            )}
            <div>
              {title && (
                <h3 className="text-[13px] font-[510] text-porcelain leading-[1.47] tracking-[-0.12px]">
                  {title}
                </h3>
              )}
              {subtitle && (
                <p className="text-[12px] text-storm-cloud leading-[1.4] tracking-[-0.1px]">
                  {subtitle}
                </p>
              )}
            </div>
          </div>
          {action}
        </div>
      )}
      {children}
    </UiCard>
  );
}

Card.Section = function CardSection({
  children,
  className,
  ...props
}: { children?: ReactNode; className?: string } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("p-3 rounded-[6px] bg-pitch-black border border-charcoal-grey", className)}
      {...props}
    >
      {children}
    </div>
  );
};

Card.Row = function CardRow({
  children,
  className,
  ...props
}: { children?: ReactNode; className?: string } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "px-3 py-2 -mx-3 transition-colors duration-100",
        "border-b border-charcoal-grey last:border-b-0",
        "hover:bg-deep-slate",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
};

Card.ListItem = function CardListItem({
  children,
  actions,
  className,
  ...props
}: {
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "group flex items-center justify-between px-3 py-2 -mx-3",
        "border-b border-charcoal-grey last:border-b-0",
        "hover:bg-deep-slate transition-colors duration-100",
        className,
      )}
      {...props}
    >
      <div className="flex-1 min-w-0">{children}</div>
      {actions && (
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-100">
          {actions}
        </div>
      )}
    </div>
  );
};
