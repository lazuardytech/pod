"use client";

import PropTypes from "prop-types";
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Modal } from "@/shared/components";
import LucideIcon from "@/shared/components/LucideIcon";
import { getModelsByProviderId } from "@/shared/constants/models";
import { getProviderAlias } from "@/shared/constants/providers";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

type ModelLike = {
  id: string;
  name?: string;
  type?: string;
  kinds?: string[];
  isFree?: boolean;
};

type CustomModelRow = {
  id: string;
  name?: string;
  type?: string;
  providerAlias?: string;
};

type ProviderConn = { id: string; provider: string };

type TestStatus = "ok" | "error" | undefined;

// ── ModelRow ───────────────────────────────────────────────────
export function ModelRow({
  model,
  fullModel,
  copied,
  onCopy,
  testStatus,
  isCustom,
  isFree,
  onDeleteAlias,
  onTest,
  isTesting,
  alias: _alias,
  onSetAlias: _onSetAlias,
  onDisable: _onDisable,
}: {
  model: ModelLike;
  fullModel: string;
  copied?: string | null;
  onCopy: (text: string, id?: string) => void;
  testStatus?: TestStatus;
  isCustom?: boolean;
  isFree?: boolean;
  onDeleteAlias?: () => void;
  onTest?: () => void;
  isTesting?: boolean;
  alias?: string;
  onSetAlias?: (alias: string) => void;
  onDisable?: () => void;
}) {
  const borderColor =
    testStatus === "ok"
      ? "border-green-500/40"
      : testStatus === "error"
        ? "border-red-500/40"
        : "border-border";
  const iconColor = isTesting
    ? undefined
    : testStatus === "ok"
      ? "#22c55e"
      : testStatus === "error"
        ? "#ef4444"
        : undefined;

  return (
    <div
      className={`group px-3 py-2 rounded-lg border ${
        isTesting ? "animate-pulse border-border" : borderColor
      } hover:bg-sidebar/50`}
    >
      <div className="flex items-center gap-2">
        <LucideIcon
          name={
            isTesting
              ? "smart_toy"
              : testStatus === "ok"
                ? "check_circle"
                : testStatus === "error"
                  ? "cancel"
                  : "smart_toy"
          }
          className="text-base"
          style={iconColor ? { color: iconColor } : undefined}
        />
        <div className="flex flex-col gap-1">
          <code className="text-xs text-text-muted font-mono bg-sidebar px-1.5 py-0.5 rounded">
            {fullModel}
          </code>
          {model.name && (
            <span className="text-[9px] text-text-muted/70 italic pl-1">{model.name}</span>
          )}
        </div>
        {onTest && (
          <div className="relative group/btn">
            <button
              onClick={onTest}
              disabled={isTesting}
              className="p-0.5 hover:bg-sidebar rounded text-text-muted hover:text-primary"
            >
              <LucideIcon
                name={isTesting ? "progress_activity" : "science"}
                className="text-sm"
                style={isTesting ? { animation: "spin 1s linear infinite" } : undefined}
              />
            </button>
            <span className="pointer-events-none absolute mt-1 top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
              {isTesting ? "Testing..." : "Test"}
            </span>
          </div>
        )}
        <div className="relative group/btn">
          <button
            onClick={() => onCopy(fullModel, `model-${model.id}`)}
            className="p-0.5 hover:bg-sidebar rounded text-text-muted hover:text-primary"
          >
            <LucideIcon
              name={copied === `model-${model.id}` ? "check" : "content_copy"}
              className="text-sm"
            />
          </button>
          <span className="pointer-events-none absolute mt-1 top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
            {copied === `model-${model.id}` ? "Copied!" : "Copy"}
          </span>
        </div>
        {isFree && (
          <Badge variant="success" size="sm">
            FREE
          </Badge>
        )}
        {isCustom && (
          <button
            onClick={onDeleteAlias}
            className="p-0.5 hover:bg-red-500/10 rounded text-text-muted hover:text-red-500 ml-auto"
            title="Remove custom model"
          >
            <LucideIcon name="close" className="text-sm" />
          </button>
        )}
      </div>
    </div>
  );
}

