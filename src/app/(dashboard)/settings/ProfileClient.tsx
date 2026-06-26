"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button, Input, Toggle } from "@/shared/components";
import { ConfirmModal } from "@/shared/components/Modal";
import { APP_CONFIG } from "@/shared/constants/config";
import { useTheme } from "@/shared/hooks/useTheme";
import { loadJsonStaleWhileRevalidate } from "@/shared/services/offlineJsonCache";
import { mutateJsonWithOfflineQueue } from "@/shared/services/offlineMutationRequest";
import { cn } from "@/shared/utils/cn";
import LucideIcon from "@/shared/components/LucideIcon";

const OFFLINE_SETTINGS_CACHE_KEY = "settings:profile";
const OFFLINE_LEGACY_INFO_CACHE_KEY = "settings:legacy-info";
const OFFLINE_MAX_STALE_MS = 1000 * 60 * 60 * 24 * 7;

// ─── Section header ───────────────────────────────────────────────────────────
function SectionHeader({ icon, title }: any) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <LucideIcon name={icon} className="text-storm-cloud text-[16px]" />
      <h3 className="text-[13px] font-[590] text-porcelain uppercase tracking-[0.05em]">{title}</h3>
    </div>
  );
}

// ─── Card wrapper ─────────────────────────────────────────────────────────────
function Section({ children, className }: { children: any; className?: any }) {
  return <div className={cn("rounded-[6px] border border-charcoal-grey bg-graphite p-5", className)}>{children}</div>;
}

// ─── Row: label + description + right slot ────────────────────────────────────
function SettingRow({ label, description, children, border = false }: any) {
  return (
    <div
      className={cn(
        "flex items-start sm:items-center justify-between gap-4",
        border && "pt-4 border-t border-charcoal-grey",
      )}
    >
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-[510] text-porcelain">{label}</p>
        {description && <p className="text-[12px] text-storm-cloud mt-0.5">{description}</p>}
      </div>
      {children}
    </div>
  );
}

// ─── Status message ───────────────────────────────────────────────────────────
function StatusMsg({ status }: any) {
  if (!status?.message) return null;
  return (
    <p className={cn("text-[12px]", status.type === "error" ? "text-warning-red" : "text-emerald")}>{status.message}</p>
  );
}

// ─── Label for form fields ────────────────────────────────────────────────────
function FieldLabel({ children }: any) {
  return <label className="text-[13px] font-[510] text-porcelain">{children}</label>;
}

