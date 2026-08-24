"use client";
import type { ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { cn } from "@/shared/utils/cn";
import Button from "./Button.tsx";

type ModalProps = {
  isOpen?: boolean;
  onClose?: () => void;
  title?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: string;
  closeOnOverlay?: boolean;
  showCloseButton?: boolean;
  className?: string;
};

const sizes: Record<string, string> = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-md",
  lg: "sm:max-w-lg",
  xl: "sm:max-w-xl",
  full: "sm:max-w-4xl",
};

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  footer,
  size = "md",
  closeOnOverlay: _closeOnOverlay = true,
  showCloseButton = true,
  className,
}: ModalProps) {
  return (
    <Dialog
      open={!!isOpen}
      onOpenChange={(open) => {
        if (!open) onClose?.();
      }}
    >
      <DialogContent
        showCloseButton={showCloseButton}
        className={cn(
          "bg-graphite border-charcoal-grey rounded-[6px] p-0 gap-0",
          sizes[size],
          className,
        )}
      >
        {(title || showCloseButton) && (
          <DialogHeader className="px-4 py-3 border-b border-charcoal-grey">
            {title && (
              <DialogTitle className="text-[13px] font-[510] text-porcelain tracking-[-0.12px]">
                {title}
              </DialogTitle>
            )}
          </DialogHeader>
        )}
        <div className="p-4 max-h-[calc(85vh-100px)] overflow-y-auto custom-scrollbar">
          {children}
        </div>
        {footer && (
          <DialogFooter className="px-4 py-3 border-t border-charcoal-grey bg-transparent rounded-none">
            {footer}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

type ConfirmModalProps = {
  isOpen?: boolean;
  onClose?: () => void;
  onConfirm?: () => void;
  title?: ReactNode;
  message?: ReactNode;
  confirmText?: ReactNode;
  cancelText?: ReactNode;
  variant?: string;
  loading?: boolean;
};

export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title = "Confirm",
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = "danger",
  loading = false,
}: ConfirmModalProps) {
  return (
    <AlertDialog
      open={!!isOpen}
      onOpenChange={(open) => {
        if (!open) onClose?.();
      }}
    >
      <AlertDialogContent className="bg-graphite border-charcoal-grey rounded-[6px]">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-[13px] font-[510] text-porcelain">
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-[13px] text-storm-cloud leading-[1.6]">
            {message}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel render={<Button variant="ghost" size="sm" disabled={loading} />}>
            {cancelText}
          </AlertDialogCancel>
          <AlertDialogAction
            render={<Button variant={variant} size="sm" loading={loading} onClick={onConfirm} />}
          >
            {confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