ModelRow.propTypes = {
  model: PropTypes.shape({ id: PropTypes.string.isRequired }).isRequired,
  fullModel: PropTypes.string.isRequired,
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  testStatus: PropTypes.oneOf(["ok", "error"]),
  isCustom: PropTypes.bool,
  isFree: PropTypes.bool,
  onDeleteAlias: PropTypes.func,
  onTest: PropTypes.func,
  isTesting: PropTypes.bool,
};

// ── AddCustomModelModal ────────────────────────────────────────
function AddCustomModelModal({
  isOpen,
  onSave,
  onClose,
}: {
  isOpen: boolean;
  onSave: (modelId: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const [modelId, setModelId] = useState("");

  const handleSave = () => {
    if (!modelId.trim()) return;
    onSave(modelId.trim());
    setModelId("");
  };

  return (
    <Modal isOpen={isOpen} title="Add Custom Model" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div>
          <label className="text-xs text-text-muted mb-1 block">Model ID</label>
          <input
            aria-label="Model ID"
            className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            placeholder="e.g. tts-1-hd"
            autoFocus
            name="model-id"
          />
        </div>
        <div className="flex gap-2">
          <Button onClick={handleSave} fullWidth disabled={!modelId.trim()}>
            Add
          </Button>
          <Button onClick={onClose} variant="ghost" fullWidth>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

AddCustomModelModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onSave: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};

// ── ModelsCard ─────────────────────────────────────────────────
// Self-contained card: shows models for a provider, filtered by optional `kindFilter`.
// kindFilter: if provided, only shows models with matching type/kinds field.
export default function ModelsCard({
  providerId,
  kindFilter,
  providerAliasOverride,
}: {
  providerId: string;
  kindFilter?: string;
  providerAliasOverride?: string;
}) {
  const { copied, copy } = useCopyToClipboard();
  const [modelAliases, setModelAliases] = useState<Record<string, string>>({});
  const [customModels, setCustomModels] = useState<CustomModelRow[]>([]);
  const [modelTestResults, setModelTestResults] = useState<Record<string, "ok" | "error">>({});
  const [testingModelIds, setTestingModelIds] = useState<Set<string>>(new Set());
  const [testError, setTestError] = useState("");
  const [showAddCustomModel, setShowAddCustomModel] = useState(false);
  const [connections, setConnections] = useState<ProviderConn[]>([]);

  const providerAlias = providerAliasOverride || getProviderAlias(providerId);
  const effectiveType = kindFilter || "llm";

  const fetchData = useCallback(async () => {
    try {
      const [aliasRes, connRes, customRes] = await Promise.all([
        fetch("/api/models/alias"),
        fetch("/api/providers", { cache: "no-store" }),
        fetch("/api/models/custom", { cache: "no-store" }),
      ]);
      const aliasData = await aliasRes.json();
      const connData = await connRes.json();
      const customData = await customRes.json();
      if (aliasRes.ok) setModelAliases(aliasData.aliases || {});
      if (connRes.ok)
        setConnections(
          (connData.connections || []).filter((c: ProviderConn) => c.provider === providerId),
        );
      if (customRes.ok) setCustomModels(customData.models || []);
    } catch (e) {
      console.error("ModelsCard fetch error:", e);
    }
  }, [providerId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSetAlias = async (modelId: string, alias: string) => {
    const fullModel = `${providerAlias}/${modelId}`;
    try {
      const res = await fetch("/api/models/alias", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: fullModel, alias }),
      });
      if (res.ok) await fetchData();
    } catch (e) {
      console.error("set alias error:", e);
    }
  };

  const handleDeleteAlias = async (alias: string) => {
    try {
      const res = await fetch(`/api/models/alias?alias=${encodeURIComponent(alias)}`, {
        method: "DELETE",
      });
      if (res.ok) await fetchData();
    } catch (e) {
      console.error("delete alias error:", e);
    }
  };

  const handleAddCustomModel = async (modelId: string) => {
    try {
      const res = await fetch("/api/models/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerAlias, id: modelId, type: effectiveType }),
      });
      if (res.ok) {
        await fetchData();
        window.dispatchEvent(new CustomEvent("customModelChanged"));
      }
    } catch (e) {
      console.error("add custom model error:", e);
    }
  };

  const handleDeleteCustomModel = async (modelId: string) => {
    try {
      const params = new URLSearchParams({ providerAlias, id: modelId, type: effectiveType });
      const res = await fetch(`/api/models/custom?${params}`, { method: "DELETE" });
      if (res.ok) {
        await fetchData();
        window.dispatchEvent(new CustomEvent("customModelChanged"));
      }
    } catch (e) {
      console.error("delete custom model error:", e);
    }
  };

  const handleTestModel = async (modelId: string) => {
    setTestingModelIds((prev) => new Set([...prev, modelId]));
    try {
      const res = await fetch("/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: `${providerAlias}/${modelId}`, kind: kindFilter }),
      });
      const data = await res.json();
      setModelTestResults((prev) => ({ ...prev, [modelId]: data.ok ? "ok" : "error" }));
      setTestError(data.ok ? "" : data.error || "Model not reachable");
    } catch {
      setModelTestResults((prev) => ({ ...prev, [modelId]: "error" }));
      setTestError("Network error");
    } finally {
      setTestingModelIds((prev) => {
        const next = new Set(prev);
        next.delete(modelId);
        return next;
      });
    }
  };

  // Built-in models — filter by kindFilter if provided
  const allBuiltIn = getModelsByProviderId(providerId);
  const builtInModels = kindFilter
    ? allBuiltIn.filter((m: ModelLike) => {
        if (m.kinds) return m.kinds.includes(kindFilter);
        return (m.type || "llm") === kindFilter;
      })
    : allBuiltIn;

  // Custom models for this provider + kind, dedupe vs built-in
  const myCustomModels = customModels.filter(
    (m) =>
      m.providerAlias === providerAlias &&
      (m.type || "llm") === effectiveType &&
      !builtInModels.some((b: ModelLike) => b.id === m.id),
  );

  const displayModels = builtInModels;

  return (
    <>
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">
            Models{kindFilter ? ` — ${kindFilter.toUpperCase()}` : ""}
          </h2>
        </div>
        {testError && <p className="text-xs text-red-500 mb-3 break-words">{testError}</p>}

        <div className="flex flex-wrap gap-3">
          {displayModels.map((model: ModelLike) => {
            const fullModel = `${providerAlias}/${model.id}`;
            const existingAlias = Object.entries(modelAliases).find(
              ([, m]) => m === fullModel,
            )?.[0];
            return (
              <ModelRow
                key={model.id}
                model={model}
                fullModel={`${providerAlias}/${model.id}`}
                alias={existingAlias}
                copied={copied}
                onCopy={copy}
                onSetAlias={(alias) => handleSetAlias(model.id, alias)}
                onDeleteAlias={() => {
                  if (existingAlias) handleDeleteAlias(existingAlias);
                }}
                testStatus={modelTestResults[model.id]}
                onTest={connections.length > 0 ? () => handleTestModel(model.id) : undefined}
                isTesting={testingModelIds.has(model.id)}
                isFree={model.isFree}
              />
            );
          })}

          {myCustomModels.map((model) => (
            <ModelRow
              key={`${model.id}-${model.type}`}
              model={{ id: model.id, name: model.name }}
              fullModel={`${providerAlias}/${model.id}`}
              copied={copied}
              onCopy={copy}
              onSetAlias={() => {}}
              onDeleteAlias={() => handleDeleteCustomModel(model.id)}
              testStatus={modelTestResults[model.id]}
              onTest={connections.length > 0 ? () => handleTestModel(model.id) : undefined}
              isTesting={testingModelIds.has(model.id)}
              isCustom
            />
          ))}

          <button
            onClick={() => setShowAddCustomModel(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-black/15 dark:border-white/15 text-xs text-text-muted hover:text-primary hover:border-primary/40 transition-colors"
          >
            <LucideIcon name="add" className="text-sm" />
            Add Model
          </button>
        </div>
      </Card>

      <AddCustomModelModal
        isOpen={showAddCustomModel}
        onSave={async (modelId) => {
          await handleAddCustomModel(modelId);
          setShowAddCustomModel(false);
        }}
        onClose={() => setShowAddCustomModel(false)}
      />
    </>
  );
}

ModelsCard.propTypes = {
  providerId: PropTypes.string.isRequired,
  kindFilter: PropTypes.string, // e.g. "tts", "embedding" — filters models shown
  providerAliasOverride: PropTypes.string, // override alias (e.g. for custom-embedding nodes using prefix)
};
