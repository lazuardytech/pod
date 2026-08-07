"use client";

import PropTypes from "prop-types";
import { useState, type ChangeEvent, type KeyboardEvent } from "react";
import { Button } from "@/shared/components";
import LucideIcon from "@/shared/components/LucideIcon";

type TestStatus = "ok" | "error" | undefined;

type CompatibleConnection = {
  id: string;
  isActive?: boolean;
};

function CompatibleModelRow({
  modelId,
  fullModel,
  copied,
  onCopy,
  onDeleteAlias,
  onTest,
  testStatus,
  isTesting,
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
            <button
              onClick={() => onCopy(fullModel, `model-${modelId}`)}
              className="p-0.5 hover:bg-sidebar rounded text-text-muted hover:text-primary"
            >
              <LucideIcon
                name={copied === `model-${modelId}` ? "check" : "content_copy"}
                className="text-sm"
              />
            </button>
            <span className="pointer-events-none absolute top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
              {copied === `model-${modelId}` ? "Copied!" : "Copy"}
            </span>
          </div>
          {onTest && (
            <div className="relative group/btn">
              <button
                onClick={onTest}
                disabled={isTesting}
                className="p-0.5 hover:bg-sidebar rounded text-text-muted hover:text-primary transition-colors"
              >
                <LucideIcon
                  name={isTesting ? "progress_activity" : "science"}
                  className="text-sm"
                  style={isTesting ? { animation: "spin 1s linear infinite" } : undefined}
                />
              </button>
              <span className="pointer-events-none absolute top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
                {isTesting ? "Testing..." : "Test"}
              </span>
            </div>
          )}
        </div>
      </div>
      <button
        onClick={onDeleteAlias}
        className="p-1 hover:bg-red-50 rounded text-red-500"
        title="Remove model"
      >
        <LucideIcon name="delete" className="text-sm" />
      </button>
    </div>
  );
}

