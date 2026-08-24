"use client";

import PropTypes from "prop-types";
import { useEffect, useRef, useState } from "react";
import { Badge, Button, Toggle } from "@/shared/components";
import LucideIcon from "@/shared/components/LucideIcon";
import CooldownTimer from "./CooldownTimer";

type ProxyPoolOption = {
  id: string;
  name?: string;
  proxyUrl?: string;
  noProxy?: string;
  isActive?: boolean;
};

type ConnectionRowItem = {
  id?: string;
  name?: string | null;
  email?: string | null;
  displayName?: string;
  testStatus?: string;
  isActive?: boolean;
  lastError?: string;
  priority?: number | null;
  globalPriority?: number | null;
  providerSpecificData?: {
    proxyPoolId?: string | null;
    connectionProxyEnabled?: boolean;
    connectionProxyUrl?: string;
    connectionNoProxy?: string;
  };
  [key: string]: unknown;
};

export default function ConnectionRow({
  connection,
  proxyPools,
  isOAuth,
  onToggleActive,
  onUpdateProxy,
  onEdit,
  onDelete,
}: {
  connection: ConnectionRowItem;
  proxyPools?: ProxyPoolOption[];
  isOAuth: boolean;
  onToggleActive: (checked: boolean) => void;
  onUpdateProxy?: (poolId: string | null) => void | Promise<void>;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [showProxyDropdown, setShowProxyDropdown] = useState(false);
  const [updatingProxy, setUpdatingProxy] = useState(false);
  const proxyDropdownRef = useRef<HTMLDivElement | null>(null);

  const proxyPoolMap = new Map((proxyPools || []).map((pool) => [pool.id, pool]));
  const boundProxyPoolId = connection.providerSpecificData?.proxyPoolId || null;
  const boundProxyPool = boundProxyPoolId
    ? (proxyPoolMap.get(boundProxyPoolId) as ProxyPoolOption | undefined)
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
  if (boundProxyPool?.proxyUrl || connection.providerSpecificData?.connectionProxyUrl) {
    const rawProxyUrl =
      boundProxyPool?.proxyUrl || connection.providerSpecificData?.connectionProxyUrl || "";
    try {
      const parsed = new URL(rawProxyUrl);
      maskedProxyUrl = `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`;
    } catch {
      maskedProxyUrl = rawProxyUrl;
    }
  }

  const noProxyText =
    boundProxyPool?.noProxy || connection.providerSpecificData?.connectionNoProxy || "";

  let proxyBadgeVariant = "default";
  if (boundProxyPool?.isActive === true) {
    proxyBadgeVariant = "success";
  } else if (boundProxyPoolId || hasLegacyProxy) {
    proxyBadgeVariant = "error";
  }

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!showProxyDropdown) {
      return undefined;
    }
    const handler = (e: MouseEvent) => {
      if (proxyDropdownRef.current && !proxyDropdownRef.current.contains(e.target as Node)) {
        setShowProxyDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showProxyDropdown]);

  const handleSelectProxy = async (poolId: string) => {
    setUpdatingProxy(true);
    try {
      await onUpdateProxy?.(poolId === "__none__" ? null : poolId);
    } finally {
      setUpdatingProxy(false);
      setShowProxyDropdown(false);
    }
  };

  const isEmail = (v: unknown): v is string =>
    typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  const displayName = isOAuth
    ? isEmail(connection.email)
      ? connection.email
      : isEmail(connection.name)
        ? connection.name
        : connection.name || connection.email || connection.displayName || "OAuth Account"
    : connection.name;

  // Use useState + useEffect for impure Date.now() to avoid calling during render
  const [isCooldown, setIsCooldown] = useState(false);

  // Get earliest model lock timestamp (useEffect handles the Date.now() comparison)
  const modelLockUntil =
    Object.entries(connection)
      .filter(([k]) => k.startsWith("modelLock_"))
      .map(([, v]) => v)
      .filter((v) => !!v)
      .sort()[0] || null;

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    const checkCooldown = () => {
      const until =
        Object.entries(connection)
          .filter(([k]) => k.startsWith("modelLock_"))
          .map(([, v]) => v)
          .filter((v) => v && new Date(String(v)).getTime() > Date.now())
          .sort()[0] || null;
      setIsCooldown(!!until);
    };

    checkCooldown();
    const interval = modelLockUntil ? setInterval(checkCooldown, 1000) : null;
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [modelLockUntil]);
  /* eslint-enable react-hooks/exhaustive-deps */

  // Determine effective status (override unavailable if cooldown expired)
  const effectiveStatus =
    connection.testStatus === "unavailable" && !isCooldown
      ? "active" // Cooldown expired u2192 treat as active
      : connection.testStatus;

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

  return (
    <div
      className={`group flex min-w-0 flex-col gap-3 rounded-lg p-2 transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02] sm:flex-row sm:items-center sm:justify-between ${connection.isActive === false ? "opacity-60" : ""}`}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2 sm:items-center sm:gap-3">
        <LucideIcon
          name={isOAuth ? "lock" : "key"}
          className="shrink-0 text-base text-text-muted"
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{displayName}</p>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 sm:gap-2">
            <Badge variant={getStatusVariant()} size="sm" dot>
              {connection.isActive === false ? "disabled" : effectiveStatus || "Unknown"}
            </Badge>
            {hasAnyProxy && (
              <Badge variant={proxyBadgeVariant} size="sm">
                Proxy
              </Badge>
            )}
            {isCooldown && connection.isActive !== false && modelLockUntil !== null && (
              <CooldownTimer until={String(modelLockUntil)} />
            )}
            {connection.lastError && connection.isActive !== false && (
              <span
                className="max-w-full truncate text-xs text-red-500 sm:max-w-[300px]"
                title={connection.lastError}
              >
                {connection.lastError}
              </span>
            )}
            <span className="text-xs text-text-muted">#{connection.priority}</span>
            {connection.globalPriority && (
              <span className="text-xs text-text-muted">Auto: {connection.globalPriority}</span>
            )}
          </div>
          {hasAnyProxy && (
            <div className="mt-1 flex items-center gap-2 flex-wrap">
              <span
                className="max-w-full truncate text-[11px] text-text-muted sm:max-w-[420px]"
                title={proxyDisplayText}
              >
                {proxyDisplayText}
              </span>
              {maskedProxyUrl && (
                <code className="max-w-full truncate rounded bg-black/5 px-1 py-0.5 font-mono text-[10px] text-text-muted dark:bg-white/5 sm:max-w-[260px]">
                  {maskedProxyUrl}
                </code>
              )}
              {noProxyText && (
                <span
                  className="max-w-full truncate text-[11px] text-text-muted sm:max-w-[320px]"
                  title={noProxyText}
                >
                  no_proxy: {noProxyText}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
        <div className="grid flex-1 grid-cols-3 gap-1 sm:flex sm:flex-none">
          {/* Proxy button with inline dropdown */}
          {(proxyPools || []).length > 0 && (
            <div className="relative" ref={proxyDropdownRef}>
              <Button
                variant="ghost"
                size="sm"
                icon="lan"
                loading={updatingProxy}
                onClick={() => setShowProxyDropdown((v) => !v)}
                disabled={updatingProxy}
                className={`h-auto w-full flex-col gap-0 px-2 py-1 ${hasAnyProxy ? "text-primary" : "text-text-muted hover:text-primary"}`}
              >
                <span className="text-[10px] leading-tight font-normal">Proxy</span>
              </Button>
              {showProxyDropdown && (
                <div className="absolute right-0 top-full z-50 mt-1 max-w-[78vw] min-w-[160px] rounded-lg border border-border bg-bg py-1 shadow-lg">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleSelectProxy("__none__")}
                    className={`h-auto w-full justify-start rounded-none px-3 py-1.5 text-sm ${!boundProxyPoolId ? "font-medium text-primary" : "text-text-main"}`}
                  >
                    None
                  </Button>
                  {(proxyPools || []).map((pool) => (
                    <Button
                      key={pool.id}
                      variant="ghost"
                      size="sm"
                      onClick={() => handleSelectProxy(pool.id)}
                      className={`h-auto w-full justify-start rounded-none px-3 py-1.5 text-sm ${boundProxyPoolId === pool.id ? "font-medium text-primary" : "text-text-main"}`}
                    >
                      {pool.name}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            icon="edit"
            onClick={onEdit}
            className="h-auto flex-col gap-0 px-2 py-1 text-text-muted hover:text-primary"
          >
            <span className="text-[10px] leading-tight font-normal">Edit</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon="delete"
            onClick={onDelete}
            className="h-auto flex-col gap-0 px-2 py-1 text-red-500 hover:bg-red-500/10 hover:text-red-500"
          >
            <span className="text-[10px] leading-tight font-normal">Delete</span>
          </Button>
        </div>
        <Toggle
          size="sm"
          checked={connection.isActive ?? true}
          onChange={onToggleActive}
          title={(connection.isActive ?? true) ? "Disable connection" : "Enable connection"}
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
    modelLockUntil: PropTypes.string,
    testStatus: PropTypes.string,
    isActive: PropTypes.bool,
    lastError: PropTypes.string,
    priority: PropTypes.number,
    globalPriority: PropTypes.number,
  }).isRequired,
  proxyPools: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string,
      name: PropTypes.string,
      proxyUrl: PropTypes.string,
      noProxy: PropTypes.string,
      isActive: PropTypes.bool,
    }),
  ),
  isOAuth: PropTypes.bool.isRequired,
  onToggleActive: PropTypes.func.isRequired,
  onUpdateProxy: PropTypes.func,
  onEdit: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
};
