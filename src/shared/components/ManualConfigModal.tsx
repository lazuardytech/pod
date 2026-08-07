"use client";
import type { ReactNode } from "react";
import { useState } from "react";
import LucideIcon from "@/shared/components/LucideIcon";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import Button from "./Button";
import Modal from "./Modal";

type ManualConfig = {
  filename: string;
  content: string;
};

export default function ManualConfigModal({
  isOpen,
  onClose,
  title = "Manual Configuration",
  configs = [],
}: {
  isOpen?: boolean;
  onClose?: () => void;
  title?: ReactNode;
  configs?: ManualConfig[];
}) {
  const { copy } = useCopyToClipboard();
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const copyConfig = (text: string, index: number) => {
    copy(text, `manualconfig-${index}`);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="xl">
      <div className="flex flex-col gap-4">
        {configs.map((config, index) => (
          <div key={index} className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-text-main">{config.filename}</span>
              <Button variant="ghost" size="sm" onClick={() => copyConfig(config.content, index)}>
                <LucideIcon
                  name={copiedIndex === index ? "check" : "content_copy"}
                  className="text-[14px] mr-1"
                />
                {copiedIndex === index ? "Copied!" : "Copy"}
              </Button>
            </div>
            <pre className="px-3 py-2 bg-black/5 dark:bg-white/5 rounded font-mono text-xs overflow-x-auto whitespace-pre-wrap break-all max-h-60 overflow-y-auto border border-border">
              {config.content}
            </pre>
          </div>
        ))}
      </div>
    </Modal>
  );
}
