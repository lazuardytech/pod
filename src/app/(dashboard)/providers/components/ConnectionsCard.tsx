"use client";

import PropTypes from "prop-types";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Badge,
  Button,
  Card,
  EditConnectionModal,
  Modal,
  Select,
  Toggle,
} from "@/shared/components";
import LucideIcon from "@/shared/components/LucideIcon";
import { ConfirmModal } from "@/shared/components/Modal";

type ProxyPoolItem = {
  id: string;
  name: string;
  proxyUrl?: string;
  noProxy?: string;
  isActive?: boolean;
};

type ProviderSpecificData = {
  proxyPoolId?: string | null;
  connectionProxyEnabled?: boolean;
  connectionProxyUrl?: string;
  connectionNoProxy?: string;
  [key: string]: unknown;
};

type DashboardConnection = {
  id: string;
  provider?: string;
  name?: string | null;
  email?: string;
  displayName?: string;
  testStatus?: string;
  isActive?: boolean;
  lastError?: string;
  priority?: number | null;
  providerSpecificData?: ProviderSpecificData;
  [key: string]: unknown;
};

type ConfirmDialogState = {
  open: boolean;
  title: string;
  message: string;
  onConfirm: (() => void) | null;
  variant: string;
};

type ApiKeyFormData = {
  name: string;
  apiKey: string;
  priority: number;
  proxyPoolId: string | null;
  testStatus?: string;
};