export default function ProfilePage() {
  const { theme, setTheme } = useTheme();
  const [settings, setSettings] = useState<any>({ fallbackStrategy: "fill-first" });
  const [loading, setLoading] = useState(true);
  const [passwords, setPasswords] = useState({ current: "", new: "", confirm: "" });
  const [passStatus, setPassStatus] = useState({ type: "", message: "" });
  const [passLoading, setPassLoading] = useState(false);
  const [dbLoading, setDbLoading] = useState(false);
  const [dbStatus, setDbStatus] = useState({ type: "", message: "" });
  const [confirmDialog, setConfirmDialog] = useState({
    open: false,
    title: "",
    message: "",
    onConfirm: null as (() => void) | null,
    variant: "default",
  });
  const _openConfirm = (title: any, message: any, onConfirm: any, variant: any = "default") =>
    setConfirmDialog({ open: true, title, message, onConfirm, variant });
  const closeConfirm = () => setConfirmDialog((prev: any) => ({ ...prev, open: false, onConfirm: null as (() => void) | null }));
  const [legacyInfo, setLegacyInfo] = useState({ hasLegacyData: false, legacyFilesFound: [] });
  const importFileRef = useRef<any>(null);
  const [proxyForm, setProxyForm] = useState({
    outboundProxyEnabled: false,
    outboundProxyUrl: "",
    outboundNoProxy: "",
  });
  const [proxyStatus, setProxyStatus] = useState({ type: "", message: "" });
  const [proxyLoading, setProxyLoading] = useState(false);
  const [proxyTestLoading, setProxyTestLoading] = useState(false);
  const [syncingCost, setSyncingCost] = useState(false);
  const offlineNoticeShownRef = useRef(false);

  const notifyOfflineCache = useCallback(() => {
    if (offlineNoticeShownRef.current) return;
    offlineNoticeShownRef.current = true;
    toast.info("Network unavailable. Showing cached settings.");
  }, []);

  const clearOfflineCacheNotice = useCallback(() => {
    offlineNoticeShownRef.current = false;
  }, []);

  const applySettingsData = useCallback((data: any) => {
    if (!data || typeof data !== "object") return;
    setSettings(data);
    setProxyForm({
      outboundProxyEnabled: data?.outboundProxyEnabled === true,
      outboundProxyUrl: data?.outboundProxyUrl || "",
      outboundNoProxy: data?.outboundNoProxy || "",
    });
  }, []);

  const patchSettings = useCallback(async (patch: any, { feature = "profile-settings" }: any = {}) => {
    try {
      const result = await mutateJsonWithOfflineQueue({
        url: "/api/settings",
        method: "PATCH",
        body: patch,
        queueMeta: { feature, patch },
        invalidateCacheTags: ["settings"],
      });

      if (result.queued) {
        setSettings((prev: any) => ({ ...prev, ...patch }));
        return { ok: true, queued: true, data: patch };
      }

      const nextData = result.data && typeof result.data === "object" ? result.data : patch;
      setSettings((prev: any) => ({ ...prev, ...nextData }));
      return { ok: true, queued: false, data: nextData };
    } catch (error) {
      console.error("Failed to update settings:", error);
      return { ok: false, queued: false, error };
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    loadJsonStaleWhileRevalidate({
      url: "/api/settings/migrate-sqlite",
      cacheKey: OFFLINE_LEGACY_INFO_CACHE_KEY,
      maxStaleMs: OFFLINE_MAX_STALE_MS,
      cacheTags: ["settings-migration"],
      onCacheData: (data: any) => {
        if (!mounted) return;
        if (data && !data.error) setLegacyInfo(data);
      },
      onFreshData: (data: any) => {
        if (!mounted) return;
        if (data && !data.error) setLegacyInfo(data);
      },
    })
      .then((result: any) => {
        if (result.source === "cache") notifyOfflineCache();
        else clearOfflineCacheNotice();
      })
      .catch(() => {});

    return () => {
      mounted = false;
    };
  }, [clearOfflineCacheNotice, notifyOfflineCache]);

  useEffect(() => {
    let mounted = true;

    loadJsonStaleWhileRevalidate({
      url: "/api/settings",
      cacheKey: OFFLINE_SETTINGS_CACHE_KEY,
      maxStaleMs: OFFLINE_MAX_STALE_MS,
      cacheTags: ["settings"],
      onCacheData: (data: any) => {
        if (!mounted) return;
        applySettingsData(data);
      },
      onFreshData: (data: any) => {
        if (!mounted) return;
        applySettingsData(data);
      },
    })
      .then((result: any) => {
        if (result.source === "cache") notifyOfflineCache();
        else clearOfflineCacheNotice();
      })
      .catch((err: unknown) => {
        console.error("Failed to fetch settings:", err);
      })
      .finally(() => {
        if (!mounted) return;
        setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [applySettingsData, clearOfflineCacheNotice, notifyOfflineCache]);

  const updateOutboundProxy = async (e: any) => {
    e.preventDefault();
    if (settings.outboundProxyEnabled !== true) return;
    setProxyLoading(true);
    setProxyStatus({ type: "", message: "" });
    try {
      const patch = {
        outboundProxyUrl: proxyForm.outboundProxyUrl,
        outboundNoProxy: proxyForm.outboundNoProxy,
      };
      const result = await patchSettings(patch, { feature: "profile-outbound-proxy" });
      if (!result.ok) {
        setProxyStatus({ type: "error", message: "Failed to update proxy settings" });
      } else if (result.queued) {
        setProxyStatus({ type: "success", message: "Offline: proxy settings queued for sync" });
      } else {
        setProxyStatus({ type: "success", message: "Proxy settings applied" });
      }
    } catch (error) {
      console.error("Failed to update proxy settings:", error);
      setProxyStatus({ type: "error", message: "An error occurred" });
    } finally {
      setProxyLoading(false);
    }
  };

  const testOutboundProxy = async () => {
    if (settings.outboundProxyEnabled !== true) return;
    const proxyUrl = (proxyForm.outboundProxyUrl || "").trim();
    if (!proxyUrl) {
      setProxyStatus({ type: "error", message: "Please enter a Proxy URL to test" });
      return;
    }
    setProxyTestLoading(true);
    setProxyStatus({ type: "", message: "" });
    try {
      const res = await fetch("/api/settings/proxy-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proxyUrl }),
      });
      const data = await res.json();
      if (res.ok && data?.ok) {
        setProxyStatus({
          type: "success",
          message: `Proxy test OK (${data.status}) in ${data.elapsedMs}ms`,
        });
      } else {
        setProxyStatus({ type: "error", message: data?.error || "Proxy test failed" });
      }
    } catch {
      setProxyStatus({ type: "error", message: "An error occurred" });
    } finally {
      setProxyTestLoading(false);
    }
  };

  const updateOutboundProxyEnabled = async (outboundProxyEnabled: any) => {
    setProxyLoading(true);
    setProxyStatus({ type: "", message: "" });
    try {
      const result = await patchSettings({ outboundProxyEnabled }, { feature: "profile-outbound-proxy-enabled" });
      if (result.ok) {
        setProxyForm((prev: any) => ({
          ...prev,
          outboundProxyEnabled: (result.data?.outboundProxyEnabled ?? outboundProxyEnabled) === true,
        }));
        setProxyStatus({
          type: "success",
          message: result.queued
            ? `Offline: proxy ${outboundProxyEnabled ? "enable" : "disable"} queued`
            : outboundProxyEnabled
              ? "Proxy enabled"
              : "Proxy disabled",
        });
      } else {
        setProxyStatus({ type: "error", message: "Failed to update proxy settings" });
      }
    } catch {
      setProxyStatus({ type: "error", message: "An error occurred" });
    } finally {
      setProxyLoading(false);
    }
  };

  const handlePasswordChange = async (e: any) => {
    e.preventDefault();
    if (passwords.new !== passwords.confirm) {
      setPassStatus({ type: "error", message: "Passwords do not match" });
      return;
    }
    setPassLoading(true);
    setPassStatus({ type: "", message: "" });
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: passwords.current,
          newPassword: passwords.new,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setPassStatus({ type: "success", message: "Password updated successfully" });
        setPasswords({ current: "", new: "", confirm: "" });
      } else {
        setPassStatus({ type: "error", message: data.error || "Failed to update password" });
      }
    } catch {
      setPassStatus({ type: "error", message: "An error occurred" });
    } finally {
      setPassLoading(false);
    }
  };

  const updateFallbackStrategy = async (strategy: any) => {
    await patchSettings({ fallbackStrategy: strategy }, { feature: "profile-fallback-strategy" });
  };

  const updateComboStrategy = async (strategy: any) => {
    await patchSettings({ comboStrategy: strategy }, { feature: "profile-combo-strategy" });
  };

  const updateStickyLimit = async (limit: any) => {
    const numLimit = parseInt(limit);
    if (Number.isNaN(numLimit) || numLimit < 1) return;
    await patchSettings({ stickyRoundRobinLimit: numLimit }, { feature: "profile-sticky-limit" });
  };

  const updateComboStickyLimit = async (limit: any) => {
    const numLimit = parseInt(limit);
    if (Number.isNaN(numLimit) || numLimit < 1) return;
    await patchSettings({ comboStickyRoundRobinLimit: numLimit }, { feature: "profile-combo-sticky-limit" });
  };

  const updateMinimumLockout = async (minutes: any) => {
    const val = Math.max(1, parseInt(minutes, 10) || 60);
    await patchSettings({ minimumLockoutMinutes: val }, { feature: "profile-minimum-lockout" });
  };

  const updateRequireLogin = async (requireLogin: any) => {
    await patchSettings({ requireLogin }, { feature: "profile-require-login" });
  };

  const updateModelCostSyncInterval = async (val: any) => {
    const hours = Math.max(1, parseInt(val) || 1);
    await patchSettings({ modelCostSyncIntervalHours: hours }, { feature: "profile-model-cost-sync-interval" });
  };

  const handleSyncNow = async () => {
    setSyncingCost(true);
    try {
      const res = await fetch("/api/pricing/sync", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        toast.success(`Synced ${data.modelCount} model prices`);
      } else {
        toast.error(data.error || "Sync failed");
      }
    } catch (_err) {
      toast.error("Sync failed");
    } finally {
      setSyncingCost(false);
    }
  };

  const updateObservabilityEnabled = async (enabled: any) => {
    await patchSettings(
      { observabilityEnabled: enabled, enableObservability: enabled },
      { feature: "profile-observability-enabled" },
    );
  };

  const reloadSettings = async () => {
    try {
      const result = await loadJsonStaleWhileRevalidate({
        url: "/api/settings",
        cacheKey: OFFLINE_SETTINGS_CACHE_KEY,
        maxStaleMs: OFFLINE_MAX_STALE_MS,
        onCacheData: (data: any) => {
          applySettingsData(data);
        },
        onFreshData: (data: any) => {
          applySettingsData(data);
        },
      });
      if (result.source === "cache") notifyOfflineCache();
      else clearOfflineCacheNotice();
    } catch (err) {
      console.error("Failed to reload settings:", err);
    }
  };

  const handleExportDatabase = async () => {
    setDbLoading(true);
    setDbStatus({ type: "", message: "" });
    try {
      const res = await fetch("/api/settings/database");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to export database");
      }
      const payload = await res.json();
      const content = JSON.stringify(payload, null, 2);
      const blob = new Blob([content], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const stamp = new Date().toISOString().replace(/[.:]/g, "-");
      anchor.href = url;
      anchor.download = `pod-backup-${stamp}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      setDbStatus({ type: "success", message: "Database backup downloaded" });
    } catch (err) {
      setDbStatus({ type: "error", message: err.message || "Failed to export database" });
    } finally {
      setDbLoading(false);
    }
  };

  const handleImportDatabase = async (event: any) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setDbLoading(true);
    setDbStatus({ type: "", message: "" });
    try {
      const raw = await file.text();
      const payload = JSON.parse(raw);
      const res = await fetch("/api/settings/database", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to import database");
      await reloadSettings();
      setDbStatus({ type: "success", message: "Database imported successfully" });
    } catch (err) {
      setDbStatus({ type: "error", message: err.message || "Invalid backup file" });
    } finally {
      if (importFileRef.current) importFileRef.current.value = "";
      setDbLoading(false);
    }
  };

  const observabilityEnabled = settings.enableObservability === true || settings.observabilityEnabled === true;

  return (
    <div className="max-w-2xl mx-auto">
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
      <div className="flex flex-col gap-5">
        {/* ── Appearance ──────────────────────────────────────────────────── */}
        <Section>
          <SectionHeader icon="contrast" title="Appearance" />
          <SettingRow label="Theme" description="Choose how the interface looks">
            <div className="flex items-center gap-1 p-1 rounded-[6px] border border-charcoal-grey bg-pitch-black/60">
              {["light", "dark", "system"].map((option: any) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setTheme(option)}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1 rounded-[4px] text-[12px] font-[510] transition-colors duration-100 capitalize",
                    theme === option ? "bg-deep-slate text-porcelain" : "text-fog-grey hover:text-storm-cloud",
                  )}
                >
                  <LucideIcon
                    name={option === "light" ? "light_mode" : option === "dark" ? "dark_mode" : "contrast"}
                    className="text-[14px]"
                  />
                  {option}
                </button>
              ))}
            </div>
          </SettingRow>
        </Section>

        {/* ── Data ────────────────────────────────────────────────────────── */}
        <Section>
          <SectionHeader icon="database" title="Data" />
          <div className="flex flex-col gap-4">
            {/* DB path */}
            <div className="flex items-center gap-2 px-3 py-2 rounded-[4px] border border-charcoal-grey bg-pitch-black/40">
              <LucideIcon name="storage" className="text-storm-cloud text-[14px]" />
              <code className="text-[12px] text-storm-cloud font-mono">~/.pod/pod.sqlite</code>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" icon="download" onClick={handleExportDatabase} loading={dbLoading}>
                Download Backup
              </Button>
              <Button
                variant="outline"
                icon="upload"
                onClick={() => importFileRef.current?.click()}
                disabled={dbLoading}
              >
                Import Backup
              </Button>
              <input
                ref={importFileRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                aria-label="Import backup file"
                onChange={handleImportDatabase}
              />
            </div>

            {legacyInfo.hasLegacyData && (
              <p className="text-[12px] text-storm-cloud">
                Legacy files detected: <span className="font-mono">{legacyInfo.legacyFilesFound.join(", ")}</span>
              </p>
            )}

            <StatusMsg status={dbStatus} />
          </div>
        </Section>

        {/* ── Security ────────────────────────────────────────────────────── */}
        <Section>
          <SectionHeader icon="shield" title="Security" />
          <div className="flex flex-col gap-4">
            <SettingRow
              label="Require login"
              description="When ON, dashboard requires password. When OFF, access without login."
            >
              <Toggle
                checked={settings.requireLogin === true}
                onChange={() => updateRequireLogin(!settings.requireLogin)}
                disabled={loading}
              />
            </SettingRow>

            {settings.requireLogin === true && (
              <form onSubmit={handlePasswordChange} className="flex flex-col gap-4 pt-4 border-t border-charcoal-grey">
                {settings.hasPassword && (
                  <div className="flex flex-col gap-1.5">
                    <FieldLabel>Current Password</FieldLabel>
                    <Input
                      type="password"
                      placeholder="Enter current password"
                      value={passwords.current}
                      onChange={(e: any) => setPasswords({ ...passwords, current: e.target.value })}
                      required
                    />
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <FieldLabel>New Password</FieldLabel>
                    <Input
                      type="password"
                      placeholder="Enter new password"
                      value={passwords.new}
                      onChange={(e: any) => setPasswords({ ...passwords, new: e.target.value })}
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <FieldLabel>Confirm New Password</FieldLabel>
                    <Input
                      type="password"
                      placeholder="Confirm new password"
                      value={passwords.confirm}
                      onChange={(e: any) => setPasswords({ ...passwords, confirm: e.target.value })}
                      required
                    />
                  </div>
                </div>
                <StatusMsg status={passStatus} />
                <div>
                  <Button type="submit" variant="primary" loading={passLoading}>
                    {settings.hasPassword ? "Update Password" : "Set Password"}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </Section>

        {/* ── Routing Strategy ────────────────────────────────────────────── */}
        <Section>
          <SectionHeader icon="route" title="Routing Strategy" />
          <div className="flex flex-col gap-4">
            <SettingRow label="Round Robin" description="Cycle through accounts to distribute load">
              <Toggle
                checked={settings.fallbackStrategy === "round-robin"}
                onChange={() =>
                  updateFallbackStrategy(settings.fallbackStrategy === "round-robin" ? "fill-first" : "round-robin")
                }
                disabled={loading}
              />
            </SettingRow>

            {settings.fallbackStrategy === "round-robin" && (
              <SettingRow label="Sticky Limit" description="Calls per account before switching" border>
                <Input
                  type="number"
                  min="1"
                  max="10"
                  value={settings.stickyRoundRobinLimit || 3}
                  onChange={(e: any) => updateStickyLimit(e.target.value)}
                  disabled={loading}
                  className="w-16 text-center shrink-0"
                />
              </SettingRow>
            )}

            <SettingRow
              label="Combo Round Robin"
              description="Cycle through providers in combos instead of always starting with first"
              border
            >
              <Toggle
                checked={settings.comboStrategy === "round-robin"}
                onChange={() =>
                  updateComboStrategy(settings.comboStrategy === "round-robin" ? "fallback" : "round-robin")
                }
                disabled={loading}
              />
            </SettingRow>

            {settings.comboStrategy === "round-robin" && (
              <SettingRow label="Combo Sticky Limit" description="Calls per combo model before switching" border>
                <Input
                  type="number"
                  min="1"
                  max="100"
                  value={settings.comboStickyRoundRobinLimit || 1}
                  onChange={(e: any) => updateComboStickyLimit(e.target.value)}
                  disabled={loading}
                  className="w-16 text-center shrink-0"
                />
              </SettingRow>
            )}

            <SettingRow label="Minimum Lockout Time" description="Minimum lockout duration per error (minutes)." border>
              <Input
                type="number"
                min="1"
                value={settings.minimumLockoutMinutes ?? 60}
                onChange={(e: any) => updateMinimumLockout(e.target.value)}
                disabled={loading}
                className="w-20 text-center shrink-0"
              />
            </SettingRow>

            <p className="text-[12px] text-storm-cloud pt-3 border-t border-charcoal-grey">
              {settings.fallbackStrategy === "round-robin"
                ? `Distributing requests across all available accounts with ${settings.stickyRoundRobinLimit || 3} calls per account.`
                : "Using accounts in priority order (Fill First)."}
              {settings.comboStrategy === "round-robin"
                ? ` Combos rotate after ${settings.comboStickyRoundRobinLimit || 1} call${(settings.comboStickyRoundRobinLimit || 1) === 1 ? "" : "s"} per model.`
                : " Combos always start with their first model."}
            </p>
          </div>
        </Section>

        {/* ── Network ─────────────────────────────────────────────────────── */}
        <Section>
          <SectionHeader icon="wifi" title="Network" />
          <div className="flex flex-col gap-4">
            <SettingRow label="Outbound Proxy" description="Enable proxy for OAuth + provider outbound requests.">
              <Toggle
                checked={settings.outboundProxyEnabled === true}
                onChange={() => updateOutboundProxyEnabled(!(settings.outboundProxyEnabled === true))}
                disabled={loading || proxyLoading}
              />
            </SettingRow>

            {settings.outboundProxyEnabled === true && (
              <form onSubmit={updateOutboundProxy} className="flex flex-col gap-4 pt-4 border-t border-charcoal-grey">
                <div className="flex flex-col gap-1.5">
                  <FieldLabel>Proxy URL</FieldLabel>
                  <Input
                    placeholder="http://127.0.0.1:7897"
                    value={proxyForm.outboundProxyUrl}
                    onChange={(e: any) => setProxyForm((prev: any) => ({ ...prev, outboundProxyUrl: e.target.value }))}
                    disabled={loading || proxyLoading}
                  />
                  <p className="text-[12px] text-storm-cloud">Leave empty to inherit existing env proxy (if any).</p>
                </div>

                <div className="flex flex-col gap-1.5 pt-4 border-t border-charcoal-grey">
                  <FieldLabel>No Proxy</FieldLabel>
                  <Input
                    placeholder="localhost,127.0.0.1"
                    value={proxyForm.outboundNoProxy}
                    onChange={(e: any) => setProxyForm((prev: any) => ({ ...prev, outboundNoProxy: e.target.value }))}
                    disabled={loading || proxyLoading}
                  />
                  <p className="text-[12px] text-storm-cloud">Comma-separated hostnames/domains to bypass the proxy.</p>
                </div>

                <div className="flex items-center gap-2 pt-4 border-t border-charcoal-grey">
                  <Button
                    type="button"
                    variant="secondary"
                    loading={proxyTestLoading}
                    disabled={loading || proxyLoading}
                    onClick={testOutboundProxy}
                  >
                    Test proxy URL
                  </Button>
                  <Button type="submit" variant="primary" loading={proxyLoading}>
                    Apply
                  </Button>
                </div>
              </form>
            )}

            <StatusMsg status={proxyStatus} />
          </div>
        </Section>

        {/* ── Observability ───────────────────────────────────────────────── */}
        <Section>
          <SectionHeader icon="monitoring" title="Observability" />
          <SettingRow label="Enable Observability" description="Record request details for inspection in the logs view">
            <Toggle checked={observabilityEnabled} onChange={updateObservabilityEnabled} disabled={loading} />
          </SettingRow>
        </Section>

        {/* ── Model Cost Sync ──────────────────────────────────────────── */}
        <Section>
          <SectionHeader icon="sync" title="Model Cost Sync" />
          <div className="flex flex-col gap-4">
            <SettingRow
              label="Model Cost Sync Time"
              description="How often to sync model pricing from models.dev (hours). Default: 1 hour."
              border
            >
              <Input
                type="number"
                min="1"
                max="168"
                value={settings.modelCostSyncIntervalHours ?? 1}
                onChange={(e: any) => updateModelCostSyncInterval(e.target.value)}
                disabled={loading}
                inputClassName="h-8 w-[84px] text-center shrink-0 px-2 text-[12px]"
                className="shrink-0"
              />
            </SettingRow>
            <SettingRow label="Sync Now" description="Immediately sync model pricing from models.dev.">
              <Button
                size="sm"
                variant="secondary"
                icon={syncingCost ? "progress_activity" : "sync"}
                onClick={handleSyncNow}
                disabled={loading || syncingCost}
                className="shrink-0"
              >
                {syncingCost ? "Syncing..." : "Sync Now"}
              </Button>
            </SettingRow>
          </div>
        </Section>

        {/* ── System Information ──────────────────────────────────────────── */}
        <Section>
          <SectionHeader icon="info" title="System Information" />
          <div className="flex flex-col gap-2">
            {[
              { label: "App", value: `${APP_CONFIG.name} v${APP_CONFIG.displayVersion}` },
              { label: "Runtime", value: settings.systemInfo?.runtime || "—" },
              { label: "Platform", value: settings.systemInfo?.platform || "—" },
              { label: "Database", value: "~/.pod/pod.sqlite" },
            ].map((row: any) => (
              <div
                key={row.label}
                className="flex items-center justify-between py-1.5 border-b border-charcoal-grey last:border-0"
              >
                <span className="text-[12px] text-storm-cloud">{row.label}</span>
                <span className="text-[12px] font-mono text-porcelain">{row.value}</span>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}
