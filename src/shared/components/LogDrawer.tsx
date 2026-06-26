"use client";
import React from "react";
import { useRef } from "react";
import { Drawer } from "vaul";
import { cn } from "@/shared/utils/cn";
import LucideIcon from "@/shared/components/LucideIcon";

export function LogDrawer({ open, onClose, children }: { open?: any; onClose?: any; children?: any; [key: string]: any }) {
  return (
    <Drawer.Root open={open} onOpenChange={(v) => !v && onClose()} direction="right">
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]" />
        <Drawer.Content
          className={cn(
            "fixed right-0 top-0 bottom-0 z-50 flex flex-col",
            "w-full max-w-[560px]",
            "bg-graphite border-l border-charcoal-grey",
            "shadow-[var(--shadow-xl)]",
            "outline-none",
          )}
        >
          {children}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

export function LogDrawerHeader({ title, onClose, children }: { title?: any; onClose?: any; children?: any; [key: string]: any }) {
  return (
    <div className="flex items-center justify-between h-14 px-4 border-b border-charcoal-grey shrink-0">
      <div className="flex items-center gap-2">
        <LucideIcon name="receipt_long" className="text-[16px] text-fog-grey" />
        <h2 className="text-[13px] font-[510] text-porcelain tracking-[-0.12px]">{title}</h2>
      </div>
      <div className="flex items-center gap-1">
        {children}
        <button
          onClick={onClose}
          className="flex items-center justify-center size-7 rounded-[4px] text-storm-cloud hover:bg-deep-slate hover:text-porcelain transition-colors duration-100"
        >
          <LucideIcon name="close" className="text-[15px]" />
        </button>
      </div>
    </div>
  );
}

export function LogDrawerBody({ children }: { children?: any; [key: string]: any }) {
  return <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">{children}</div>;
}

export function DetailSection({ title, icon, children }: { title?: any; icon?: any; children?: any; [key: string]: any }) {
  return (
    <div className="rounded-[6px] border border-charcoal-grey bg-deep-slate overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-charcoal-grey bg-pitch-black/40">
        {icon && <LucideIcon name={icon} className="text-[13px] text-fog-grey" />}
        <span className="text-[10px] font-[590] uppercase tracking-[0.06em] text-fog-grey">{title}</span>
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

export function DetailRow({ label, value, mono = false, accent }: { label?: any; value?: any; mono?: boolean; accent?: any; [key: string]: any }) {
  if (value == null || value === "" || value === "-") return null;
  return (
    <div className="flex items-start justify-between gap-3 py-1 border-b border-charcoal-grey/50 last:border-0">
      <span className="text-[11px] text-fog-grey shrink-0">{label}</span>
      <span
        className={cn(
          "text-[11px] text-right break-all",
          mono ? "font-mono text-alabaster" : "text-storm-cloud",
          accent,
        )}
      >
        {value}
      </span>
    </div>
  );
}

export function JsonBlock({ data }: { data?: any; [key: string]: any }) {
  const ref = useRef(null);
  if (!data || (typeof data === "object" && Object.keys(data).length === 0)) return null;
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return (
    <pre
      ref={ref}
      className="text-[10px] font-mono text-alabaster bg-pitch-black rounded-[4px] p-3 overflow-x-auto max-h-[300px] overflow-y-auto custom-scrollbar whitespace-pre-wrap break-all leading-[1.6]"
    >
      {text}
    </pre>
  );
}