// ── CooldownTimer ──────────────────────────────────────────────
function CooldownTimer({ until }: { until: string | number | Date }) {
  const [remaining, setRemaining] = useState("");

  useEffect(() => {
    const update = () => {
      const diff = new Date(until).getTime() - Date.now();
      if (diff <= 0) {
        setRemaining("");
        return;
      }
      const s = Math.floor(diff / 1000);
      if (s < 60) setRemaining(`${s}s`);
      else if (s < 3600) setRemaining(`${Math.floor(s / 60)}m ${s % 60}s`);
      else setRemaining(`${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`);
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [until]);

  if (!remaining) return null;
  return <span className="text-xs text-orange-500 font-mono">⏱ {remaining}</span>;
}

CooldownTimer.propTypes = { until: PropTypes.string.isRequired };

// ── ConnectionRow ──────────────────────────────────────────────
function ConnectionRow({
  connection,
  proxyPools,
  isOAuth,
  isFirst: _isFirst,
  isLast: _isLast,
  onMoveUp: _onMoveUp,
  onMoveDown: _onMoveDown,
  onToggleActive,
  onUpdateProxy,
  onEdit,
  onDelete,
}: {
  connection: DashboardConnection;
  proxyPools?: ProxyPoolItem[];
  isOAuth: boolean;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggleActive: (isActive: boolean) => void;
  onUpdateProxy: (poolId: string | null) => void | Promise<void>;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [showProxyDropdown, setShowProxyDropdown] = useState(false);
  const [updatingProxy, setUpdatingProxy] = useState(false);
  const [isCooldown, setIsCooldown] = useState(false);
  const proxyDropdownRef = useRef<HTMLDivElement | null>(null);

  const proxyPoolMap = new Map((proxyPools || []).map((p) => [p.id, p]));
  const boundProxyPoolId = connection.providerSpecificData?.proxyPoolId || null;
  const boundProxyPool = boundProxyPoolId
    ? (proxyPoolMap.get(boundProxyPoolId) as
        | {
            name?: string;
            proxyUrl?: string;
            noProxy?: string;
            isActive?: boolean;
          }
        | undefined)
    : null;
  const hasLegacyProxy =
    connection.providerSpecificData?.connectionProxyEnabled === true &&
    !!connection.providerSpecificData?.connectionProxyUrl;
  const hasAnyProxy = !!boundProxyPoolId || hasLegacyProxy;

  const proxyDisplayText = boundProxyPool
    ? `Pool: ${boundProxyPool.name}`
    : boundProxyPoolId
      ? `Pool: ${boundProxyPoolId} (inactive/missing)`
      : hasLegacyProxy
        ? `Legacy: ${connection.providerSpecificData?.connectionProxyUrl}`
        : "";

  let maskedProxyUrl = "";
  const rawProxyUrl =
    boundProxyPool?.proxyUrl || connection.providerSpecificData?.connectionProxyUrl;
  if (rawProxyUrl) {
    try {
      const p = new URL(rawProxyUrl);
      maskedProxyUrl = `${p.protocol}//${p.hostname}${p.port ? `:${p.port}` : ""}`;
    } catch {
      maskedProxyUrl = rawProxyUrl;
    }
  }

  const noProxyText =
    boundProxyPool?.noProxy || connection.providerSpecificData?.connectionNoProxy || "";
  const proxyBadgeVariant =
    boundProxyPool?.isActive === true
      ? "success"
      : boundProxyPoolId || hasLegacyProxy
        ? "error"
        : "default";

  const modelLockUntil =
    Object.entries(connection)
      .filter(([k]) => k.startsWith("modelLock_"))
      .map(([, v]) => v)
      .filter(Boolean)
      .sort()[0] || null;

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    const check = () => {
      const until =
        Object.entries(connection)
          .filter(([k]) => k.startsWith("modelLock_"))
          .map(([, v]) => v)
          .filter((v) => v && new Date(String(v)).getTime() > Date.now())
          .sort()[0] || null;
      setIsCooldown(!!until);
    };
    check();
    const t = modelLockUntil ? setInterval(check, 1000) : null;
    return () => {
      if (t) clearInterval(t);
    };
  }, [modelLockUntil]);
  /* eslint-enable react-hooks/exhaustive-deps */

  useEffect(() => {
    if (!showProxyDropdown) {
      return undefined;
    }
    const handler = (e: MouseEvent) => {
      if (proxyDropdownRef.current && !proxyDropdownRef.current.contains(e.target as Node))
        setShowProxyDropdown(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showProxyDropdown]);

  const effectiveStatus =
    connection.testStatus === "unavailable" && !isCooldown ? "active" : connection.testStatus;

  const getStatusVariant = () => {
    if (connection.isActive === false) return "default";
    if (effectiveStatus === "active" || effectiveStatus === "success") return "success";
    if (
      effectiveStatus === "error" ||
      effectiveStatus === "expired" ||
      effectiveStatus === "unavailable"
    )
      return "error";
    return "default";
  };

  const displayName = isOAuth
    ? connection.name || connection.email || connection.displayName || "OAuth Account"
    : connection.name;

  const handleSelectProxy = async (poolId: string) => {
    setUpdatingProxy(true);
    try {
      await onUpdateProxy(poolId === "__none__" ? null : poolId);
    } finally {
      setUpdatingProxy(false);
      setShowProxyDropdown(false);
    }
  };

  return (
    <div
      className={`group flex flex-col gap-3 p-2 rounded-lg sm:flex-row sm:items-center sm:justify-between hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors ${connection.isActive === false ? "opacity-60" : ""}`}
    >
      <div className="flex w-full min-w-0 flex-1 items-start gap-3 sm:items-center">
        <LucideIcon name={isOAuth ? "lock" : "key"} className="text-base text-text-muted" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{displayName}</p>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <Badge variant={getStatusVariant()} size="sm" dot>
              {connection.isActive === false ? "disabled" : effectiveStatus || "Unknown"}
            </Badge>
            {hasAnyProxy && (
              <Badge variant={proxyBadgeVariant} size="sm">
                Proxy
              </Badge>
            )}
            {isCooldown && connection.isActive !== false && (
              <CooldownTimer until={modelLockUntil as string} />
            )}
            {connection.lastError && connection.isActive !== false && (
              <span
                className="text-xs text-red-500 truncate max-w-[300px]"
                title={connection.lastError}
              >
                {connection.lastError}
              </span>
            )}
            <span className="text-xs text-text-muted">#{connection.priority}</span>
          </div>
          {hasAnyProxy && (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span
                className="text-[11px] text-text-muted truncate max-w-[420px]"
                title={proxyDisplayText}
              >
                {proxyDisplayText}
              </span>
              {maskedProxyUrl && (
                <code className="text-[10px] font-mono bg-black/5 dark:bg-white/5 px-1 py-0.5 rounded text-text-muted">
                  {maskedProxyUrl}
                </code>
              )}
              {noProxyText && (
                <span
                  className="text-[11px] text-text-muted truncate max-w-[320px]"
                  title={noProxyText}
                >
                  no_proxy: {noProxyText}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="flex w-full flex-wrap items-center justify-between gap-2 sm:w-auto sm:justify-end">
        <div className="flex flex-wrap gap-1">
          {(proxyPools || []).length > 0 && (
            <div className="relative" ref={proxyDropdownRef}>
              <button
                onClick={() => setShowProxyDropdown((v) => !v)}
                className={`flex flex-col items-center px-2 py-1 rounded hover:bg-black/5 dark:hover:bg-white/5 transition-colors ${hasAnyProxy ? "text-primary" : "text-text-muted hover:text-primary"}`}
                disabled={updatingProxy}
              >
                <LucideIcon
                  name={updatingProxy ? "progress_activity" : "lan"}
                  className="text-[18px]"
                />
                <span className="text-[10px] leading-tight">Proxy</span>
              </button>
              {showProxyDropdown && (
                <div className="absolute right-0 top-full mt-1 z-50 bg-bg border border-border rounded-lg shadow-lg py-1 min-w-[160px]">
                  <button
                    onClick={() => handleSelectProxy("__none__")}
                    className={`w-full text-left px-3 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/5 ${!boundProxyPoolId ? "text-primary font-medium" : "text-text-main"}`}
                  >
                    None
                  </button>
                  {(proxyPools || []).map((pool) => (
                    <button
                      key={pool.id}
                      onClick={() => handleSelectProxy(pool.id)}
                      className={`w-full text-left px-3 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/5 ${boundProxyPoolId === pool.id ? "text-primary font-medium" : "text-text-main"}`}
                    >
                      {pool.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button
            onClick={onEdit}
            className="flex flex-col items-center px-2 py-1 rounded hover:bg-black/5 dark:hover:bg-white/5 text-text-muted hover:text-primary"
          >
            <LucideIcon name="edit" className="text-[18px]" />
            <span className="text-[10px] leading-tight">Edit</span>
          </button>
          <button
            onClick={onDelete}
            className="flex flex-col items-center px-2 py-1 rounded hover:bg-red-500/10 text-red-500"
          >
            <LucideIcon name="delete" className="text-[18px]" />
            <span className="text-[10px] leading-tight">Delete</span>
          </button>
        </div>
        <Toggle
          size="sm"
          checked={connection.isActive ?? true}
          onChange={onToggleActive}
          title={(connection.isActive ?? true) ? "Disable" : "Enable"}
        />
      </div>
    </div>
  );
}

ConnectionRow.propTypes = {
  connection: PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
    email: PropTypes.string,
    displayName: PropTypes.string,
    testStatus: PropTypes.string,
    isActive: PropTypes.bool,
    lastError: PropTypes.string,
    priority: PropTypes.number,
  }).isRequired,
  proxyPools: PropTypes.array,
  isOAuth: PropTypes.bool.isRequired,
  isFirst: PropTypes.bool.isRequired,
  isLast: PropTypes.bool.isRequired,
  onMoveUp: PropTypes.func.isRequired,
  onMoveDown: PropTypes.func.isRequired,
  onToggleActive: PropTypes.func.isRequired,
  onUpdateProxy: PropTypes.func,
  onEdit: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
};

// ── AddApiKeyModal ─────────────────────────────────────────────
function AddApiKeyModal({
  isOpen,
  provider,
  providerName,
  proxyPools,
  onSave,
  onClose,
}: {
  isOpen: boolean;
  provider?: string;
  providerName?: string;
  proxyPools?: ProxyPoolItem[];
  onSave: (formData: ApiKeyFormData) => void | Promise<void>;
  onClose: () => void;
}) {
  const NONE = "__none__";
  const [formData, setFormData] = useState({
    name: "",
    apiKey: "",
    priority: 1,
    proxyPoolId: NONE,
  });
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<"success" | "failed" | null>(null);
  const [saving, setSaving] = useState(false);

  const handleValidate = async () => {
    setValidating(true);
    try {
      const res = await fetch("/api/providers/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey: formData.apiKey }),
      });
      const data = await res.json();
      setValidationResult(data.valid ? "success" : "failed");
    } catch {
      setValidationResult("failed");
    } finally {
      setValidating(false);
    }
  };

  const handleSubmit = async () => {
    if (!provider || !formData.apiKey) return;
    setSaving(true);
    try {
      let isValid = false;
      try {
        setValidating(true);
        setValidationResult(null);
        const res = await fetch("/api/providers/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider, apiKey: formData.apiKey }),
        });
        const data = await res.json();
        isValid = !!data.valid;
        setValidationResult(isValid ? "success" : "failed");
      } catch {
        setValidationResult("failed");
      } finally {
        setValidating(false);
      }
      await onSave({
        name: formData.name,
        apiKey: formData.apiKey,
        priority: formData.priority,
        proxyPoolId: formData.proxyPoolId === NONE ? null : formData.proxyPoolId,
        testStatus: isValid ? "active" : "unknown",
      });
    } finally {
      setSaving(false);
    }
  };

  if (!provider) return null;

  return (
    <Modal isOpen={isOpen} title={`Add ${providerName || provider} API Key`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div>
          <label className="text-xs text-text-muted mb-1 block">Name</label>
          <input
            aria-label="Name"
            className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="Production Key"
            name="connection-name"
          />
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="text-xs text-text-muted mb-1 block">API Key</label>
            <input
              aria-label="API Key"
              type="password"
              className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
              value={formData.apiKey}
              onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
              name="api-key"
            />
          </div>
          <div className="pt-6">
            <Button
              onClick={handleValidate}
              disabled={!formData.apiKey || validating || saving}
              variant="secondary"
            >
              {validating ? "Checking..." : "Check"}
            </Button>
          </div>
        </div>
        {validationResult && (
          <Badge variant={validationResult === "success" ? "success" : "error"}>
            {validationResult === "success" ? "Valid" : "Invalid"}
          </Badge>
        )}
        <div>
          <label className="text-xs text-text-muted mb-1 block">Priority</label>
          <input
            aria-label="Priority"
            type="number"
            className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
            value={formData.priority}
            onChange={(e) =>
              setFormData({ ...formData, priority: Number.parseInt(e.target.value) || 1 })
            }
            name="priority"
          />
        </div>
        <Select
          label="Proxy Pool"
          value={formData.proxyPoolId}
          onChange={(e) => setFormData({ ...formData, proxyPoolId: e.target.value })}
          options={[
            { value: NONE, label: "None" },
            ...(proxyPools || []).map((p) => ({ value: p.id, label: p.name })),
          ]}
        />
        <div className="flex gap-2">
          <Button
            onClick={handleSubmit}
            fullWidth
            disabled={!formData.name || !formData.apiKey || saving}
          >
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button onClick={onClose} variant="ghost" fullWidth>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

AddApiKeyModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  provider: PropTypes.string,
  providerName: PropTypes.string,
  proxyPools: PropTypes.array,
  onSave: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};

// ── ConnectionsCard ────────────────────────────────────────────
// Self-contained card: fetches, displays and manages all connections for a provider.
export default function ConnectionsCard({
  providerId,
  isOAuth,
}: {
  providerId: string;
  isOAuth?: boolean;
}) {
  const [connections, setConnections] = useState<DashboardConnection[]>([]);
  const [proxyPools, setProxyPools] = useState<ProxyPoolItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedConnection, setSelectedConnection] = useState<DashboardConnection | null>(null);
  const [providerStrategy, setProviderStrategy] = useState<string | null>(null);
  const [providerStickyLimit, setProviderStickyLimit] = useState("1");

  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>({
    open: false,
    title: "",
    message: "",
    onConfirm: null,
    variant: "default",
  });
  const openConfirm = (
    title: string,
    message: string,
    onConfirm: () => void,
    variant = "default",
  ) => setConfirmDialog({ open: true, title, message, onConfirm, variant });
  const closeConfirm = () =>
    setConfirmDialog((prev) => ({
      ...prev,
      open: false,
      onConfirm: null,
    }));

  const fetch_ = useCallback(async () => {
    try {
      const [connRes, proxyRes, settingsRes] = await Promise.all([
        fetch("/api/providers", { cache: "no-store" }),
        fetch("/api/proxy-pools?isActive=true", { cache: "no-store" }),
        fetch("/api/settings", { cache: "no-store" }),
      ]);
      const connData = await connRes.json();
      const proxyData = await proxyRes.json();
      const settingsData = settingsRes.ok ? await settingsRes.json() : {};
      if (connRes.ok)
        setConnections(
          (connData.connections || []).filter(
            (c: DashboardConnection) => c.provider === providerId,
          ),
        );
      if (proxyRes.ok) setProxyPools(proxyData.proxyPools || []);
      const override = (settingsData.providerStrategies || {})[providerId] || {};
      setProviderStrategy(override.fallbackStrategy || null);
      setProviderStickyLimit(
        override.stickyRoundRobinLimit !== null && override.stickyRoundRobinLimit !== undefined
          ? String(override.stickyRoundRobinLimit)
          : "1",
      );
    } catch (e) {
      console.error("ConnectionsCard fetch error:", e);
    } finally {
      setLoading(false);
    }
  }, [providerId]);

  useEffect(() => {
    fetch_();
  }, [fetch_]);

  const saveStrategy = async (strategy: string | null, stickyLimit: string) => {
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      const data = res.ok
        ? ((await res.json()) as { providerStrategies?: Record<string, Record<string, unknown>> })
        : {};
      const current = data.providerStrategies || {};
      const override: Record<string, unknown> = {};
      if (strategy) override.fallbackStrategy = strategy;
      if (strategy === "round-robin" && stickyLimit !== "")
        override.stickyRoundRobinLimit = Number(stickyLimit) || 3;
      const updated = { ...current };
      if (Object.keys(override).length === 0) delete updated[providerId];
      else updated[providerId] = override;
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerStrategies: updated }),
      });
    } catch (e) {
      console.error("saveStrategy error:", e);
    }
  };

  const handleSwapPriority = async (i1: number, i2: number) => {
    const a = connections[i1];
    const b = connections[i2];
    if (!a || !b) return;
    const next = [...connections];
    next[i1] = b;
    next[i2] = a;
    setConnections(next);
    try {
      await Promise.all([
        fetch(`/api/providers/${b.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ priority: i1 }),
        }),
        fetch(`/api/providers/${a.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ priority: i2 }),
        }),
      ]);
    } catch {
      await fetch_();
    }
  };

  const handleDelete = async (id: string) => {
    if (!id) return;
    try {
      const res = await fetch(`/api/providers/${id}`, { method: "DELETE" });
      if (res.ok) setConnections((prev) => prev.filter((c) => c.id !== id));
    } catch (e) {
      console.error("delete error:", e);
    }
  };

  const handleToggleActive = async (id: string, isActive: boolean) => {
    try {
      const res = await fetch(`/api/providers/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (res.ok) setConnections((prev) => prev.map((c) => (c.id === id ? { ...c, isActive } : c)));
    } catch (e) {
      console.error("toggle error:", e);
    }
  };

  const handleUpdateProxy = async (connId: string, proxyPoolId: string | null) => {
    try {
      const res = await fetch(`/api/providers/${connId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proxyPoolId: proxyPoolId || null }),
      });
      if (res.ok)
        setConnections((prev) =>
          prev.map((c) =>
            c.id === connId
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
    } catch (e) {
      console.error("proxy error:", e);
    }
  };

  const handleSaveApiKey = async (formData: ApiKeyFormData) => {
    try {
      const res = await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerId, ...formData }),
      });
      if (res.ok) {
        await fetch_();
        setShowAddModal(false);
      }
    } catch (e) {
      console.error("save apikey error:", e);
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
        await fetch_();
        setShowEditModal(false);
      }
    } catch (e) {
      console.error("update connection error:", e);
    }
  };

  if (loading)
    return (
      <Card>
        <div className="h-20 animate-pulse bg-black/5 rounded-lg" />
      </Card>
    );

  return (
    <>
      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
          <h2 className="text-lg font-semibold">Connections</h2>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-text-muted font-medium">Round Robin</span>
            <Toggle
              checked={providerStrategy === "round-robin"}
              onChange={(enabled: boolean) => {
                const strategy = enabled ? "round-robin" : null;
                setProviderStrategy(strategy);
                if (enabled && !providerStickyLimit) setProviderStickyLimit("1");
                saveStrategy(strategy, enabled ? providerStickyLimit || "1" : providerStickyLimit);
              }}
            />
            {providerStrategy === "round-robin" && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-text-muted">Sticky:</span>
                <input
                  aria-label="Sticky limit"
                  type="number"
                  min={1}
                  value={providerStickyLimit}
                  onChange={(e) => {
                    setProviderStickyLimit(e.target.value);
                    saveStrategy("round-robin", e.target.value);
                  }}
                  className="w-16 px-2 py-1 text-xs border border-border rounded-md bg-background focus:outline-none focus:border-primary"
                  name="sticky-limit"
                />
              </div>
            )}
            <Button size="sm" icon="add" onClick={() => setShowAddModal(true)}>
              Add
            </Button>
          </div>
        </div>

        {connections.length === 0 ? (
          <p className="text-sm text-text-muted">No connections yet</p>
        ) : (
          <div className="flex flex-col divide-y divide-black/[0.03] dark:divide-white/[0.03]">
            {connections.map((conn, idx) => (
              <ConnectionRow
                key={conn.id}
                connection={conn}
                proxyPools={proxyPools}
                isOAuth={!!isOAuth}
                isFirst={idx === 0}
                isLast={idx === connections.length - 1}
                onMoveUp={() => handleSwapPriority(idx, idx - 1)}
                onMoveDown={() => handleSwapPriority(idx, idx + 1)}
                onToggleActive={(isActive) => handleToggleActive(conn.id, isActive)}
                onUpdateProxy={(poolId) => handleUpdateProxy(conn.id, poolId)}
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
        )}
      </Card>

      <AddApiKeyModal
        isOpen={showAddModal}
        provider={providerId}
        providerName={providerId}
        proxyPools={proxyPools}
        onSave={handleSaveApiKey}
        onClose={() => setShowAddModal(false)}
      />
      <EditConnectionModal
        isOpen={showEditModal}
        connection={selectedConnection}
        proxyPools={proxyPools}
        onSave={handleUpdateConnection}
        onClose={() => setShowEditModal(false)}
      />
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
    </>
  );
}

ConnectionsCard.propTypes = {
  providerId: PropTypes.string.isRequired,
  isOAuth: PropTypes.bool,
};
