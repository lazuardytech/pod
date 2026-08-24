"use client";
import type { ReactNode } from "react";
import { IconButton } from "@/shared/components/Button.tsx";
import {
  Drawer as UiDrawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/shared/components/ui/drawer";
import { cn } from "@/shared/utils/cn";

type DrawerProps = {
  isOpen?: boolean;
  onClose?: () => void;
  title?: ReactNode;
  children?: ReactNode;
  width?: string;
  className?: string;
};

const widths: Record<string, string> = {
  sm: "sm:[--drawer-content-width:400px]",
  md: "sm:[--drawer-content-width:500px]",
  lg: "sm:[--drawer-content-width:600px]",
  xl: "sm:[--drawer-content-width:800px]",
  full: "sm:[--drawer-content-width:100%]",
};

export default function Drawer({
  isOpen,
  onClose,
  title,
  children,
  width = "md",
  className,
}: DrawerProps) {
  return (
    <UiDrawer
      open={!!isOpen}
      onOpenChange={(open) => {
        if (!open) onClose?.();
      }}
      swipeDirection="left"
    >
      <DrawerContent
        className={cn(
          "bg-surface border-l border-border-subtle rounded-none",
          widths[width],
          className,
        )}
      >
        <DrawerHeader className="flex flex-row items-center justify-between border-b border-border-subtle p-6">
          {title && (
            <DrawerTitle className="text-lg font-semibold text-text-main">{title}</DrawerTitle>
          )}
          <IconButton icon="close" title="Close" onClick={onClose} className="ml-auto" />
        </DrawerHeader>
        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">{children}</div>
      </DrawerContent>
    </UiDrawer>
  );
}
