"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

export type CopyToClipboardResult = {
  copied: string | null;
  copy: (text: string, id?: string) => void;
};

/**
 * Hook for copy to clipboard with feedback.
 * @param resetDelay - Time in ms before resetting copied state (default: 2000)
 */
export function useCopyToClipboard(resetDelay: number = 2000): CopyToClipboardResult {
  const [copied, setCopied] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback(
    (text: string, id: string = "default") => {
      const write = async (): Promise<void> => {
        if (navigator?.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          const textarea = document.createElement("textarea");
          textarea.value = text;
          textarea.style.position = "fixed";
          textarea.style.opacity = "0";
          document.body.appendChild(textarea);
          textarea.select();
          const ok = document.execCommand("copy");
          document.body.removeChild(textarea);
          if (!ok) {
            throw new Error("Copy command failed");
          }
        }
      };
      write()
        .then(() => {
          setCopied(id);

          if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
          }

          timeoutRef.current = setTimeout(() => {
            setCopied(null);
          }, resetDelay);
        })
        .catch(() => {
          toast.error("Failed to copy");
        });
    },
    [resetDelay],
  );

  return { copied, copy };
}
