"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type ChangeEvent,
} from "react";
import {
  Button,
  Card,
  CardSkeleton,
  CursorAuthModal,
  EditConnectionModal,
  GitLabAuthModal,
  IFlowCookieModal,
  KiroOAuthWrapper,
  Modal,
  NoAuthProxyCard,
  OAuthModal,
  Select,
  ShadcnSelect,
  Toggle,
} from "@/shared/components";
import LucideIcon from "@/shared/components/LucideIcon";
import { ConfirmModal } from "@/shared/components/Modal";
import { getModelsByProviderId } from "@/shared/constants/models";
import { getThinkingLevels } from "open-sse/providers/thinkingLevels.ts";
import {
  AI_PROVIDERS,
  APIKEY_PROVIDERS,
  FREE_PROVIDERS,
  FREE_TIER_PROVIDERS,
  getProviderAlias,
  isAnthropicCompatibleProvider,
  isCustomEmbeddingProvider,
  isOpenAICompatibleProvider,
  OAUTH_PROVIDERS,
  THINKING_CONFIG,
  WEB_COOKIE_PROVIDERS,
} from "@/shared/constants/providers";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { fetchSuggestedModels } from "@/shared/utils/providerModelsFetcher";
import AddApiKeyModal from "./AddApiKeyModal";
import AddCustomModelModal from "./AddCustomModelModal";
import CompatibleModelsSection from "./CompatibleModelsSection";
import ConnectionRow from "./ConnectionRow";
import EditCompatibleNodeModal from "./EditCompatibleNodeModal";
import ModelRow from "./ModelRow";

type ProviderConnectionItem = {
  id: string;
  provider: string;
  name?: string | null;
  priority?: number | null;
  isActive?: boolean;
  providerSpecificData?: {
    proxyPoolId?: string | null;
    connectionProxyEnabled?: boolean;
    connectionProxyUrl?: string;
    connectionNoProxy?: string;
  } & Record<string, unknown>;
};

type ProviderNodeItem = {
  id: string;
  type: string;
  name: string;
  prefix?: string;
  apiType?: string;
  baseUrl?: string;
  previousIds?: string[];
};

type ProxyPoolOption = {
  id: string;
  name: string;
};

type ModelAliasMap = Record<string, string>;

type ProviderStrategyOverride = {
  strategy?: string;
  stickyLimit?: number | string;
  fallbackStrategy?: string | null;
  stickyRoundRobinLimit?: number | string | null;
};

type ThinkingConfigOverride = {
  mode?: string;
  effort?: string;
  effortMode?: string;
};

type ModelDescriptor = {
  id: string;
  name?: string;
  type?: string;
  isFree?: boolean;
  contextLength?: number;
};

type ProviderInfoView = {
  id: string;
  name: string;
  color?: string;
  textIcon?: string;
  icon?: string;
  apiType?: string;
  baseUrl?: string;
  type?: string;
  alias?: string;
  website?: string;
  notice?: { text?: string; apiKeyUrl?: string; signupUrl?: string };
  apiKeyUrl?: string;
  signupUrl?: string;
  passthroughModels?: boolean;
  noAuth?: boolean;
  deprecated?: boolean;
  deprecationNotice?: string;
  authType?: string;
  authHint?: string;
};

type ConfirmDialogState = {
  open: boolean;
  title: string;
  message: string;
  onConfirm: (() => void) | null;
  variant: string;
};

