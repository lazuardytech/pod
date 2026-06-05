"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

/**
 * Hook for copy to clipboard with feedback
 * @param {number} resetDelay - Time in ms before resetting copied state (default: 2000)
 * @returns {{ copied: string|null, copy: (text: string, id?: string) => void }}
 */
export function useCopyToClipboard(resetDelay = 2000) {
  const [copied, setCopied] = useState(null);
  const timeoutRef = useRef(null);

  const copy = useCallback(
    (text, id = "default") => {
      const write = async () => {
        if (navigator?.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          const textarea = document.createElement("textarea");
          textarea.value = text;
          textarea.style.position = "fixed";
          textarea.style.opacity = "0";
          document.body.appendChild(textarea);
          textarea.select();
          const copied = document.execCommand("copy");
          document.body.removeChild(textarea);
          if (!copied) {
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
