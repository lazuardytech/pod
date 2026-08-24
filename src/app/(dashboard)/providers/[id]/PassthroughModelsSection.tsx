"use client";

import PropTypes from "prop-types";
import { useState, type ChangeEvent, type KeyboardEvent } from "react";
import { Button, IconButton } from "@/shared/components";
import LucideIcon from "@/shared/components/LucideIcon";

type TestStatus = "ok" | "error" | undefined;

function PassthroughModelRow({
  modelId,
  fullModel,
  copied,
  onCopy,
  onDeleteAlias,
  onTest = undefined,
  testStatus = undefined,
  isTesting = false,
}: {
  modelId: string;
  fullModel: string;
  copied?: string | null;
  onCopy: (value: string, key: string) => void;
  onDeleteAlias: () => void;
  onTest?: () => void;
  testStatus?: TestStatus;
  isTesting?: boolean;
}) {
  const borderColor =
    testStatus === "ok"
      ? "border-green-500/40"
      : testStatus === "error"
        ? "border-red-500/40"
        : "border-border";

  const iconColor =
    testStatus === "ok" ? "#22c55e" : testStatus === "error" ? "#ef4444" : undefined;

  return (
    <div
      className={`flex items-center gap-3 p-3 rounded-lg border ${borderColor} hover:bg-sidebar/50`}
    >
      <LucideIcon
        name={
          testStatus === "ok" ? "check_circle" : testStatus === "error" ? "cancel" : "smart_toy"
        }
        className="text-base text-text-muted"
        style={iconColor ? { color: iconColor } : undefined}
      />

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{modelId}</p>

        <div className="flex items-center gap-1 mt-1">
          <code className="text-xs text-text-muted font-mono bg-sidebar px-1.5 py-0.5 rounded">
            {fullModel}
          </code>
          <div className="relative group/btn">
            <IconButton
              icon={copied === `model-${modelId}` ? "check" : "content_copy"}
              title={copied === `model-${modelId}` ? "Copied!" : "Copy"}
              size="sm"
              variant="ghost"
              onClick={() => onCopy(fullModel, `model-${modelId}`)}
              className="text-text-muted hover:text-primary"
            />
            <span className="pointer-events-none absolute top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
              {copied === `model-${modelId}` ? "Copied!" : "Copy"}
            </span>
          </div>
          {onTest && (
            <div className="relative group/btn">
              <IconButton
                icon="science"
                title={isTesting ? "Testing..." : "Test"}
                size="sm"
                variant="ghost"
                onClick={onTest}
                disabled={isTesting}
                loading={isTesting}
                className="text-text-muted hover:text-primary"
              />
              <span className="pointer-events-none absolute top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
                {isTesting ? "Testing..." : "Test"}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Delete button */}
      <IconButton
        icon="delete"
        title="Remove model"
        size="sm"
        variant="ghost"
        onClick={onDeleteAlias}
        className="text-red-500 hover:bg-red-50"
      />
    </div>
  );
}

PassthroughModelRow.propTypes = {
  modelId: PropTypes.string.isRequired,
  fullModel: PropTypes.string.isRequired,
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  onDeleteAlias: PropTypes.func.isRequired,
  onTest: PropTypes.func,
  testStatus: PropTypes.oneOf(["ok", "error"]),
  isTesting: PropTypes.bool,
};

export default function PassthroughModelsSection({
  providerAlias,
  modelAliases,
  copied,
  onCopy,
  onSetAlias,
  onDeleteAlias,
}: {
  providerAlias: string;
  modelAliases: Record<string, string>;
  copied?: string | null;
  onCopy: (value: string, key: string) => void;
  onSetAlias: (modelId: string, alias: string) => void | Promise<void>;
  onDeleteAlias: (alias: string) => void;
}) {
  const [newModel, setNewModel] = useState("");
  const [adding, setAdding] = useState(false);

  // Filter aliases for this provider - models are persisted via alias
  const providerAliases = Object.entries(modelAliases).filter(
    ([, model]) => typeof model === "string" && model.startsWith(`${providerAlias}/`),
  );

  const allModels = providerAliases.map(([alias, fullModel]) => ({
    modelId: String(fullModel).replace(`${providerAlias}/`, ""),
    fullModel: String(fullModel),
    alias: String(alias),
  }));

  // Generate default alias from modelId (last part after /)
  const generateDefaultAlias = (modelId: string) => {
    const parts = modelId.split("/");
    return parts[parts.length - 1] ?? modelId;
  };

  const handleAdd = async () => {
    if (!newModel.trim() || adding) return;
    const modelId = newModel.trim();
    const defaultAlias = generateDefaultAlias(modelId);

    // Check if alias already exists
    if (modelAliases[defaultAlias]) {
      alert(
        `Alias "${defaultAlias}" already exists. Please use a different model or edit existing alias.`,
      );
      return;
    }

    setAdding(true);
    try {
      await onSetAlias(modelId, defaultAlias);
      setNewModel("");
    } catch (error) {
      console.error("Error adding model:", error);
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-muted">
        OpenRouter supports any model. Add models and create aliases for quick access.
      </p>

      {/* Add new model */}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label htmlFor="new-model-input" className="text-xs text-text-muted mb-1 block">
            Model ID (from OpenRouter)
          </label>
          <input
            id="new-model-input"
            type="text"
            value={newModel}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setNewModel(e.target.value)}
            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => e.key === "Enter" && handleAdd()}
            placeholder="anthropic/claude-3-opus"
            className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
          />
        </div>
        <Button size="sm" icon="add" onClick={handleAdd} disabled={!newModel.trim() || adding}>
          {adding ? "Adding..." : "Add"}
        </Button>
      </div>

      {/* Models list */}
      {allModels.length > 0 && (
        <div className="flex flex-col gap-3">
          {allModels.map(({ modelId, fullModel, alias }) => (
            <PassthroughModelRow
              key={fullModel}
              modelId={modelId}
              fullModel={fullModel}
              copied={copied}
              onCopy={onCopy}
              onDeleteAlias={() => onDeleteAlias(alias)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

PassthroughModelsSection.propTypes = {
  providerAlias: PropTypes.string.isRequired,
  modelAliases: PropTypes.object.isRequired,
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  onSetAlias: PropTypes.func.isRequired,
  onDeleteAlias: PropTypes.func.isRequired,
};
