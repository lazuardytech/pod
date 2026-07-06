"use client";
import PropTypes from "prop-types";
import { useEffect, useMemo, useState } from "react";
import LucideIcon from "@/shared/components/LucideIcon";
import { getModelsByProviderId } from "@/shared/constants/models";
import {
  AI_PROVIDERS,
  APIKEY_PROVIDERS,
  FREE_PROVIDERS,
  FREE_TIER_PROVIDERS,
  getProviderAlias,
  isAnthropicCompatibleProvider,
  isOpenAICompatibleProvider,
  OAUTH_PROVIDERS,
} from "@/shared/constants/providers";
import Button from "./Button";
import Modal from "./Modal";

// Provider order: OAuth first, then Free Tier, then API Key (matches dashboard/providers)
const PROVIDER_ORDER = [
  ...Object.keys(OAUTH_PROVIDERS),
  ...Object.keys(FREE_PROVIDERS),
  ...Object.keys(FREE_TIER_PROVIDERS),
  ...Object.keys(APIKEY_PROVIDERS),
];

// Providers that need no auth — always show in model selector
const NO_AUTH_PROVIDER_IDS = Object.keys(FREE_PROVIDERS).filter(
  (id: string) => FREE_PROVIDERS[id]?.noAuth,
);

export default function ModelSelectModal({
  isOpen,
  onClose,
  onSelect,
  onDeselect,
  selectedModel,
  activeProviders = [],
  title = "Select Model",
  modelAliases = {},
  kindFilter = null,
  addedModelValues = [],
  closeOnSelect = true,
}: {
  isOpen?: boolean;
  onClose?: () => void;
  onSelect?: (model: unknown) => void;
  onDeselect?: (model: unknown) => void;
  selectedModel?: string;
  activeProviders?: Record<string, unknown>[];
  title?: string;
  modelAliases?: Record<string, string>;
  kindFilter?: string | null;
  addedModelValues?: string[];
  closeOnSelect?: boolean;
}) {
  // Filter activeProviders by serviceKinds when kindFilter set (e.g. "webSearch", "webFetch")
  const filteredActiveProviders = useMemo(() => {
    if (!kindFilter) return activeProviders;
    return activeProviders.filter((p: Record<string, unknown>) => {
      const info = AI_PROVIDERS[p.provider as string];
      const kinds = info?.serviceKinds || ["llm"];
      return kinds.includes(kindFilter as import("@/shared/constants/providers").ServiceKind);
    });
  }, [activeProviders, kindFilter]);
  const [searchQuery, setSearchQuery] = useState("");
  const [combos, setCombos] = useState<Record<string, unknown>[]>([]);
  const [providerNodes, setProviderNodes] = useState<Record<string, unknown>[]>([]);
  const [customModels, setCustomModels] = useState<Record<string, unknown>[]>([]);
  const [disabledModels, setDisabledModels] = useState<Record<string, unknown>>({});
  const [kiloFreeModels, setKiloFreeModels] = useState<Record<string, unknown>[]>([]);

  const fetchCombos = async () => {
    try {
      const res = await fetch("/api/combos");
      if (!res.ok) throw new Error(`Failed to fetch combos: ${res.status}`);
      const data = await res.json();
      setCombos(data.combos || []);
    } catch (error) {
      console.error("Error fetching combos:", error);
      setCombos([]);
    }
  };

  useEffect(() => {
    if (isOpen) fetchCombos();
  }, [isOpen]);

  const fetchProviderNodes = async () => {
    try {
      const res = await fetch("/api/provider-nodes");
      if (!res.ok) throw new Error(`Failed to fetch provider nodes: ${res.status}`);
      const data = await res.json();
      setProviderNodes(data.nodes || []);
    } catch (error) {
      console.error("Error fetching provider nodes:", error);
      setProviderNodes([]);
    }
  };

  useEffect(() => {
    if (isOpen) fetchProviderNodes();
  }, [isOpen]);

  const fetchCustomModels = async () => {
    try {
      const res = await fetch("/api/models/custom");
      if (!res.ok) throw new Error(`Failed to fetch custom models: ${res.status}`);
      const data = await res.json();
      setCustomModels(data.models || []);
    } catch (error) {
      console.error("Error fetching custom models:", error);
      setCustomModels([]);
    }
  };

  useEffect(() => {
    if (isOpen) fetchCustomModels();
  }, [isOpen]);

  const fetchKiloFreeModels = async () => {
    try {
      const res = await fetch("/api/providers/kilo/free-models");
      if (!res.ok) throw new Error(`Failed to fetch Kilo free models: ${res.status}`);
      const data = await res.json();
      setKiloFreeModels(data.models || []);
    } catch (error) {
      console.error("Error fetching Kilo free models:", error);
      setKiloFreeModels([]);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    const hasKilocode = filteredActiveProviders.some(
      (p: Record<string, unknown>) => p.provider === "kilocode",
    );
    if (!hasKilocode || kindFilter) {
      setKiloFreeModels([]);
      return;
    }
    fetchKiloFreeModels();
  }, [isOpen, filteredActiveProviders, kindFilter]);

  const fetchDisabledModels = async () => {
    try {
      const res = await fetch("/api/models/disabled");
      if (!res.ok) throw new Error(`Failed to fetch disabled models: ${res.status}`);
      const data = await res.json();
      setDisabledModels(data.disabled || {});
    } catch (error) {
      console.error("Error fetching disabled models:", error);
      setDisabledModels({});
    }
  };

  useEffect(() => {
    if (isOpen) fetchDisabledModels();
  }, [isOpen]);

  const allProviders = useMemo(
    () => ({ ...OAUTH_PROVIDERS, ...FREE_PROVIDERS, ...FREE_TIER_PROVIDERS, ...APIKEY_PROVIDERS }),
    [],
  );

  // Group models by provider with priority order
  const groupedModels = useMemo(() => {
    const groups: Record<string, unknown> = {};

    // Kinds where the provider IS the model (no per-model selection needed)
    const PROVIDER_AS_MODEL_KINDS = new Set(["webSearch", "webFetch"]);
    // Kinds that map directly to model.type field
    const TYPED_KINDS = new Set(["image", "tts", "stt", "embedding", "imageToText"]);
    // For these kinds, providers without hardcoded models can still be picked (provider-as-model fallback)
    const ALLOW_PROVIDER_FALLBACK_KINDS = new Set(["tts", "image", "webFetch"]);

    // Filter a models[] array by kindFilter (keep only matching m.type)
    const filterByKind = (models: Record<string, unknown>[]) => {
      // No kindFilter → LLM context: keep only LLM models (no type or type === "llm")
      if (!kindFilter)
        return models.filter(
          (m: Record<string, unknown>) => m.isPlaceholder || !m.type || m.type === "llm",
        );
      if (!TYPED_KINDS.has(kindFilter)) return models;
      return models.filter(
        (m: Record<string, unknown>) => m.isPlaceholder || m.type === kindFilter,
      );
    };

    // Get all active provider IDs from connections (filtered by kindFilter if set)
    const activeConnectionIds = filteredActiveProviders.map(
      (p: Record<string, unknown>) => p.provider as string,
    );

    // No-auth providers: filter by kindFilter as well
    const noAuthIds: string[] = kindFilter
      ? (NO_AUTH_PROVIDER_IDS as string[]).filter((id: string) =>
          (AI_PROVIDERS[id]?.serviceKinds || ["llm"]).includes(
            kindFilter as import("@/shared/constants/providers").ServiceKind,
          ),
        )
      : (NO_AUTH_PROVIDER_IDS as string[]);

    // Only show connected providers (including both standard and custom)
    const providerIdsToShow = new Set([
      ...activeConnectionIds, // Only connected providers
      ...noAuthIds, // No-auth providers (kind-filtered)
    ]);

    // Sort by PROVIDER_ORDER
    const sortedProviderIds = [...providerIdsToShow].sort((a: string, b: string) => {
      const indexA = PROVIDER_ORDER.indexOf(a);
      const indexB = PROVIDER_ORDER.indexOf(b);
      return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
    });

    sortedProviderIds.forEach((providerId: string) => {
      const alias = getProviderAlias(providerId);
      const providerInfo: Record<string, unknown> = ((allProviders as Record<string, unknown>)[
        providerId
      ] as Record<string, unknown>) || { name: providerId, color: "#666" };
      const isCustomProvider =
        isOpenAICompatibleProvider(providerId) || isAnthropicCompatibleProvider(providerId);

      // For provider-as-model kinds (webSearch/webFetch): emit a single entry where value === providerId
      if (kindFilter && PROVIDER_AS_MODEL_KINDS.has(kindFilter)) {
        (groups as Record<string, unknown>)[providerId] = {
          name: providerInfo.name,
          alias,
          color: providerInfo.color,
          models: [{ id: providerId, name: providerInfo.name, value: providerId }],
        };
        return;
      }

      if (providerInfo.passthroughModels) {
        const aliasModels = Object.entries(modelAliases)
          .filter(([, fullModel]: [string, string]) => fullModel.startsWith(`${alias}/`))
          .map(([aliasName, fullModel]: [string, string]) => ({
            id: fullModel.replace(`${alias}/`, ""),
            name: aliasName,
            value: fullModel,
          }));

        // For typed kinds, only include hardcoded typed models (aliases are typically LLM-only and lack type info)
        let combined = aliasModels;
        if (kindFilter && TYPED_KINDS.has(kindFilter)) {
          combined = getModelsByProviderId(providerId)
            .filter((m: Record<string, unknown>) => m.type === kindFilter)
            .map((m: Record<string, unknown>) => ({
              id: m.id,
              name: m.name,
              value: `${alias}/${m.id as string}`,
              type: m.type,
            }));
          // Fallback: provider-as-model when no hardcoded models match (tts/image/webFetch only)
          if (combined.length === 0 && ALLOW_PROVIDER_FALLBACK_KINDS.has(kindFilter)) {
            const supports = ((providerInfo.serviceKinds as string[]) || ["llm"]).includes(
              kindFilter,
            );
            if (supports)
              combined = [{ id: providerId, name: providerInfo.name as string, value: alias }];
          }
        }

        if (combined.length > 0) {
          // Check for custom name from providerNodes (for compatible providers)
          const matchedNode = providerNodes.find(
            (node: Record<string, unknown>) => node.id === providerId,
          );
          const displayName = (matchedNode?.name as string) || (providerInfo.name as string);

          (groups as Record<string, unknown>)[providerId] = {
            name: displayName,
            alias: alias,
            color: providerInfo.color,
            models: combined,
          };
        }
      } else if (isCustomProvider) {
        // Custom (openai/anthropic-compatible) providers are LLM-only — skip for typed media kinds
        if (kindFilter && TYPED_KINDS.has(kindFilter)) return;
        // Find connection object to get prefix synchronously without waiting for providerNodes fetch
        const connection = activeProviders.find(
          (p: Record<string, unknown>) => p.provider === providerId,
        );
        const matchedNode = providerNodes.find(
          (node: Record<string, unknown>) => node.id === providerId,
        );
        // Custom providers: prefer user-defined name (e.g. "Bonsai") over registry default.
        // Fall back to providerInfo.name for standard providers.
        const displayName = (matchedNode?.name as string) || (providerInfo.name as string);
        const nodePrefix =
          ((connection?.providerSpecificData as Record<string, unknown>)?.prefix as string) ||
          (matchedNode?.prefix as string) ||
          providerId;

        // Aliases are stored using the raw providerId as key (e.g. "openai-compatible-chat-<uuid>/glm-4.7"),
        // so we must filter by providerId, not by the display prefix.
        const nodeModels = Object.entries(modelAliases)
          .filter(([, fullModel]: [string, string]) => fullModel.startsWith(`${providerId}/`))
          .map(([aliasName, fullModel]: [string, string]) => ({
            id: fullModel.replace(`${providerId}/`, ""),
            name: aliasName,
            value: `${nodePrefix}/${fullModel.replace(`${providerId}/`, "")}`,
          }));

        // Always show compatible providers that are connected, even with no aliases.
        // When no aliases exist, show a placeholder so users know it's available.
        const modelsToShow =
          nodeModels.length > 0
            ? nodeModels
            : [
                {
                  id: `__placeholder__${providerId}`,
                  name: `${nodePrefix}/model-id`,
                  value: `${nodePrefix}/model-id`,
                  isPlaceholder: true,
                },
              ];

        (groups as Record<string, unknown>)[providerId] = {
          name: displayName,
          alias: nodePrefix,
          color: providerInfo.color,
          models: modelsToShow,
          isCustom: true,
          hasModels: nodeModels.length > 0,
        };
      } else {
        const hardcodedModels = getModelsByProviderId(providerId);
        const hardcodedIds = new Set(hardcodedModels.map((m: Record<string, unknown>) => m.id));

        // Custom models: if no hardcoded models (e.g. openrouter), show all aliases for this provider
        // Otherwise only show aliases where aliasName === modelId ("Add Model" button pattern)
        const hasHardcoded = hardcodedModels.length > 0;
        const customAliasModels = Object.entries(modelAliases)
          .filter(
            ([aliasName, fullModel]: [string, string]) =>
              fullModel.startsWith(`${alias}/`) &&
              (hasHardcoded ? aliasName === fullModel.replace(`${alias}/`, "") : true) &&
              !hardcodedIds.has(fullModel.replace(`${alias}/`, "")),
          )
          .map(([aliasName, fullModel]: [string, string]) => {
            const modelId = fullModel.replace(`${alias}/`, "");
            return { id: modelId, name: aliasName, value: fullModel, isCustom: true };
          });

        // Custom models registered via /api/models/custom (provider "Add Model" button)
        const customAliasIds = new Set(customAliasModels.map((m: Record<string, unknown>) => m.id));
        const customRegisteredModels = customModels
          .filter(
            (m: Record<string, unknown>) =>
              m.providerAlias === alias && !hardcodedIds.has(m.id) && !customAliasIds.has(m.id),
          )
          .map((m: Record<string, unknown>) => ({
            id: m.id,
            name: m.name || m.id,
            value: `${alias}/${m.id as string}`,
            isCustom: true,
          }));

        const merged: Record<string, unknown>[] = [
          ...hardcodedModels.map((m: Record<string, unknown>) => ({
            id: m.id,
            name: m.name,
            value: `${alias}/${m.id as string}`,
            type: m.type,
          })),
          ...customAliasModels,
          ...customRegisteredModels,
        ];

        if (providerId === "kilocode") {
          const kiloDynamicModels = kiloFreeModels
            .filter((m: Record<string, unknown>) => !hardcodedIds.has(m.id))
            .map((m: Record<string, unknown>) => ({
              id: m.id,
              name: m.name || m.id,
              value: `${alias}/${m.id as string}`,
            }));
          merged.push(...kiloDynamicModels);
        }

        // Dedupe by value (alias may equal hardcoded id, causing React key collision)
        const seen = new Set<string>();
        let allModels = filterByKind(
          merged.filter((m: Record<string, unknown>) => {
            if (seen.has(m.value as string)) return false;
            seen.add(m.value as string);
            return true;
          }),
        );

        // Provider-as-model fallback: providers that support the kind but have no hardcoded models
        // can still be picked (value = providerAlias). Skips embedding (always needs model).
        if (allModels.length === 0 && kindFilter && ALLOW_PROVIDER_FALLBACK_KINDS.has(kindFilter)) {
          const supports = ((providerInfo.serviceKinds as string[]) || ["llm"]).includes(
            kindFilter,
          );
          if (supports) {
            allModels = [{ id: providerId, name: providerInfo.name as string, value: alias }];
          }
        }

        if (allModels.length > 0) {
          (groups as Record<string, unknown>)[providerId] = {
            name: providerInfo.name,
            alias: alias,
            color: providerInfo.color,
            models: allModels,
          };
        }
      }
    });

    // Filter out disabled models per provider (disabled keyed by storage alias OR providerId)
    Object.entries(groups).forEach(([providerId, group]: [string, unknown]) => {
      const g = group as Record<string, unknown>;
      const aliasKey = getProviderAlias(providerId);
      const disabledIds = new Set([
        ...((disabledModels[aliasKey] as string[]) || []),
        ...((disabledModels[providerId] as string[]) || []),
      ]);
      if (disabledIds.size === 0) return;
      g.models = (g.models as Record<string, unknown>[]).filter(
        (m: Record<string, unknown>) => !disabledIds.has(m.id as string),
      );
      if ((g.models as Record<string, unknown>[]).length === 0)
        delete (groups as Record<string, Record<string, unknown>>)[providerId];
    });

    return groups;
  }, [
    filteredActiveProviders,
    modelAliases,
    allProviders,
    providerNodes,
    customModels,
    kiloFreeModels,
    disabledModels,
    kindFilter,
    activeProviders,
  ]);

  // Filter combos by search query (and hide combos when kindFilter is set — combos are LLM-only by design)
  const filteredCombos = useMemo(() => {
    if (kindFilter) return [];
    if (!searchQuery.trim()) return combos;
    const query = searchQuery.toLowerCase();
    return combos.filter((c: Record<string, unknown>) =>
      (c.name as string).toLowerCase().includes(query),
    );
  }, [combos, searchQuery, kindFilter]);

  // Filter models by search query
  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return groupedModels;

    const query = searchQuery.toLowerCase();
    const filtered: Record<string, unknown> = {};

    Object.entries(groupedModels).forEach(([providerId, group]: [string, unknown]) => {
      const g = group as Record<string, unknown>;
      const matchedModels = (g.models as Record<string, unknown>[]).filter(
        (m: Record<string, unknown>) =>
          (m.name as string).toLowerCase().includes(query) ||
          (m.id as string).toLowerCase().includes(query),
      );

      const providerNameMatches = (g.name as string).toLowerCase().includes(query);

      if (matchedModels.length > 0 || providerNameMatches) {
        filtered[providerId] = {
          ...g,
          models: matchedModels,
        };
      }
    });

    return filtered;
  }, [groupedModels, searchQuery]);

  const handleSelect = (model: Record<string, unknown> | string) => {
    const value =
      typeof model === "string"
        ? model
        : (model?.value as string) || (model?.name as string) || String(model);
    const isAdded = addedModelValues.includes(value);

    if (isAdded && onDeselect) {
      onDeselect(model);
    } else {
      onSelect?.(model);
    }

    if (closeOnSelect) {
      onClose?.();
      setSearchQuery("");
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        onClose?.();
        setSearchQuery("");
      }}
      title={title}
      size="md"
      className="p-4!"
      footer={
        !closeOnSelect ? (
          <Button
            onClick={() => {
              onClose?.();
              setSearchQuery("");
            }}
            fullWidth
          >
            Done
          </Button>
        ) : null
      }
    >
      {/* Search - compact */}
      <div className="mb-3">
        <div className="relative">
          <LucideIcon
            name="search"
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted text-[16px]"
          />
          <input
            aria-label="Search models"
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 bg-surface border border-border rounded text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
            name="search"
          />
        </div>
      </div>

      {/* Models grouped by provider - compact */}
      <div className="max-h-[400px] overflow-y-auto space-y-3">
        {/* Combos section - always first */}
        {filteredCombos.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-1.5 sticky top-0 bg-surface py-0.5">
              <LucideIcon name="layers" className="text-primary text-[14px]" />
              <span className="text-xs font-medium text-primary">Combos</span>
              <span className="text-[10px] text-text-muted">({filteredCombos.length})</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {filteredCombos.map((combo: Record<string, unknown>) => {
                const comboName = combo.name as string;
                const comboId = combo.id as string;
                const isSelected = selectedModel === comboName;
                return (
                  <button
                    key={comboId}
                    onClick={() =>
                      handleSelect({ id: comboName, name: comboName, value: comboName })
                    }
                    className={`
                      px-2 py-1 rounded-xl text-xs font-medium transition-all border hover:cursor-pointer flex items-center gap-1
                      ${
                        isSelected
                          ? "bg-primary text-primary-fg border-primary"
                          : addedModelValues.includes(comboName)
                            ? "bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-400 hover:border-green-500/50"
                            : "bg-surface border-border text-text-main hover:border-primary/50 hover:bg-primary/5"
                      }
                    `}
                  >
                    {addedModelValues.includes(comboName) && (
                      <LucideIcon name="check_circle" className="text-[12px]" />
                    )}
                    {comboName}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Provider models */}
        {Object.entries(filteredGroups).map(([providerId, group]) => {
          const g = group as Record<string, unknown>;
          return (
            <div key={providerId}>
              {/* Provider header */}
              <div className="flex items-center gap-1.5 mb-1.5 sticky top-0 bg-surface py-0.5">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: g.color as string }}
                />
                <span className="text-xs font-medium text-primary">{g.name as string}</span>
                <span className="text-[10px] text-text-muted">
                  ({(g.models as Array<unknown>).length})
                </span>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {(g.models as Array<Record<string, unknown>>).map(
                  (model: Record<string, unknown>) => {
                    const modelValue = model.value as string;
                    const isPlaceholder = !!model.isPlaceholder;
                    const isSelected = selectedModel === modelValue;
                    const isCustom = !!model.isCustom;
                    const modelName = model.name as string;
                    return (
                      <button
                        key={modelValue}
                        onClick={() => handleSelect(model)}
                        title={
                          isPlaceholder
                            ? "Select to pre-fill, then edit model ID in the input"
                            : undefined
                        }
                        className={`
                      px-2 py-1 rounded-xl text-xs font-medium transition-all border hover:cursor-pointer
                      ${
                        isPlaceholder
                          ? "border-dashed border-border text-text-muted hover:border-primary/50 hover:text-primary bg-surface italic"
                          : isSelected
                            ? "bg-primary text-primary-fg border-primary"
                            : addedModelValues.includes(modelValue)
                              ? "bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-400 hover:border-green-500/50"
                              : "bg-surface border-border text-text-main hover:border-primary/50 hover:bg-primary/5"
                      }
                    `}
                      >
                        <span className="flex items-center gap-1">
                          {addedModelValues.includes(modelValue) && !isPlaceholder && (
                            <LucideIcon name="check_circle" className="text-[12px]" />
                          )}
                          {isPlaceholder ? (
                            <>
                              <LucideIcon name="edit" className="text-[11px]" />
                              {modelName}
                            </>
                          ) : isCustom ? (
                            <>
                              {modelName}
                              <span className="text-[9px] opacity-60 font-normal">custom</span>
                            </>
                          ) : (
                            modelName
                          )}
                        </span>
                      </button>
                    );
                  },
                )}
              </div>
            </div>
          );
        })}

        {Object.keys(filteredGroups).length === 0 && filteredCombos.length === 0 && (
          <div className="text-center py-4 text-text-muted">
            <LucideIcon name="search_off" className="text-2xl mb-1 block" />
            <p className="text-xs">No models found</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

ModelSelectModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSelect: PropTypes.func.isRequired,
  onDeselect: PropTypes.func,
  selectedModel: PropTypes.string,
  activeProviders: PropTypes.arrayOf(
    PropTypes.shape({
      provider: PropTypes.string.isRequired,
    }),
  ),
  title: PropTypes.string,
  modelAliases: PropTypes.object,
  kindFilter: PropTypes.string,
  addedModelValues: PropTypes.arrayOf(PropTypes.string),
  closeOnSelect: PropTypes.bool,
};
