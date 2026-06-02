"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge, Button, Card, CardSkeleton, Input, Select, Toggle } from "@/shared/components";
import { ConfirmModal } from "@/shared/components/Modal";

const MEMORY_TYPE_OPTIONS = [
  { value: "factual", label: "Factual" },
  { value: "episodic", label: "Episodic" },
  { value: "procedural", label: "Procedural" },
  { value: "semantic", label: "Semantic" },
];

const STRATEGY_OPTIONS = [
  { value: "hybrid", label: "Hybrid" },
  { value: "semantic", label: "Semantic" },
  { value: "recent", label: "Recent" },
];

const PAGE_LIMIT = 20;

function toDateLabel(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

export default function MemoryClient() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [clearingAll, setClearingAll] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState({
    open: false,
    title: "",
    message: "",
    onConfirm: null,
    variant: "default",
  });
  const openConfirm = (title, message, onConfirm, variant = "default") =>
    setConfirmDialog({ open: true, title, message, onConfirm, variant });
  const closeConfirm = () => setConfirmDialog((prev) => ({ ...prev, open: false, onConfirm: null }));

  const [settings, setSettings] = useState({
    enabled: true,
    maxTokens: "2000",
    retentionDays: "30",
    strategy: "hybrid",
  });

  const [apiKeys, setApiKeys] = useState([]);
  const [filters, setFilters] = useState({
    q: "",
    apiKeyId: "",
    type: "",
  });
  const [draftFilters, setDraftFilters] = useState({
    q: "",
    apiKeyId: "",
    type: "",
  });
  const [page, setPage] = useState(1);
  const [memoryData, setMemoryData] = useState({
    data: [],
    total: 0,
    totalPages: 1,
    stats: { total: 0, byType: {} },
  });

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("limit", String(PAGE_LIMIT));
    params.set("page", String(page));
    if (filters.q) params.set("q", filters.q);
    if (filters.apiKeyId) params.set("apiKeyId", filters.apiKeyId);
    if (filters.type) params.set("type", filters.type);
    return params.toString();
  }, [filters, page]);

  const loadData = useCallback(
    async (isInitial = false) => {
      if (isInitial) setLoading(true);
      else setRefreshing(true);
      try {
        const [settingsRes, memoryRes, keysRes] = await Promise.all([
          fetch("/api/settings/memory", { cache: "no-store" }),
          fetch(`/api/memory?${queryString}`, { cache: "no-store" }),
          fetch("/api/keys", { cache: "no-store" }),
        ]);

        const settingsPayload = settingsRes.ok ? await settingsRes.json() : null;
        const memoryPayload = memoryRes.ok ? await memoryRes.json() : null;
        const keysPayload = keysRes.ok ? await keysRes.json() : null;

        if (settingsPayload) {
          setSettings({
            enabled: settingsPayload.enabled !== false,
            maxTokens: String(settingsPayload.maxTokens ?? 2000),
            retentionDays: String(settingsPayload.retentionDays ?? 30),
            strategy: settingsPayload.strategy || "hybrid",
          });
        }

        if (memoryPayload) {
          setMemoryData({
            data: Array.isArray(memoryPayload.data) ? memoryPayload.data : [],
            total: Number(memoryPayload.total || 0),
            totalPages: Math.max(1, Number(memoryPayload.totalPages || 1)),
            stats: memoryPayload.stats || { total: 0, byType: {} },
          });
        }

        if (keysPayload?.keys) {
          setApiKeys(keysPayload.keys);
        }
      } catch (error) {
        toast.error(error?.message || "Failed to load memory data");
      } finally {
        if (isInitial) setLoading(false);
        else setRefreshing(false);
      }
    },
    [queryString],
  );

  useEffect(() => {
    loadData(true);
  }, [loadData]);

  const handleSaveSettings = async () => {
    const maxTokens = Number.parseInt(settings.maxTokens, 10);
    const retentionDays = Number.parseInt(settings.retentionDays, 10);

    if (!Number.isInteger(maxTokens) || maxTokens < 0 || maxTokens > 16000) {
      toast.error("maxTokens harus integer 0..16000");
      return;
    }
    if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 365) {
      toast.error("retentionDays harus integer 1..365");
      return;
    }

    setSavingSettings(true);
    try {
      const res = await fetch("/api/settings/memory", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: settings.enabled,
          maxTokens,
          retentionDays,
          strategy: settings.strategy,
        }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || "Failed to save memory settings");
      }

      toast.success("Memory settings updated");
      await loadData(false);
    } catch (error) {
      toast.error(error?.message || "Failed to save memory settings");
    } finally {
      setSavingSettings(false);
    }
  };

  const handleToggleMemoryEnabled = async (enabled) => {
    const previous = settings.enabled;
    setSettings((prev) => ({ ...prev, enabled }));
    setSavingSettings(true);
    try {
      const res = await fetch("/api/settings/memory", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || "Failed to update memory state");
      }

      toast.success(`Memory ${enabled ? "enabled" : "disabled"}`);
      await loadData(false);
    } catch (error) {
      setSettings((prev) => ({ ...prev, enabled: previous }));
      toast.error(error?.message || "Failed to update memory state");
    } finally {
      setSavingSettings(false);
    }
  };

  const handleDeleteMemory = async (id) => {
    if (!id) return;

    setDeletingId(id);
    try {
      const res = await fetch(`/api/memory/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || "Failed to delete memory");
      }
      toast.success("Memory deleted");
      await loadData(false);
    } catch (error) {
      toast.error(error?.message || "Failed to delete memory");
    } finally {
      setDeletingId(null);
    }
  };

  const handleClearAllMemories = async () => {
    setClearingAll(true);
    try {
      const res = await fetch("/api/memory", { method: "DELETE" });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || "Failed to clear memories");
      }
      const payload = await res.json().catch(() => ({}));
      const removed = Number(payload?.removed || 0);
      toast.success(
        removed > 0 ? `Cleared ${removed} memory ${removed === 1 ? "entry" : "entries"}` : "No memory entries to clear",
      );
      setPage(1);
      await loadData(false);
    } catch (error) {
      toast.error(error?.message || "Failed to clear memories");
    } finally {
      setClearingAll(false);
    }
  };

  const handleApplyFilters = () => {
    setPage(1);
    setFilters({
      q: draftFilters.q.trim(),
      apiKeyId: draftFilters.apiKeyId,
      type: draftFilters.type,
    });
  };

  const typeStats = memoryData.stats?.byType || {};
  const currentCount = memoryData.data.length;

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Memory</h1>
        <p className="text-sm text-text-muted">Manage memory retrieval settings and stored memories per API key.</p>
      </div>

      <Card
        title="Memory Settings"
        subtitle="Controls injection strategy and retention policy"
        icon="memory"
        action={
          <Button size="sm" icon="save" onClick={handleSaveSettings} loading={savingSettings}>
            Save
          </Button>
        }
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Toggle
            checked={settings.enabled}
            onChange={handleToggleMemoryEnabled}
            disabled={savingSettings}
            label="Enable Memory"
            description="Inject memory context into chat requests."
          />

          <Select
            label="Strategy"
            value={settings.strategy}
            options={STRATEGY_OPTIONS}
            onChange={(event) => setSettings((prev) => ({ ...prev, strategy: event.target.value }))}
          />

          <Input
            label="Max Tokens"
            type="number"
            min="0"
            max="16000"
            value={settings.maxTokens}
            onChange={(event) => setSettings((prev) => ({ ...prev, maxTokens: event.target.value }))}
          />

          <Input
            label="Retention Days"
            type="number"
            min="1"
            max="365"
            value={settings.retentionDays}
            onChange={(event) => setSettings((prev) => ({ ...prev, retentionDays: event.target.value }))}
          />
        </div>
      </Card>

      <Card
        title="Stored Memories"
        subtitle={`Showing ${currentCount} of ${memoryData.total} entries`}
        icon="database"
        action={
          <Button size="sm" variant="secondary" icon="refresh" onClick={() => loadData(false)} loading={refreshing}>
            Refresh
          </Button>
        }
      >
        <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-4">
          <Input
            label="Search"
            value={draftFilters.q}
            onChange={(event) => setDraftFilters((prev) => ({ ...prev, q: event.target.value }))}
            placeholder="Search memory content..."
            icon="search"
          />
          <Select
            label="API Key"
            placeholder="All API Keys"
            value={draftFilters.apiKeyId}
            options={apiKeys.map((key) => ({ value: key.id, label: key.name || key.id }))}
            onChange={(event) => setDraftFilters((prev) => ({ ...prev, apiKeyId: event.target.value }))}
          />
          <Select
            label="Type"
            placeholder="All Types"
            value={draftFilters.type}
            options={MEMORY_TYPE_OPTIONS}
            onChange={(event) => setDraftFilters((prev) => ({ ...prev, type: event.target.value }))}
          />
          <div className="flex items-end">
            <Button icon="filter_alt" onClick={handleApplyFilters} className="w-full">
              Apply Filters
            </Button>
          </div>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatCard label="Total" value={memoryData.stats?.total ?? 0} />
          <StatCard label="Factual" value={typeStats.factual ?? 0} />
          <StatCard label="Episodic" value={typeStats.episodic ?? 0} />
          <StatCard label="Procedural" value={typeStats.procedural ?? 0} />
          <StatCard label="Semantic" value={typeStats.semantic ?? 0} />
        </div>

        {loading ? (
          <div className="flex flex-col gap-3">
            {[1, 2, 3].map((i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        ) : memoryData.data.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-text-muted">
            No memory entries found.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border-subtle">
            <table className="w-full min-w-[820px]">
              <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-text-muted">
                <tr>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Key</th>
                  <th className="px-3 py-2">Content</th>
                  <th className="px-3 py-2">API Key</th>
                  <th className="px-3 py-2">Created</th>
                  <th className="px-3 py-2 w-[80px]">Action</th>
                </tr>
              </thead>
              <tbody>
                {memoryData.data.map((entry) => (
                  <tr key={entry.id} className="border-t border-border-subtle align-top">
                    <td className="px-3 py-2">
                      <Badge variant="primary" size="sm">
                        {entry.type}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-sm font-mono text-text-main">{entry.key || "-"}</td>
                    <td className="px-3 py-2 text-sm text-text-main">
                      <div className="max-w-[420px] whitespace-pre-wrap break-words line-clamp-3">{entry.content}</div>
                    </td>
                    <td className="px-3 py-2 text-xs text-text-muted">{entry.apiKeyId}</td>
                    <td className="px-3 py-2 text-xs text-text-muted">{toDateLabel(entry.createdAt)}</td>
                    <td className="px-3 py-2">
                      <Button
                        size="sm"
                        variant="danger"
                        icon="delete"
                        onClick={() =>
                          openConfirm(
                            "Delete memory",
                            "Are you sure you want to delete this memory entry?",
                            () => handleDeleteMemory(entry.id),
                            "danger",
                          )
                        }
                        loading={deletingId === entry.id}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-text-muted">
            Page {page} of {memoryData.totalPages}
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((prev) => prev - 1)}>
              Prev
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={page >= memoryData.totalPages}
              onClick={() => setPage((prev) => prev + 1)}
            >
              Next
            </Button>
          </div>
        </div>

        <div className="mt-4 border-t border-border-subtle pt-4">
          <Button
            variant="danger"
            icon="delete_forever"
            loading={clearingAll}
            disabled={loading || clearingAll}
            onClick={() =>
              openConfirm(
                "Clear all memory",
                "Are you sure you want to delete all memory entries?",
                handleClearAllMemories,
                "danger",
              )
            }
            className="w-full sm:w-auto"
          >
            Clear All Memory
          </Button>
        </div>
      </Card>

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

function StatCard({ label, value }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-2 px-3 py-2">
      <p className="text-xs text-text-muted">{label}</p>
      <p className="text-sm font-semibold text-text-main">{value}</p>
    </div>
  );
}
