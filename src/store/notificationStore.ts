/**
 * Notification Store — Zustand-based global toast notification system.
 * Delegates to sonner for rendering.
 */

import { toast } from "sonner";

export interface NotificationStore {
  success: (message: string, title?: string) => void;
  error: (message: string, title?: string) => void;
  warning: (message: string, title?: string) => void;
  info: (message: string, title?: string) => void;
  addNotification: (opts: {
    type: "success" | "error" | "warning" | "info";
    message: string;
    title?: string;
  }) => void;
}

export const useNotificationStore = (): NotificationStore => ({
  success: (message, title) =>
    toast.success(title || message, { description: title ? message : undefined }),
  error: (message, title) =>
    toast.error(title || message, { description: title ? message : undefined, duration: 8000 }),
  warning: (message, title) =>
    toast.warning(title || message, { description: title ? message : undefined }),
  info: (message, title) =>
    toast.info(title || message, { description: title ? message : undefined }),
  addNotification: ({ type, message, title }) => {
    const fn: typeof toast.success =
      { success: toast.success, error: toast.error, warning: toast.warning, info: toast.info }[
        type
      ] ?? toast;
    fn(title || message, { description: title ? message : undefined });
  },
});

// Also export direct toast helpers for non-hook usage
export const notify: Record<
  "success" | "error" | "warning" | "info",
  (message: string, title?: string) => void
> = {
  success: (message, title) =>
    toast.success(title || message, { description: title ? message : undefined }),
  error: (message, title) =>
    toast.error(title || message, { description: title ? message : undefined, duration: 8000 }),
  warning: (message, title) =>
    toast.warning(title || message, { description: title ? message : undefined }),
  info: (message, title) =>
    toast.info(title || message, { description: title ? message : undefined }),
};