export default function ProviderDetailPage() {
  const params = useParams();
  const router = useRouter();
  // todo(ts): useParams id is string|string[]; route guarantees a single segment
  const providerId = params.id as string;
  const [connections, setConnections] = useState<ProviderConnectionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [providerNode, setProviderNode] = useState<ProviderNodeItem | null>(null);
  const [proxyPools, setProxyPools] = useState<ProxyPoolOption[]>([]);
  const [showOAuthModal, setShowOAuthModal] = useState(false);
  const [showIFlowCookieModal, setShowIFlowCookieModal] = useState(false);
  const [showAddApiKeyModal, setShowAddApiKeyModal] = useState(false);
  const [addConnectionError, setAddConnectionError] = useState("");
  const [showEditModal, setShowEditModal] = useState(false);
  const [showEditNodeModal, setShowEditNodeModal] = useState(false);
  const [showBulkProxyModal, setShowBulkProxyModal] = useState(false);
  const [selectedConnection, setSelectedConnection] = useState<ProviderConnectionItem | null>(null);
  const [modelAliases, setModelAliases] = useState<ModelAliasMap>({});
  const [headerImgError, setHeaderImgError] = useState(false);
  const [modelTestResults, setModelTestResults] = useState<Record<string, string>>({});
  const [modelsTestError, setModelsTestError] = useState("");
  const [testingModelIds, setTestingModelIds] = useState<Set<string>>(new Set());
  const [showAddCustomModel, setShowAddCustomModel] = useState(false);
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<string[]>([]);
  const [bulkProxyPoolId, setBulkProxyPoolId] = useState("__none__");
  const [bulkUpdatingProxy, setBulkUpdatingProxy] = useState(false);
  const [providerStrategy, setProviderStrategy] = useState<string | null>(null); // null = use global, "round-robin" = override
  const [providerStickyLimit, setProviderStickyLimit] = useState("");
  const [thinkingMode, setThinkingMode] = useState("auto");
  const [effortMode, setEffortMode] = useState("default");
  const [suggestedModels, setSuggestedModels] = useState<ModelDescriptor[]>([]);
  const [kiloFreeModels, setKiloFreeModels] = useState<ModelDescriptor[]>([]);
  const [disabledModelIds, setDisabledModelIds] = useState<string[]>([]);
  const { copied, copy } = useCopyToClipboard();
  const thinkingEffortOptions = [
    { value: "default", label: "Default" },
    { value: "none", label: "None" },
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
    { value: "xhigh", label: "xHigh" },
    { value: "max", label: "Max" },
  ];

  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>({
    open: false,
    title: "",
    message: "",
    onConfirm: null as (() => void) | null,
    variant: "default",
  });
  const openConfirm = (
    title: string,
    message: string,
    onConfirm: () => void,
    variant: string = "default",
  ) => setConfirmDialog({ open: true, title, message, onConfirm, variant });
  const closeConfirm = () =>
    setConfirmDialog((prev) => ({
      ...prev,
      open: false,
      onConfirm: null as (() => void) | null,
    }));

  const resolveThinkingSuffix = (modelId: string): string | null => {
    if (!effortMode || effortMode === "default" || effortMode === "auto") return null;
    const levels = getThinkingLevels(providerId, modelId);
    return levels?.includes(effortMode) ? effortMode : null;
  };

  const providerInfo = (
    providerNode
      ? {
          id: providerNode.id,
          name:
            providerNode.name ||
            (providerNode.type === "anthropic-compatible"
              ? "Anthropic Compatible"
              : "OpenAI Compatible"),
          color: providerNode.type === "anthropic-compatible" ? "#D97757" : "#10A37F",
          textIcon: providerNode.type === "anthropic-compatible" ? "AC" : "OC",
          apiType: providerNode.apiType,
          baseUrl: providerNode.baseUrl,
          type: providerNode.type,
        }
      : OAUTH_PROVIDERS[providerId] ||
        APIKEY_PROVIDERS[providerId] ||
        FREE_PROVIDERS[providerId] ||
        FREE_TIER_PROVIDERS[providerId] ||
        WEB_COOKIE_PROVIDERS[providerId]
  ) as ProviderInfoView | undefined;
  const isOAuth = !!OAUTH_PROVIDERS[providerId] || !!FREE_PROVIDERS[providerId];
  const isFreeNoAuth = !!FREE_PROVIDERS[providerId]?.noAuth;
  const models = getModelsByProviderId(providerId);
  const providerAlias = getProviderAlias(providerId);

  const isOpenAICompatible = isOpenAICompatibleProvider(providerId);
  const isAnthropicCompatible = isAnthropicCompatibleProvider(providerId);
  const isCustomEmbedding = isCustomEmbeddingProvider(providerId);
  const isCompatible = isOpenAICompatible || isAnthropicCompatible || isCustomEmbedding;
  const _thinkingConfig = AI_PROVIDERS[providerId]?.thinkingConfig || THINKING_CONFIG.extended;

  const providerStorageAlias = isCompatible ? providerId : providerAlias;
  const providerDisplayAlias = isCompatible ? providerNode?.prefix || providerId : providerAlias;

  const fetchDisabledModels = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/models/disabled?providerAlias=${encodeURIComponent(providerStorageAlias)}`,
        {
          cache: "no-store",
        },
      );
      const data = await res.json();
      if (res.ok) setDisabledModelIds(data.ids || []);
    } catch (error) {
      console.error("Error fetching disabled models:", error);
    }
  }, [providerStorageAlias]);

  const handleDisableModel = async (modelId: string) => {
    try {
      const res = await fetch("/api/models/disabled", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerAlias: providerStorageAlias, ids: [modelId] }),
      });
      if (res.ok) await fetchDisabledModels();
    } catch (error) {
      console.error("Error disabling model:", error);
    }
  };

  const handleEnableModel = async (modelId: string) => {
    try {
      const res = await fetch(
        `/api/models/disabled?providerAlias=${encodeURIComponent(providerStorageAlias)}&id=${encodeURIComponent(modelId)}`,
        { method: "DELETE" },
      );
      if (res.ok) await fetchDisabledModels();
    } catch (error) {
      console.error("Error enabling model:", error);
    }
  };

  const handleDisableAll = async (ids: string[]) => {
    if (!ids.length) return;
    try {
      const res = await fetch("/api/models/disabled", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerAlias: providerStorageAlias, ids }),
      });
      if (res.ok) await fetchDisabledModels();
    } catch (error) {
      console.error("Error disabling all models:", error);
    }
  };

  const handleEnableAll = async () => {
    try {
      const res = await fetch(
        `/api/models/disabled?providerAlias=${encodeURIComponent(providerStorageAlias)}`,
        {
          method: "DELETE",
        },
      );
      if (res.ok) await fetchDisabledModels();
    } catch (error) {
      console.error("Error enabling all models:", error);
    }
  };

  // Define callbacks BEFORE the useEffect that uses them
  const fetchAliases = useCallback(async () => {
    try {
      const res = await fetch("/api/models/alias");
      const data = await res.json();
      if (res.ok) {
        setModelAliases(data.aliases || {});
      }
    } catch (error) {
      console.error("Error fetching aliases:", error);
    }
  }, []);

  // Fetch free models from Kilo API for kilocode provider
  useEffect(() => {
    if (providerId !== "kilocode") return;
    fetch("/api/providers/kilo/free-models")
      .then((res) => res.json())
      .then((data) => {
        if (data.models?.length) setKiloFreeModels(data.models);
      })
      .catch(() => {});
  }, [providerId]);

  /* eslint-disable react-hooks/exhaustive-deps */
  const fetchConnections = useCallback(async () => {
    try {
      const [connectionsRes, nodesRes, proxyPoolsRes, settingsRes] = await Promise.all([
        fetch("/api/providers", { cache: "no-store" }),
        fetch("/api/provider-nodes", { cache: "no-store" }),
        fetch("/api/proxy-pools?isActive=true", { cache: "no-store" }),
        fetch("/api/settings", { cache: "no-store" }),
      ]);
      const connectionsData = await connectionsRes.json();
      const nodesData = await nodesRes.json();
      const proxyPoolsData = await proxyPoolsRes.json();
      const settingsData = settingsRes.ok ? await settingsRes.json() : {};
      if (connectionsRes.ok) {
        const filtered = (connectionsData.connections || []).filter(
          (c: ProviderConnectionItem) => c.provider === providerId,
        );
        setConnections(filtered);
      }
      if (proxyPoolsRes.ok) {
        setProxyPools(proxyPoolsData.proxyPools || []);
      }
      // Load per-provider strategy override
      const strategies = (settingsData.providerStrategies || {}) as Record<
        string,
        ProviderStrategyOverride
      >;
      const override = strategies[providerId] || {};
      setProviderStrategy(override.fallbackStrategy || null);
      setProviderStickyLimit(
        override.stickyRoundRobinLimit !== null && override.stickyRoundRobinLimit !== undefined
          ? String(override.stickyRoundRobinLimit)
          : "1",
      );
      // Load per-provider thinking config
      const thinkingMap = (settingsData.providerThinking || {}) as Record<
        string,
        ThinkingConfigOverride
      >;
      const thinkingCfg = thinkingMap[providerId] || {};
      setThinkingMode(thinkingCfg.mode || "auto");
      const normalizedEffort =
        thinkingCfg.effortMode === "extra-high" ? "xhigh" : (thinkingCfg.effortMode ?? "default");
      setEffortMode(normalizedEffort);
      if (nodesRes.ok) {
        let node =
          (nodesData.nodes || []).find((entry: ProviderNodeItem) => entry.id === providerId) ||
          null;

        // Newly created compatible nodes can be briefly unavailable on one worker.
        // Retry a few times before showing "Provider not found".
        if (!node && isCompatible) {
          for (let attempt = 0; attempt < 3; attempt += 1) {
            await new Promise<void>((resolve) => setTimeout(resolve, 150));
            const retryRes = await fetch("/api/provider-nodes", { cache: "no-store" });
            if (!retryRes.ok) continue;
            const retryData = await retryRes.json();
            node =
              (retryData.nodes || []).find((entry: ProviderNodeItem) => entry.id === providerId) ||
              null;
            if (node) break;
          }
        }

        // URL bookmark fallback: a node whose identifier was renamed keeps the
        // old id in its `previousIds` list — redirect to its current id.
        if (!node) {
          const renamed = (nodesData.nodes || []).find(
            (entry: ProviderNodeItem) =>
              Array.isArray(entry.previousIds) && entry.previousIds.includes(providerId),
          );
          if (renamed) {
            router.replace(`/providers/${renamed.id}`);
            return;
          }
        }

        setProviderNode(node);
      }
    } catch (error) {
      console.error("Error fetching connections:", error);
    } finally {
      setLoading(false);
    }
  }, [providerId, isCompatible]);
  /* eslint-enable react-hooks/exhaustive-deps */

  const handleUpdateNode = async (formData: Record<string, unknown>) => {
    try {
      const res = await fetch(`/api/provider-nodes/${providerId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      const data = await res.json();
      if (res.ok) {
        setProviderNode(data.node);
        await fetchConnections();
        setShowEditNodeModal(false);
      }
    } catch (error) {
      console.error("Error updating provider node:", error);
    }
  };

  const handleRenameNode = async (newId: string) => {
    const res = await fetch(`/api/provider-nodes/${providerId}/rename`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newId }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error || "Failed to rename provider node");
    }
    setShowEditNodeModal(false);
    // Navigate to the new identifier URL — fetchConnections will pick up the
    // renamed node from the fresh providerId.
    router.replace(`/providers/${data.node.id}`);
  };

  const saveProviderStrategy = async (strategy: string | null, stickyLimit: string) => {
    try {
      const settingsRes = await fetch("/api/settings", { cache: "no-store" });
      const settingsData = settingsRes.ok ? await settingsRes.json() : {};
      // todo(ts): settings payload shape lives outside the client
      const current: Record<string, ProviderStrategyOverride> =
        (settingsData.providerStrategies as Record<string, ProviderStrategyOverride>) || {};

      // Build override: null strategy means remove override, use global
      // todo(ts): untyped override object; widening to any to avoid the empty-literal type
      const override: ProviderStrategyOverride = {};
      if (strategy) override.fallbackStrategy = strategy;
      if (strategy === "round-robin" && stickyLimit !== "") {
        override.stickyRoundRobinLimit = Number(stickyLimit) || 3;
      }

      const updated = { ...current };
      if (Object.keys(override).length === 0) {
        delete updated[providerId];
      } else {
        updated[providerId] = override;
      }

      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerStrategies: updated }),
      });
    } catch (error) {
      console.error("Error saving provider strategy:", error);
    }
  };

  const handleRoundRobinToggle = (enabled: boolean) => {
    const strategy = enabled ? "round-robin" : null;
    const sticky = enabled ? providerStickyLimit || "1" : providerStickyLimit;
    if (enabled && !providerStickyLimit) setProviderStickyLimit("1");
    setProviderStrategy(strategy);
    saveProviderStrategy(strategy, sticky);
  };

  const handleStickyLimitChange = (value: string) => {
    setProviderStickyLimit(value);
    saveProviderStrategy("round-robin", value);
  };

  const saveThinkingConfig = async (mode: string, effort: string) => {
    try {
      const settingsRes = await fetch("/api/settings", { cache: "no-store" });
      const settingsData = settingsRes.ok ? await settingsRes.json() : {};
      // todo(ts): settings payload shape lives outside the client
      const current: Record<string, ThinkingConfigOverride> =
        (settingsData.providerThinking as Record<string, ThinkingConfigOverride>) || {};
      const updated = { ...current };
      const cfg: ThinkingConfigOverride = {};
      if (mode && mode !== "auto") cfg.mode = mode;
      if (effort && effort !== "default") cfg.effortMode = effort;
      if (Object.keys(cfg).length === 0) {
        delete updated[providerId];
      } else {
        updated[providerId] = cfg;
      }
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerThinking: updated }),
      });
    } catch (error) {
      console.error("Error saving thinking config:", error);
    }
  };

  const _handleThinkingModeChange = (mode: string) => {
    setThinkingMode(mode);
    saveThinkingConfig(mode, effortMode);
  };

  const handleEffortModeChange = (effort: string) => {
    setEffortMode(effort);
    saveThinkingConfig(thinkingMode, effort);
  };

  useEffect(() => {
    fetchConnections();
    fetchAliases();
    fetchDisabledModels();
  }, [fetchConnections, fetchAliases, fetchDisabledModels]);

  // Fetch suggested models from provider's public API (if configured)
  useEffect(() => {
    const fetcher = (
      OAUTH_PROVIDERS[providerId] ||
      APIKEY_PROVIDERS[providerId] ||
      FREE_PROVIDERS[providerId] ||
      FREE_TIER_PROVIDERS[providerId]
    )?.modelsFetcher;
    if (!fetcher) return;
    fetchSuggestedModels(fetcher).then(setSuggestedModels);
  }, [providerId]);

  const handleSetAlias = async (
    modelId: string,
    alias: string,
    providerAliasOverride: string = providerAlias,
  ) => {
    const fullModel = `${providerAliasOverride}/${modelId}`;
    try {
      const res = await fetch("/api/models/alias", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: fullModel, alias }),
      });
      if (res.ok) {
        await fetchAliases();
      } else {
        const data = await res.json();
        alert(data.error || "Failed to set alias");
      }
    } catch (error) {
      console.error("Error setting alias:", error);
    }
  };

  const handleDeleteAlias = async (alias: string) => {
    try {
      const res = await fetch(`/api/models/alias?alias=${encodeURIComponent(alias)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        await fetchAliases();
      }
    } catch (error) {
      console.error("Error deleting alias:", error);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/providers/${id}`, { method: "DELETE" });
      if (res.ok) {
        setConnections(connections.filter((c) => c.id !== id));
      }
    } catch (error) {
      console.error("Error deleting connection:", error);
    }
  };

  const handleOAuthSuccess = () => {
    fetchConnections();
    setShowOAuthModal(false);
  };

  const handleIFlowCookieSuccess = () => {
    fetchConnections();
    setShowIFlowCookieModal(false);
  };

  const handleSaveApiKey = async (formData: Record<string, unknown>) => {
    setAddConnectionError("");
    try {
      const res = await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerId, ...formData }),
      });

      let data: Record<string, unknown> | null = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      if (res.ok) {
        await fetchConnections();
        setShowAddApiKeyModal(false);
        return;
      }

      setAddConnectionError(
        typeof data?.error === "string" ? data.error : "Failed to save connection",
      );
    } catch (error) {
      console.error("Error saving connection:", error);
      setAddConnectionError("Failed to save connection");
    }
  };

  const handleUpdateConnection = async (formData: Record<string, unknown>) => {
    if (!selectedConnection) return;
    try {
      const res = await fetch(`/api/providers/${selectedConnection.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (res.ok) {
        await fetchConnections();
        setShowEditModal(false);
      }
    } catch (error) {
      console.error("Error updating connection:", error);
    }
  };

  const handleUpdateConnectionStatus = async (id: string, isActive: boolean) => {
    try {
      const res = await fetch(`/api/providers/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (res.ok) {
        setConnections((prev) => prev.map((c) => (c.id === id ? { ...c, isActive } : c)));
      }
    } catch (error) {
      console.error("Error updating connection status:", error);
    }
  };

  const _handleSwapPriority = async (index1: number, index2: number) => {
    // Optimistic update state
    const a = connections[index1];
    const b = connections[index2];
    if (!a || !b) return;
    const newConnections = [...connections];
    newConnections[index1] = b;
    newConnections[index2] = a;
    setConnections(newConnections);

    try {
      await Promise.all([
        fetch(`/api/providers/${b.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ priority: index1 }),
        }),
        fetch(`/api/providers/${a.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ priority: index2 }),
        }),
      ]);
    } catch (error) {
      console.error("Error swapping priority:", error);
      await fetchConnections();
    }
  };

  const selectedConnections = connections.filter((conn) => selectedConnectionIds.includes(conn.id));
  const allSelected = connections.length > 0 && selectedConnectionIds.length === connections.length;

  const _toggleSelectConnection = (connectionId: string) => {
    setSelectedConnectionIds((prev) =>
      prev.includes(connectionId)
        ? prev.filter((id) => id !== connectionId)
        : [...prev, connectionId],
    );
  };

  const _toggleSelectAllConnections = () => {
    if (allSelected) {
      setSelectedConnectionIds([]);
      return;
    }
    setSelectedConnectionIds(connections.map((conn) => conn.id));
  };

  const clearSelection = () => {
    setSelectedConnectionIds([]);
    setBulkProxyPoolId("__none__");
  };

  useEffect(() => {
    setSelectedConnectionIds((prev) =>
      prev.filter((id) => connections.some((conn) => conn.id === id)),
    );
  }, [connections]);

  const selectedProxySummary = (() => {
    if (selectedConnections.length === 0) return "";
    const poolIds = new Set(
      selectedConnections.map((conn) => conn.providerSpecificData?.proxyPoolId || "__none__"),
    );
    if (poolIds.size === 1) {
      const onlyId = [...poolIds][0];
      if (onlyId === "__none__") return "All selected currently unbound";
      const pool = proxyPools.find((p) => p.id === onlyId);
      return `All selected currently bound to ${pool?.name || onlyId}`;
    }
    return "Selected connections have mixed proxy bindings";
  })();

  const _openBulkProxyModal = () => {
    if (selectedConnections.length === 0) return;
    const uniquePoolIds = [
      ...new Set(
        selectedConnections.map((conn) => conn.providerSpecificData?.proxyPoolId || "__none__"),
      ),
    ];
    setBulkProxyPoolId(uniquePoolIds.length === 1 ? (uniquePoolIds[0] ?? "__none__") : "__none__");
    setShowBulkProxyModal(true);
  };

  const closeBulkProxyModal = () => {
    if (bulkUpdatingProxy) return;
    setShowBulkProxyModal(false);
  };

  const handleBulkApplyProxyPool = async () => {
    if (selectedConnectionIds.length === 0) return;

    const proxyPoolId: string | null = bulkProxyPoolId === "__none__" ? null : bulkProxyPoolId;
    setBulkUpdatingProxy(true);
    try {
      const results: boolean[] = [];
      for (const connectionId of selectedConnectionIds) {
        try {
          const res = await fetch(`/api/providers/${connectionId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ proxyPoolId }),
          });
          results.push(res.ok);
        } catch (e) {
          console.error("Error applying bulk proxy pool for", connectionId, e);
          results.push(false);
        }
      }

      const failedCount = results.filter((ok) => !ok).length;
      if (failedCount > 0) {
        alert(`Updated with ${failedCount} failed request(s).`);
      }

      await fetchConnections();
      clearSelection();
      setShowBulkProxyModal(false);
    } catch (error) {
      console.error("Error applying bulk proxy pool:", error);
    } finally {
      setBulkUpdatingProxy(false);
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = connections.findIndex((c) => c.id === active.id);
    const newIndex = connections.findIndex((c) => c.id === over.id);
    const reordered = arrayMove(connections, oldIndex, newIndex);
    setConnections(reordered);

    try {
      await Promise.all(
        reordered.map((conn, i) =>
          fetch(`/api/providers/${conn.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ priority: i + 1 }),
          }),
        ),
      );
    } catch (error) {
      console.error("Error reordering connections:", error);
      await fetchConnections();
    }
  };

  const _isSelected = (connectionId: string) => selectedConnectionIds.includes(connectionId);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const connectionsList = (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={connections.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <div className="flex min-w-0 flex-col divide-y divide-black/[0.03] dark:divide-white/[0.03]">
          {connections.map((conn, _index) => (
            <SortableConnectionRow
              key={conn.id}
              conn={conn}
              proxyPools={proxyPools}
              isOAuth={isOAuth}
              onToggleActive={(isActive: boolean) =>
                handleUpdateConnectionStatus(conn.id, isActive)
              }
              onUpdateProxy={async (proxyPoolId: string | null) => {
                try {
                  const res = await fetch(`/api/providers/${conn.id}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ proxyPoolId: proxyPoolId || null }),
                  });
                  if (res.ok) {
                    setConnections((prev) =>
                      prev.map((c) =>
                        c.id === conn.id
                          ? {
                              ...c,
                              providerSpecificData: {
                                ...c.providerSpecificData,
                                proxyPoolId: proxyPoolId || null,
                              },
                            }
                          : c,
                      ),
                    );
                  }
                } catch (error) {
                  console.error("Error updating proxy:", error);
                }
              }}
              onEdit={() => {
                setSelectedConnection(conn);
                setShowEditModal(true);
              }}
              onDelete={() =>
                openConfirm(
                  "Delete Connection",
                  "Are you sure you want to delete this connection?",
                  () => handleDelete(conn.id),
                  "danger",
                )
              }
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );

  const bulkProxyOptions = [
    { value: "__none__", label: "None" },
    ...proxyPools.map((pool) => ({ value: pool.id, label: pool.name })),
  ];

  const bulkHint =
    selectedConnectionIds.length === 0
      ? "Select one or more connections, then click Proxy Action."
      : selectedProxySummary;

  const canApplyBulkProxy = selectedConnectionIds.length > 0 && !bulkUpdatingProxy;

  const bulkActionModal = (
    <Modal
      isOpen={showBulkProxyModal}
      onClose={closeBulkProxyModal}
      title={`Proxy Action (${selectedConnectionIds.length} selected)`}
    >
      <div className="flex flex-col gap-4">
        <Select
          label="Proxy Pool"
          value={bulkProxyPoolId}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => setBulkProxyPoolId(e.target.value)}
          options={bulkProxyOptions}
          placeholder="None"
        />

        <p className="text-xs text-text-muted">{bulkHint}</p>
        <p className="text-xs text-text-muted">
          Selecting None will unbind selected connections from proxy pool.
        </p>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button onClick={handleBulkApplyProxyPool} fullWidth disabled={!canApplyBulkProxy}>
            {bulkUpdatingProxy ? "Applying..." : "Apply"}
          </Button>
          <Button
            onClick={closeBulkProxyModal}
            variant="ghost"
            fullWidth
            disabled={bulkUpdatingProxy}
          >
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );

  const handleTestModel = async (modelId: string) => {
    setTestingModelIds((prev) => new Set([...prev, modelId]));
    try {
      const res = await fetch("/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: `${providerStorageAlias}/${modelId}` }),
      });
      const data = await res.json();
      setModelTestResults((prev) => ({ ...prev, [modelId]: data.ok ? "ok" : "error" }));
      setModelsTestError(data.ok ? "" : data.error || "Model not reachable");
    } catch {
      setModelTestResults((prev) => ({ ...prev, [modelId]: "error" }));
      setModelsTestError("Network error");
    } finally {
      setTestingModelIds((prev) => {
        const next = new Set(prev);
        next.delete(modelId);
        return next;
      });
    }
  };

  const renderModelsSection = () => {
    if (isCompatible) {
      return (
        <CompatibleModelsSection
          providerStorageAlias={providerStorageAlias}
          providerDisplayAlias={providerDisplayAlias}
          modelAliases={modelAliases}
          copied={copied}
          onCopy={copy}
          onSetAlias={handleSetAlias}
          onDeleteAlias={handleDeleteAlias}
          connections={connections}
          isAnthropic={isAnthropicCompatible}
          resolveThinkingSuffix={resolveThinkingSuffix}
        />
      );
    }
    // Combine hardcoded models with Kilo free models (deduplicated)
    // Exclude non-llm models (embedding, tts, etc.) — they have dedicated pages under media-providers
    const allModels = [
      ...models,
      ...kiloFreeModels.filter((fm) => !models.some((m) => m.id === fm.id)),
    ].filter((m) => !m.type || m.type === "llm");
    const disabledSet = new Set(disabledModelIds);
    const displayModels = allModels.filter((m) => !disabledSet.has(m.id));
    const disabledDisplayModels = allModels.filter((m) => disabledSet.has(m.id));
    // Custom models added by user (stored as aliases: modelId → providerAlias/modelId)
    const customModels = Object.entries(modelAliases)
      .filter(([alias, fullModel]) => {
        if (typeof fullModel !== "string") return false;
        const prefix = `${providerStorageAlias}/`;
        if (!fullModel.startsWith(prefix)) return false;
        const modelId = fullModel.slice(prefix.length);
        // Only show if not already in hardcoded list
        // For passthroughModels, include all aliases (model IDs may contain slashes like "anthropic/claude-3")
        if (providerInfo?.passthroughModels) return !models.some((m) => m.id === modelId);
        return !models.some((m) => m.id === modelId) && alias === modelId;
      })
      .map(([alias, fullModel]) => ({
        id: String(fullModel).slice(`${providerStorageAlias}/`.length),
        alias: String(alias),
        fullModel: String(fullModel),
      }));

    return (
      <div className="flex flex-wrap gap-3">
        {/* Custom models first */}
        {customModels.map((model) => (
          <ModelRow
            key={model.id}
            model={{ id: model.id }}
            fullModel={`${providerDisplayAlias}/${model.id}`}
            alias={model.alias}
            copied={copied}
            onCopy={copy}
            onSetAlias={() => {}}
            onDeleteAlias={() => handleDeleteAlias(model.alias)}
            testStatus={modelTestResults[model.id]}
            onTest={
              connections.length > 0 || isFreeNoAuth ? () => handleTestModel(model.id) : undefined
            }
            isTesting={testingModelIds.has(model.id)}
            isCustom
            isFree={false}
            thinkingSuffix={resolveThinkingSuffix(model.id)}
          />
        ))}

        {displayModels.map((model) => {
          const fullModel = `${providerStorageAlias}/${model.id}`;
          const oldFormatModel = `${providerId}/${model.id}`;
          const existingAlias = Object.entries(modelAliases).find(
            ([, m]) => m === fullModel || m === oldFormatModel,
          )?.[0];
          return (
            <ModelRow
              key={model.id}
              model={model}
              fullModel={`${providerDisplayAlias}/${model.id}`}
              alias={existingAlias}
              copied={copied}
              onCopy={copy}
              onSetAlias={(alias: string) => handleSetAlias(model.id, alias, providerStorageAlias)}
              onDeleteAlias={() => existingAlias && handleDeleteAlias(existingAlias)}
              testStatus={modelTestResults[model.id]}
              onTest={
                connections.length > 0 || isFreeNoAuth ? () => handleTestModel(model.id) : undefined
              }
              isTesting={testingModelIds.has(model.id)}
              isFree={"isFree" in model ? Boolean(model.isFree) : false}
              onDisable={() => handleDisableModel(model.id)}
              thinkingSuffix={resolveThinkingSuffix(model.id)}
            />
          );
        })}

        {/* Add model button — inline, same style as model chips */}
        <Button
          variant="outline"
          size="sm"
          icon="add"
          onClick={() => setShowAddCustomModel(true)}
          className="w-full border-dashed border-primary/40 text-primary hover:border-primary hover:bg-primary/5 sm:w-auto"
        >
          Add Model
        </Button>

        {/* Suggested models from provider API — show only models not yet added */}
        {suggestedModels.length > 0 &&
          (() => {
            const addedFullModels = new Set(Object.values(modelAliases));
            const hardcodedIds = new Set(models.map((m) => m.id));
            const notAdded = suggestedModels.filter(
              (m) =>
                !addedFullModels.has(`${providerStorageAlias}/${m.id}`) && !hardcodedIds.has(m.id),
            );
            if (notAdded.length === 0) return null;
            return (
              <div className="w-full mt-2">
                <p className="text-xs text-text-muted mb-2">
                  Suggested free models (≥200k context):
                </p>
                <div className="flex flex-wrap gap-2">
                  {notAdded.map((m) => (
                    <Button
                      key={m.id}
                      variant="outline"
                      size="sm"
                      icon="add"
                      onClick={async () => {
                        const alias = m.id.split("/").pop() || m.id;
                        await handleSetAlias(m.id, alias, providerStorageAlias);
                      }}
                      className="h-auto px-2.5 py-1.5 text-xs text-text-muted hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
                      title={`${m.name} · ${((Number(m.contextLength) || 0) / 1000).toFixed(0)}k ctx`}
                    >
                      {m.id.split("/").pop()}
                    </Button>
                  ))}
                </div>
              </div>
            );
          })()}

        {/* Disabled models — restorable */}
        {disabledDisplayModels.length > 0 && (
          <div className="w-full mt-2">
            <p className="text-xs text-text-muted mb-2">
              Disabled models ({disabledDisplayModels.length}):
            </p>
            <div className="flex flex-wrap gap-2">
              {disabledDisplayModels.map((m) => (
                <Button
                  key={m.id}
                  variant="outline"
                  size="sm"
                  icon="add"
                  onClick={() => handleEnableModel(m.id)}
                  className="h-auto border-dashed px-2.5 py-1.5 text-xs text-text-muted hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
                  title="Restore model"
                >
                  {m.id}
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-8">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  if (!providerInfo) {
    return (
      <div className="text-center py-20">
        <p className="text-text-muted">Provider not found</p>
        <Link href="/providers" className="text-primary mt-4 inline-block">
          Back to Providers
        </Link>
      </div>
    );
  }

  // Determine icon path: OpenAI Compatible providers use specialized icons
  const getHeaderIconPath = () => {
    if (isOpenAICompatible && providerInfo.apiType) {
      return providerInfo.apiType === "responses"
        ? "/providers/oai-r.png"
        : "/providers/oai-cc.png";
    }
    if (isAnthropicCompatible) {
      return "/providers/anthropic-m.png";
    }
    return `/providers/${providerInfo.id}.png`;
  };

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:gap-8 sm:px-0">
      {/* Header */}
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-white">
            {headerImgError ? (
              <span className="text-sm font-bold" style={{ color: providerInfo.color }}>
                {providerInfo.textIcon || providerInfo.id.slice(0, 2).toUpperCase()}
              </span>
            ) : (
              <Image
                src={getHeaderIconPath()}
                alt={providerInfo.name}
                width={48}
                height={48}
                className="max-h-12 max-w-12 rounded-lg object-contain"
                sizes="48px"
                onError={() => setHeaderImgError(true)}
              />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">
                {providerInfo.name}
              </h1>
              {(providerInfo.notice?.apiKeyUrl ||
                providerInfo.notice?.signupUrl ||
                providerInfo.website) && (
                <a
                  href={
                    providerInfo.notice?.apiKeyUrl ||
                    providerInfo.notice?.signupUrl ||
                    providerInfo.website
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                >
                  <LucideIcon name="open_in_new" className="text-sm" />
                  {providerInfo.notice?.apiKeyUrl ? "Get API Key" : "Sign up / Learn more"}
                </a>
              )}
            </div>
            <p className="text-text-muted">
              {connections.length} connection{connections.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>
      </div>

      {providerInfo.deprecated && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
          <LucideIcon name="warning" className="text-[16px] text-yellow-500 mt-0.5 shrink-0" />
          <p className="text-xs text-red-600 dark:text-yellow-400 leading-relaxed">
            {providerInfo.deprecationNotice}
          </p>
        </div>
      )}

      {providerInfo.notice?.text && !providerInfo.deprecated && (
        <div className="flex flex-col gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 sm:flex-row sm:items-center">
          <LucideIcon name="info" className="text-[16px] text-blue-500 shrink-0" />
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-blue-600 dark:text-blue-400">
            {providerInfo.notice.text}
          </p>
          {providerInfo.notice.apiKeyUrl && (
            <a
              href={providerInfo.notice.apiKeyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex justify-center rounded bg-blue-500 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-600 sm:py-0.5"
            >
              Get API Key →
            </a>
          )}
        </div>
      )}

      {(isCompatible || providerNode) && providerNode && (
        <Card>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold">
                {isAnthropicCompatible
                  ? "Anthropic Compatible Details"
                  : "OpenAI Compatible Details"}
              </h2>
              <p className="break-all text-sm text-text-muted">
                {isAnthropicCompatible
                  ? "Messages API"
                  : providerNode.apiType === "responses"
                    ? "Responses API"
                    : "Chat Completions"}{" "}
                · {(providerNode.baseUrl || "").replace(/\/$/, "")}/
                {isAnthropicCompatible
                  ? "messages"
                  : providerNode.apiType === "responses"
                    ? "responses"
                    : "chat/completions"}
              </p>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center">
              <Button
                size="sm"
                variant="secondary"
                icon="edit"
                onClick={() => setShowEditNodeModal(true)}
                className="w-full sm:w-auto"
              >
                Edit
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon="delete"
                onClick={() =>
                  openConfirm(
                    "Delete Compatible Node",
                    `Delete this ${isAnthropicCompatible ? "Anthropic" : "OpenAI"} Compatible node? This cannot be undone.`,
                    async () => {
                      try {
                        const res = await fetch(`/api/provider-nodes/${providerId}`, {
                          method: "DELETE",
                        });
                        if (res.ok) router.push("/providers");
                      } catch (error) {
                        console.error("Error deleting provider node:", error);
                      }
                    },
                    "danger",
                  )
                }
                className="w-full sm:w-auto"
              >
                Delete
              </Button>
            </div>
          </div>
          {connections.length > 0 && isCompatible && (
            <p className="text-sm text-text-muted">
              Each connection uses the same base URL but a different API key.
            </p>
          )}
        </Card>
      )}

      {/* Connections */}
      {isFreeNoAuth ? (
        <NoAuthProxyCard providerId={providerId} />
      ) : (
        <Card>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-semibold">Connections</h2>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
              {/* Round Robin toggle */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-text-muted font-medium">Round Robin</span>
                <Toggle
                  checked={providerStrategy === "round-robin"}
                  onChange={handleRoundRobinToggle}
                />
                {providerStrategy === "round-robin" && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-text-muted">Sticky:</span>
                    <input
                      aria-label="Sticky limit"
                      type="number"
                      min={1}
                      value={providerStickyLimit}
                      onChange={(e: ChangeEvent<HTMLInputElement>) =>
                        handleStickyLimitChange(e.target.value)
                      }
                      placeholder="1"
                      className="w-14 px-2 py-1 text-xs border border-border rounded-md bg-background focus:outline-none focus:border-primary"
                      name="sticky-limit"
                    />
                  </div>
                )}
              </div>
              {/* Thinking Effort */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-muted font-medium">Thinking Effort</span>
                <ShadcnSelect
                  ariaLabel="Thinking effort"
                  name="thinking-effort"
                  value={effortMode}
                  onValueChange={handleEffortModeChange}
                  options={thinkingEffortOptions}
                  triggerClassName="h-8 min-w-[112px] px-2.5 text-xs"
                  contentClassName="min-w-[140px]"
                />
              </div>
              <div className="flex gap-2">
                {!isCompatible && providerId === "iflow" && (
                  <Button
                    size="sm"
                    icon="cookie"
                    variant="secondary"
                    onClick={() => setShowIFlowCookieModal(true)}
                  >
                    Cookie
                  </Button>
                )}
                <Button
                  size="sm"
                  icon="add"
                  onClick={() => {
                    if (isOAuth) {
                      setShowOAuthModal(true);
                      return;
                    }
                    setAddConnectionError("");
                    setShowAddApiKeyModal(true);
                  }}
                >
                  {isCompatible
                    ? "Add API Key"
                    : providerId === "iflow"
                      ? "OAuth"
                      : "Add Connection"}
                </Button>
              </div>
            </div>
          </div>

          {connections.length === 0 ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-primary/10 text-primary shrink-0">
                  <LucideIcon name={isOAuth ? "lock" : "key"} className="text-[18px]" />
                </div>
                <p className="text-sm text-text-muted">No connections yet</p>
              </div>
            </div>
          ) : (
            <>
              {connectionsList}
              <div className="mt-4 grid grid-cols-1 gap-2 sm:flex">
                {!isCompatible && providerId === "iflow" && (
                  <Button
                    size="sm"
                    icon="cookie"
                    variant="secondary"
                    onClick={() => setShowIFlowCookieModal(true)}
                    title="Add connection using browser cookie"
                    className="w-full sm:w-auto"
                  >
                    Cookie
                  </Button>
                )}
                <Button
                  size="sm"
                  icon="add"
                  onClick={() => {
                    if (isOAuth) {
                      setShowOAuthModal(true);
                      return;
                    }
                    setAddConnectionError("");
                    setShowAddApiKeyModal(true);
                  }}
                  className="w-full sm:w-auto"
                >
                  Add
                </Button>
              </div>
            </>
          )}
        </Card>
      )}

      {/* Models */}
      <Card>
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold">{"Available Models"}</h2>
          {!isCompatible &&
            (() => {
              const allIds = [
                ...models,
                ...kiloFreeModels.filter((fm) => !models.some((m) => m.id === fm.id)),
              ]
                .filter((m) => !m.type || m.type === "llm")
                .map((m) => m.id);
              const activeIds = allIds.filter((id) => !disabledModelIds.includes(id));
              return (
                <div className="flex gap-2">
                  {disabledModelIds.length > 0 && (
                    <Button
                      size="sm"
                      variant="secondary"
                      icon="restart_alt"
                      onClick={handleEnableAll}
                    >
                      Active All
                    </Button>
                  )}
                  {activeIds.length > 0 && (
                    <Button
                      size="sm"
                      variant="secondary"
                      icon="block"
                      onClick={() =>
                        openConfirm(
                          "Disable All Models",
                          `Disable all ${activeIds.length} model(s)? They can be re-enabled individually.`,
                          () => handleDisableAll(activeIds),
                          "danger",
                        )
                      }
                    >
                      Disable All
                    </Button>
                  )}
                </div>
              );
            })()}
        </div>
        {!!modelsTestError && (
          <p className="text-xs text-red-500 mb-3 break-words">{modelsTestError}</p>
        )}
        {renderModelsSection()}
      </Card>

      {bulkActionModal}

      {/* Modals */}
      {providerId === "kiro" ? (
        <KiroOAuthWrapper
          isOpen={showOAuthModal}
          providerInfo={providerInfo}
          onSuccess={handleOAuthSuccess}
          onClose={() => setShowOAuthModal(false)}
        />
      ) : providerId === "cursor" ? (
        <CursorAuthModal
          isOpen={showOAuthModal}
          onSuccess={handleOAuthSuccess}
          onClose={() => setShowOAuthModal(false)}
        />
      ) : providerId === "gitlab" ? (
        <GitLabAuthModal
          isOpen={showOAuthModal}
          providerInfo={providerInfo}
          onSuccess={handleOAuthSuccess}
          onClose={() => setShowOAuthModal(false)}
        />
      ) : (
        <OAuthModal
          isOpen={showOAuthModal}
          provider={providerId}
          providerInfo={providerInfo as unknown as { name: string }}
          oauthMeta={undefined}
          idcConfig={undefined}
          onSuccess={handleOAuthSuccess}
          onClose={() => setShowOAuthModal(false)}
        />
      )}
      {providerId === "iflow" && (
        <IFlowCookieModal
          isOpen={showIFlowCookieModal}
          onSuccess={handleIFlowCookieSuccess}
          onClose={() => setShowIFlowCookieModal(false)}
        />
      )}
      <AddApiKeyModal
        isOpen={showAddApiKeyModal}
        provider={providerId}
        providerName={providerInfo.name}
        isCompatible={isCompatible}
        isAnthropic={isAnthropicCompatible}
        authType={providerInfo?.authType}
        authHint={providerInfo?.authHint}
        website={providerInfo?.website}
        proxyPools={proxyPools}
        error={addConnectionError}
        onSave={handleSaveApiKey}
        onClose={() => {
          setAddConnectionError("");
          setShowAddApiKeyModal(false);
        }}
      />
      <EditConnectionModal
        isOpen={showEditModal}
        connection={selectedConnection}
        proxyPools={proxyPools}
        onSave={handleUpdateConnection}
        onClose={() => setShowEditModal(false)}
      />
      {isCompatible && (
        <EditCompatibleNodeModal
          isOpen={showEditNodeModal}
          node={providerNode}
          onSave={handleUpdateNode}
          onRename={handleRenameNode}
          onClose={() => setShowEditNodeModal(false)}
          isAnthropic={isAnthropicCompatible}
        />
      )}
      {!isCompatible && (
        <AddCustomModelModal
          isOpen={showAddCustomModel}
          providerAlias={providerStorageAlias}
          providerDisplayAlias={providerDisplayAlias}
          onSave={async (modelId: string) => {
            // For passthrough providers (OpenRouter), use last segment as alias to avoid slash conflicts
            const alias = providerInfo?.passthroughModels
              ? modelId.split("/").pop() || modelId
              : modelId;
            await handleSetAlias(modelId, alias, providerStorageAlias);
            setShowAddCustomModel(false);
          }}
          onClose={() => setShowAddCustomModel(false)}
        />
      )}

      <ConfirmModal
        isOpen={confirmDialog.open}
        title={confirmDialog.title}
        message={confirmDialog.message}
        onConfirm={() => {
          confirmDialog.onConfirm?.();
          closeConfirm();
        }}
        onClose={closeConfirm}
        confirmText="Confirm"
        cancelText="Cancel"
        variant={confirmDialog.variant}
      />
    </div>
  );
}

type SortableConnectionRowProps = {
  conn: ProviderConnectionItem;
  proxyPools: ProxyPoolOption[];
  isOAuth: boolean;
  onToggleActive: (isActive: boolean) => void;
  onUpdateProxy: (proxyPoolId: string | null) => void | Promise<void>;
  onEdit: () => void;
  onDelete: () => void;
};

function SortableConnectionRow({
  conn,
  proxyPools,
  isOAuth,
  onToggleActive,
  onUpdateProxy,
  onEdit,
  onDelete,
}: SortableConnectionRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: conn.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} className="flex min-w-0 items-stretch">
      <Button
        variant="ghost"
        size="icon"
        icon="drag_indicator"
        title="Drag to reorder"
        className="flex shrink-0 cursor-grab touch-none items-center px-1.5 text-text-muted/40 transition-colors hover:text-text-muted active:cursor-grabbing"
        {...({
          ref: setActivatorNodeRef,
          ...attributes,
          ...listeners,
          tabIndex: -1,
        } as ButtonHTMLAttributes<HTMLButtonElement>)}
      />
      <div className="flex-1 min-w-0">
        <ConnectionRow
          connection={conn}
          proxyPools={proxyPools}
          isOAuth={isOAuth}
          onToggleActive={onToggleActive}
          onUpdateProxy={onUpdateProxy}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      </div>
    </div>
  );
}
