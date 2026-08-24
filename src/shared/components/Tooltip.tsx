"use client";
import type { ReactNode } from "react";
import {
  Tooltip as UiTooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/shared/components/ui/tooltip";
import { cn } from "@/shared/utils/cn";

type TooltipProps = {
  text?: ReactNode;
  children?: ReactNode;
  position?: string;
};

export default function Tooltip({ text, children, position = "top" }: TooltipProps) {
  const side =
    ({ top: "top", bottom: "bottom", left: "left", right: "right" } as const)[position] ?? "top";

  if (!text) return <>{children}</>;

  return (
    <UiTooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>{children}</TooltipTrigger>
      <TooltipContent
        side={side}
        className={cn(
          "max-w-52 px-2 py-1 rounded-[4px] bg-charcoal-grey border border-muted-ash",
          "text-[11px] text-light-steel leading-[1.4] tracking-[-0.1px]",
        )}
      >
        {text}
      </TooltipContent>
    </UiTooltip>
  );
}