export default function CompatibleModelsSection({
  providerStorageAlias,
  providerDisplayAlias,
  modelAliases,
  copied,
  onCopy,
  onSetAlias,
  onDeleteAlias,
  connections,
  isAnthropic,
}: {
  providerStorageAlias: string;
  providerDisplayAlias: string;
  modelAliases: Record<string, string>;
  copied?: string | null;
  onCopy: (value: string, key: string) => void;
  onSetAlias: (modelId: string, alias: string, providerAlias: string) => void | Promise<void>;
  onDeleteAlias: (alias: string) => void;
  connections: CompatibleConnection[];
  isAnthropic?: boolean;
}) {
  const [newModel, setNewModel] = useState("");
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [testingModelIds, setTestingModelIds] = useState<Set<string>>(new Set());
  const [modelTestResults, setModelTestResults] = useState<Record<string, TestStatus>>({});

  const handleTestModel = async (modelId: string) => {
    setTestingModelIds((prev) => new Set([...prev, modelId]));
    try {
      const res = await fetch("/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: `${providerStorageAlias}/${modelId}` }),
      });
      const data = (await res.json()) as { ok?: boolean };
      setModelTestResults((prev) => ({ ...prev, [modelId]: data.ok ? "ok" : "error" }));
    } catch {
      setModelTestResults((prev) => ({ ...prev, [modelId]: "error" }));
    } finally {
      setTestingModelIds((prev) => {
        const next = new Set(prev);
        next.delete(modelId);
        return next;
      });
    }
  };

  const providerAliases = Object.entries(modelAliases).filter(
    ([, model]) => typeof model === "string" && model.startsWith(`${providerStorageAlias}/`),
  );

  const allModels = providerAliases.map(([alias, fullModel]) => ({
    modelId: String(fullModel).replace(`${providerStorageAlias}/`, ""),
    fullModel: String(fullModel),
    alias: String(alias),
  }));

  const generateDefaultAlias = (modelId: string) => {
    const parts = modelId.split("/");
    return parts[parts.length - 1] ?? modelId;
  };

  const resolveAlias = (modelId: string) => {
    const fullModel = `${providerStorageAlias}/${modelId}`;
    // Skip if this exact model already has an alias
    if (Object.values(modelAliases).includes(fullModel)) return null;
    const baseAlias = generateDefaultAlias(modelId);
    if (!modelAliases[baseAlias]) return baseAlias;
    const prefixedAlias = `${providerDisplayAlias}-${baseAlias}`;
    if (!modelAliases[prefixedAlias]) return prefixedAlias;
    return null;
  };

  const handleAdd = async () => {
    if (!newModel.trim() || adding) return;
    const modelId = newModel.trim();
    const resolvedAlias = resolveAlias(modelId);
    if (!resolvedAlias) {
      alert(
        "All suggested aliases already exist. Please choose a different model or remove conflicting aliases.",
      );
      return;
    }

    setAdding(true);
    try {
      await onSetAlias(modelId, resolvedAlias, providerStorageAlias);
      setNewModel("");
    } catch (error) {
      console.error("Error adding model:", error);
    } finally {
      setAdding(false);
    }
  };

  const handleImport = async () => {
    if (importing) return;
    const activeConnection = connections.find((conn) => conn.isActive !== false);
    if (!activeConnection) return;

    setImporting(true);
    try {
      const res = await fetch(`/api/providers/${activeConnection.id}/models`);
      const data = (await res.json()) as {
        error?: string;
        models?: Array<{ id?: string; name?: string; model?: string }>;
      };
      if (!res.ok) {
        alert(data.error || "Failed to import models");
        return;
      }
      const models = data.models || [];
      if (models.length === 0) {
        alert("No models returned from /models.");
        return;
      }
      let importedCount = 0;
      for (const model of models) {
        const modelId = model.id || model.name || model.model;
        if (!modelId) continue;
        const resolvedAlias = resolveAlias(modelId);
        if (!resolvedAlias) continue;
        await onSetAlias(modelId, resolvedAlias, providerStorageAlias);
        importedCount += 1;
      }
      if (importedCount === 0) {
        alert("No new models were added.");
      }
    } catch (error) {
      console.error("Error importing models:", error);
    } finally {
      setImporting(false);
    }
  };

  const canImport = connections.some((conn) => conn.isActive !== false);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-muted">
        Add {isAnthropic ? "Anthropic" : "OpenAI"}-compatible models manually or import them from
        the /models endpoint.
      </p>

      <div className="flex items-end gap-2 flex-wrap">
        <div className="flex-1 min-w-[240px]">
          <label
            htmlFor="new-compatible-model-input"
            className="text-xs text-text-muted mb-1 block"
          >
            Model ID
          </label>
          <input
            id="new-compatible-model-input"
            type="text"
            value={newModel}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setNewModel(e.target.value)}
            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => e.key === "Enter" && handleAdd()}
            placeholder={isAnthropic ? "claude-3-opus-20240229" : "gpt-4o"}
            className="w-full h-8 px-3 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
          />
        </div>
        <Button size="sm" icon="add" onClick={handleAdd} disabled={!newModel.trim() || adding}>
          {adding ? "Adding..." : "Add"}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          icon="download"
          onClick={handleImport}
          disabled={!canImport || importing}
        >
          {importing ? "Importing..." : "Import from /models"}
        </Button>
      </div>

      {!canImport && (
        <p className="text-xs text-text-muted">Add a connection to enable importing models.</p>
      )}

      {allModels.length > 0 && (
        <div className="flex flex-col gap-3">
          {allModels.map(({ modelId, fullModel: _fullModel, alias }) => (
            <CompatibleModelRow
              key={_fullModel}
              modelId={modelId}
              fullModel={`${providerDisplayAlias}/${modelId}`}
              copied={copied}
              onCopy={onCopy}
              onDeleteAlias={() => onDeleteAlias(alias)}
              onTest={connections.length > 0 ? () => handleTestModel(modelId) : undefined}
              testStatus={modelTestResults[modelId]}
              isTesting={testingModelIds.has(modelId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

CompatibleModelsSection.propTypes = {
  providerStorageAlias: PropTypes.string.isRequired,
  providerDisplayAlias: PropTypes.string.isRequired,
  modelAliases: PropTypes.object.isRequired,
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  onSetAlias: PropTypes.func.isRequired,
  onDeleteAlias: PropTypes.func.isRequired,
  connections: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string,
      isActive: PropTypes.bool,
    }),
  ).isRequired,
  isAnthropic: PropTypes.bool,
};
