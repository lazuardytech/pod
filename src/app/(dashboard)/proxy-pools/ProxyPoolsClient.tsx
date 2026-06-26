"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge, Button, Card, CardSkeleton, Input, Modal, Toggle } from "@/shared/components";
import { ConfirmModal } from "@/shared/components/Modal";
import LucideIcon from "@/shared/components/LucideIcon";

function getStatusVariant(status: any) {
  if (status === "active") return "success";
  if (status === "error") return "error";
  return "default";
}

function formatDateTime(value: any) {
  if (!value) return "Never";
  const date: any = new Date(value);
  if (Number.isNaN(date.getTime())) return "Never";
  return date.toLocaleString();
}

function normalizeFormData(
  data: {
    name?: string;
    proxyUrl?: string;
    noProxy?: string;
    isActive?: boolean;
    strictProxy?: boolean;
  } = {},
) {
  return {
    name: data.name || "",
    proxyUrl: data.proxyUrl || "",
    noProxy: data.noProxy || "",
    isActive: data.isActive !== false,
    strictProxy: data.strictProxy === true,
  };
}

export default function ProxyPoolsPage() {
  const [proxyPools, setProxyPools]: any = useState<any[]>([]);
  const [loading, setLoading]: any = useState(true);
  const [showFormModal, setShowFormModal]: any = useState(false);
  const [showBatchImportModal, setShowBatchImportModal]: any = useState(false);
  const [showVercelModal, setShowVercelModal]: any = useState(false);
  const [editingProxyPool, setEditingProxyPool]: any = useState<any>(null);
  const [formData, setFormData]: any = useState(normalizeFormData());
  const [batchImportText, setBatchImportText]: any = useState("");
  const [vercelForm, setVercelForm]: any = useState({ vercelToken: "", projectName: "vercel-relay" });
  const [saving, setSaving]: any = useState(false);
  const [importing, setImporting]: any = useState(false);
  const [deploying, setDeploying]: any = useState(false);
  const [testingId, setTestingId]: any = useState<any>(null);
  const [selectedIds, setSelectedIds]: any = useState<any[]>([]);
  const [healthChecking, setHealthChecking]: any = useState(false);
  const [healthProgress, setHealthProgress]: any = useState({ current: 0, total: 0 });
  const [bulkBusy, setBulkBusy]: any = useState(false);

  const [confirmDialog, setConfirmDialog]: any = useState({
    open: false,
    title: "",
    message: "",
    onConfirm: null,
    variant: "default",
  });
  const openConfirm: any = (title: any, message: any, onConfirm: any, variant: any = "default") =>
    setConfirmDialog({ open: true, title, message, onConfirm, variant });
  const closeConfirm: any = () => setConfirmDialog((prev: any) => ({ ...prev, open: false, onConfirm: null }));

  const fetchProxyPools: any = useCallback(async () => {
    try {
      const res: any = await fetch("/api/proxy-pools?includeUsage=true", { cache: "no-store" });
      const data: any = await res.json();
      if (res.ok) {
        setProxyPools(data.proxyPools || []);
      }
    } catch (error) {
      console.error("Error fetching proxy pools:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProxyPools();
  }, [fetchProxyPools]);

  const resetForm: any = () => {
    setEditingProxyPool(null);
    setFormData(normalizeFormData());
  };

  const openCreateModal: any = () => {
    resetForm();
    setShowFormModal(true);
  };

  const openEditModal: any = (proxyPool: any) => {
    setEditingProxyPool(proxyPool);
    setFormData(normalizeFormData(proxyPool));
    setShowFormModal(true);
  };

  const closeFormModal: any = () => {
    setShowFormModal(false);
    resetForm();
  };

  const handleSave: any = async () => {
    const payload: any = {
      name: formData.name.trim(),
      proxyUrl: formData.proxyUrl.trim(),
      noProxy: formData.noProxy.trim(),
      isActive: formData.isActive === true,
      strictProxy: formData.strictProxy === true,
    };

    if (!payload.name || !payload.proxyUrl) return;

    setSaving(true);
    try {
      const isEdit: any = !!editingProxyPool;
      const res: any = await fetch(isEdit ? `/api/proxy-pools/${editingProxyPool.id}` : "/api/proxy-pools", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        await fetchProxyPools();
        closeFormModal();
        toast.success(editingProxyPool ? "Proxy pool updated" : "Proxy pool created");
      } else {
        const data: any = await res.json();
        toast.error(data.error || "Failed to save proxy pool");
      }
    } catch (error) {
      console.error("Error saving proxy pool:", error);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete: any = async (proxyPool: any) => {
    try {
      const res: any = await fetch(`/api/proxy-pools/${proxyPool.id}`, { method: "DELETE" });
      if (res.ok) {
        setProxyPools((prev: any) => prev.filter((item: any) => item.id !== proxyPool.id));
        toast.success("Proxy pool deleted");
        return;
      }

      const data: any = await res.json();
      if (res.status === 409) {
        toast.warning(`Cannot delete: ${data.boundConnectionCount || 0} connection(s) are still using this pool.`);
      } else {
        toast.error(data.error || "Failed to delete proxy pool");
      }
    } catch (error) {
      console.error("Error deleting proxy pool:", error);
      toast.error("Failed to delete proxy pool");
    }
  };

  const handleTest: any = async (proxyPoolId: any) => {
    setTestingId(proxyPoolId);
    try {
      const res: any = await fetch(`/api/proxy-pools/${proxyPoolId}/test`, { method: "POST" });
      const data: any = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Failed to test proxy");
        return;
      }

      await fetchProxyPools();
      toast.success(data.ok ? "Proxy test passed" : "Proxy test failed");
    } catch (error) {
      console.error("Error testing proxy pool:", error);
      toast.error("Failed to test proxy");
    } finally {
      setTestingId(null);
    }
  };

  const handleToggleActive: any = async (pool: any) => {
    const next: any = !pool.isActive;
    setProxyPools((prev: any) => prev.map((p: any) => (p.id === pool.id ? { ...p, isActive: next } : p)));
    try {
      const res: any = await fetch(`/api/proxy-pools/${pool.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: next }),
      });
      if (!res.ok) {
        setProxyPools((prev: any) => prev.map((p: any) => (p.id === pool.id ? { ...p, isActive: pool.isActive } : p)));
        toast.error("Failed to update active state");
      }
    } catch (error) {
      console.error("Error toggling active:", error);
      setProxyPools((prev: any) => prev.map((p: any) => (p.id === pool.id ? { ...p, isActive: pool.isActive } : p)));
    }
  };

  const allSelected: any = proxyPools.length > 0 && selectedIds.length === proxyPools.length;
  const toggleSelect: any = (id: any) =>
    setSelectedIds((prev: any) => (prev.includes(id) ? prev.filter((x: any) => x !== id) : [...prev, id]));
  const toggleSelectAll: any = () => setSelectedIds(allSelected ? [] : proxyPools.map((p: any) => p.id));
  const clearSelection: any = () => setSelectedIds([]);

  const bulkSetActive: any = async (isActive: any) => {
    const targets: any = selectedIds.length > 0 ? selectedIds : proxyPools.map((p: any) => p.id);
    if (targets.length === 0) return;
    setBulkBusy(true);
    try {
      let ok: any = 0;
      let failed: any = 0;
      for (const id of targets) {
        try {
          const res: any = await fetch(`/api/proxy-pools/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ isActive }),
          });
          if (res.ok) ok += 1;
          else failed += 1;
        } catch {
          failed += 1;
        }
      }
      await fetchProxyPools();
      toast.success(`${isActive ? "Activated" : "Deactivated"} ${ok}${failed ? `, failed ${failed}` : ""}`);
    } finally {
      setBulkBusy(false);
    }
  };

  const bulkDelete: any = async () => {
    if (selectedIds.length === 0) return;
    setBulkBusy(true);
    try {
      let ok: any = 0;
      let blocked: any = 0;
      let failed: any = 0;
      for (const id of selectedIds) {
        try {
          const res: any = await fetch(`/api/proxy-pools/${id}`, { method: "DELETE" });
          if (res.ok) ok += 1;
          else if (res.status === 409) blocked += 1;
          else failed += 1;
        } catch {
          failed += 1;
        }
      }
      await fetchProxyPools();
      clearSelection();
      toast.success(`Deleted ${ok}${blocked ? `, ${blocked} bound` : ""}${failed ? `, ${failed} failed` : ""}`);
    } finally {
      setBulkBusy(false);
    }
  };

  const handleHealthCheck: any = async () => {
    const targets: any = selectedIds.length > 0 ? proxyPools.filter((p: any) => selectedIds.includes(p.id)) : proxyPools;
    if (targets.length === 0) return;
    setHealthChecking(true);
    setHealthProgress({ current: 0, total: targets.length });
    let alive: any = 0;
    const deadIds: any = [];
    let done: any = 0;
    const CONCURRENCY: any = 10;
    const queue: any = [...targets];

    const worker: any = async () => {
      while (queue.length > 0) {
        const pool: any = queue.shift();
        if (!pool) break;
        try {
          const res: any = await fetch(`/api/proxy-pools/${pool.id}/test`, { method: "POST" });
          const data: any = await res.json();
          if (res.ok && data.ok) alive += 1;
          else deadIds.push(pool.id);
        } catch {
          deadIds.push(pool.id);
        } finally {
          done += 1;
          setHealthProgress({ current: done, total: targets.length });
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));
    await fetchProxyPools();
    setHealthChecking(false);
    setHealthProgress({ current: 0, total: 0 });

    if (deadIds.length > 0) {
      openConfirm(
        "Disable Dead Proxies",
        `Alive: ${alive}, Dead: ${deadIds.length}.\n\nDisable ${deadIds.length} dead proxies?`,
        async () => {
          setBulkBusy(true);
          try {
            for (const id of deadIds) {
              try {
                await fetch(`/api/proxy-pools/${id}`, {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ isActive: false }),
                });
              } catch {}
            }
            await fetchProxyPools();
            toast.success(`Disabled ${deadIds.length} dead proxies`);
          } finally {
            setBulkBusy(false);
          }
        },
        "danger",
      );
    } else {
      toast.success(`Health check done. Alive: ${alive}, Dead: ${deadIds.length}`);
    }
  };

  // Cleanup selectedIds when pools change
  useEffect(() => {
    setSelectedIds((prev: any) => prev.filter((id: any) => proxyPools.some((p: any) => p.id === id)));
  }, [proxyPools]);

  const openBatchImportModal: any = () => {
    setBatchImportText("");
    setShowBatchImportModal(true);
  };

  const closeBatchImportModal: any = () => {
    if (importing) return;
    setShowBatchImportModal(false);
  };

  const openVercelModal: any = () => {
    setVercelForm({ vercelToken: "", projectName: "vercel-relay" });
    setShowVercelModal(true);
  };

  const closeVercelModal: any = () => {
    if (deploying) return;
    setShowVercelModal(false);
  };

  const handleVercelDeploy: any = async () => {
    if (!vercelForm.vercelToken.trim()) return;
    setDeploying(true);
    try {
      const res: any = await fetch("/api/proxy-pools/vercel-deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vercelForm),
      });
      const data: any = await res.json();
      if (res.ok) {
        await fetchProxyPools();
        closeVercelModal();
        toast.success(`Deployed: ${data.deployUrl}`);
      } else {
        toast.error(data.error || "Deploy failed");
      }
    } catch (error) {
      console.error("Error deploying Vercel relay:", error);
      toast.error("Deploy failed");
    } finally {
      setDeploying(false);
    }
  };

  const parseProxyLine: any = (line: any) => {
    const trimmed: any = line.trim();
    if (!trimmed) return null;

    if (trimmed.includes("://")) {
      const parsed: any = new URL(trimmed);
      const hostLabel: any = parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
      return {
        proxyUrl: parsed.toString(),
        name: `Imported ${hostLabel}`,
      };
    }

    const parts: any = trimmed.split(":");
    if (parts.length === 4) {
      const [host, port, username, password] = parts;
      if (!host || !port || !username || !password) {
        throw new Error("Invalid host:port:user:pass format");
      }

      const proxyUrl: any = `http://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}`;
      const parsed: any = new URL(proxyUrl);
      return {
        proxyUrl: parsed.toString(),
        name: `Imported ${host}:${port}`,
      };
    }

    throw new Error("Unsupported format");
  };

  const handleBatchImport: any = async () => {
    const lines: any = batchImportText
      .split(/\r?\n/)
      .map((line: any) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      toast.warning("Please paste at least one proxy line.");
      return;
    }

    const parsedEntries: any = [];
    const invalidLines: any = [];

    lines.forEach((line: any, index: any) => {
      try {
        const parsed: any = parseProxyLine(line);
        if (parsed) {
          parsedEntries.push({
            ...parsed,
            lineNumber: index + 1,
          });
        }
      } catch (error) {
        invalidLines.push(`Line ${index + 1}: ${error.message}`);
      }
    });

    if (invalidLines.length > 0) {
      toast.error(`Invalid proxy format:\n${invalidLines.join("\n")}`);
      return;
    }

    setImporting(true);
    try {
      const existingKeys: any = new Set<any>(
        proxyPools.map((pool: any) => `${(pool.proxyUrl || "").trim()}|||${(pool.noProxy || "").trim()}`),
      );

      let created: any = 0;
      let skipped: any = 0;
      let failed: any = 0;

      for (const entry of parsedEntries) {
        const dedupeKey: any = `${entry.proxyUrl}|||`;
        if (existingKeys.has(dedupeKey)) {
          skipped += 1;
          continue;
        }

        const res: any = await fetch("/api/proxy-pools", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: entry.name,
            proxyUrl: entry.proxyUrl,
            noProxy: "",
            isActive: true,
          }),
        });

        if (res.ok) {
          created += 1;
          existingKeys.add(dedupeKey);
        } else {
          failed += 1;
        }
      }

      await fetchProxyPools();
      setShowBatchImportModal(false);
      toast.success(`Batch import completed: Created ${created}, Skipped ${skipped}, Failed ${failed}`);
    } catch (error) {
      console.error("Error batch importing proxies:", error);
      toast.error("Batch import failed");
    } finally {
      setImporting(false);
    }
  };

  const activeCount: any = useMemo(() => proxyPools.filter((pool: any) => pool.isActive === true).length, [proxyPools]);

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-1 sm:gap-6 sm:px-0">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-1 sm:gap-6 sm:px-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold sm:text-2xl">Proxy Pools</h1>
          <p className="text-sm text-text-muted mt-1">
            Manage reusable per-connection proxies and bind them to provider connections.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center">
          <Button size="sm" variant="secondary" icon="cloud_upload" onClick={openVercelModal}>
            Vercel Relay
          </Button>
          <Button size="sm" variant="secondary" icon="upload" onClick={openBatchImportModal}>
            Batch Import
          </Button>
          <Button size="sm" icon="add" onClick={openCreateModal}>
            Add Proxy Pool
          </Button>
        </div>
      </div>

      <Card>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {proxyPools.length > 0 && (
            <label className="flex items-center gap-1.5 text-xs text-text-muted cursor-pointer">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleSelectAll}
                className="size-4 rounded border-black/20 dark:border-white/20"
                name="select-all"
              />
              {allSelected ? "Unselect all" : "Select all"}
            </label>
          )}
          <Badge variant="default">Total: {proxyPools.length}</Badge>
          <Badge variant="success">Active: {activeCount}</Badge>
        </div>

        {(selectedIds.length > 0 || healthChecking) && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
            <LucideIcon name="checklist" className="text-[18px] text-primary" />
            <span className="text-xs font-medium text-primary">
              {selectedIds.length > 0 ? `${selectedIds.length} selected` : "All pools"}
            </span>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                icon={healthChecking ? "progress_activity" : "health_and_safety"}
                onClick={handleHealthCheck}
                disabled={healthChecking || bulkBusy || proxyPools.length === 0}
              >
                {healthChecking ? `Checking ${healthProgress.current}/${healthProgress.total}` : "Health Check"}
              </Button>
              {selectedIds.length > 0 && (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon="toggle_on"
                    onClick={() => bulkSetActive(true)}
                    disabled={bulkBusy || healthChecking}
                  >
                    Activate
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon="toggle_off"
                    onClick={() => bulkSetActive(false)}
                    disabled={bulkBusy || healthChecking}
                  >
                    Deactivate
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon="delete"
                    onClick={() =>
                      openConfirm(
                        "Delete Proxy Pools",
                        `Delete ${selectedIds.length} proxy pool(s)? This cannot be undone.`,
                        bulkDelete,
                        "danger",
                      )
                    }
                    disabled={bulkBusy || healthChecking}
                  >
                    Delete
                  </Button>
                  <Button size="sm" variant="ghost" onClick={clearSelection} disabled={bulkBusy || healthChecking}>
                    Clear
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        {proxyPools.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-text-main font-medium mb-1">No proxy pool entries yet</p>
            <p className="text-sm text-text-muted mb-4">Create a proxy pool entry, then assign it to connections.</p>
            <Button icon="add" onClick={openCreateModal}>
              Add Proxy Pool
            </Button>
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-black/[0.04] dark:divide-white/[0.05]">
            {proxyPools.map((pool: any) => (
              <div key={pool.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <input
                    aria-label="Select proxy pool"
                    type="checkbox"
                    checked={selectedIds.includes(pool.id)}
                    onChange={() => toggleSelect(pool.id)}
                    className="mt-1 size-4 shrink-0 rounded border-black/20 dark:border-white/20"
                    name="select-proxy"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="min-w-0 max-w-full truncate text-sm font-medium sm:max-w-[18rem]">{pool.name}</p>
                      <Badge variant={getStatusVariant(pool.testStatus)} size="sm" dot>
                        {pool.testStatus || "unknown"}
                      </Badge>
                      <Badge variant={pool.isActive ? "success" : "default"} size="sm">
                        {pool.isActive ? "active" : "inactive"}
                      </Badge>
                      {pool.type === "vercel" && (
                        <Badge variant="default" size="sm">
                          vercel relay
                        </Badge>
                      )}
                      <Badge variant="default" size="sm">
                        {pool.boundConnectionCount || 0} bound
                      </Badge>
                    </div>
                    <p className="text-xs text-text-muted truncate mt-1">{pool.proxyUrl}</p>
                    {pool.noProxy ? <p className="text-xs text-text-muted truncate">No proxy: {pool.noProxy}</p> : null}
                    <p className="text-[11px] text-text-muted mt-1">
                      Last tested: {formatDateTime(pool.lastTestedAt)}
                      {pool.lastError ? ` · ${pool.lastError}` : ""}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-1">
                  <Toggle
                    size="sm"
                    checked={pool.isActive === true}
                    onChange={() => handleToggleActive(pool)}
                    title={pool.isActive ? "Disable" : "Enable"}
                  />
                  <button
                    onClick={() => handleTest(pool.id)}
                    className="p-2 rounded hover:bg-black/5 dark:hover:bg-white/5 text-text-muted hover:text-primary"
                    title="Test proxy"
                    disabled={testingId === pool.id}
                  >
                    <LucideIcon
                      name={testingId === pool.id ? "progress_activity" : "science"}
                      className="text-[18px]"
                      style={testingId === pool.id ? { animation: "spin 1s linear infinite" } : undefined}
                    />
                  </button>
                  <button
                    onClick={() => openEditModal(pool)}
                    className="p-2 rounded hover:bg-black/5 dark:hover:bg-white/5 text-text-muted hover:text-primary"
                    title="Edit"
                  >
                    <LucideIcon name="edit" className="text-[18px]" />
                  </button>
                  <button
                    onClick={() =>
                      openConfirm(
                        "Delete Proxy Pool",
                        `Delete proxy pool "${pool.name}"? This cannot be undone.`,
                        () => handleDelete(pool),
                        "danger",
                      )
                    }
                    className="p-2 rounded hover:bg-red-500/10 text-red-500"
                    title="Delete"
                  >
                    <LucideIcon name="delete" className="text-[18px]" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal isOpen={showBatchImportModal} title="Batch Import Proxies" onClose={closeBatchImportModal}>
        <div className="flex flex-col gap-4">
          <div>
            <label className="text-sm font-medium text-text-main mb-1 block">Paste Proxy List (One per line)</label>
            <textarea
              aria-label="Proxy list"
              value={batchImportText}
              onChange={(e: any) => setBatchImportText(e.target.value)}
              placeholder={"http://user:pass@127.0.0.1:7897\n127.0.0.1:7897:user:pass"}
              className="w-full min-h-[180px] py-2 px-3 text-sm text-text-main bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-md focus:ring-1 focus:ring-primary/30 focus:border-primary/50 focus:outline-none transition-all"
              name="proxy-list"
            />
            <p className="text-xs text-text-muted mt-1">
              Supported formats: protocol://user:pass@host:port, host:port:user:pass
            </p>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button fullWidth onClick={handleBatchImport} disabled={!batchImportText.trim() || importing}>
              {importing ? "Importing..." : "Import"}
            </Button>
            <Button fullWidth variant="ghost" onClick={closeBatchImportModal} disabled={importing}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={showVercelModal} title="Deploy Vercel Relay" onClose={closeVercelModal}>
        <div className="flex flex-col gap-4">
          <div className="rounded-[6px] bg-deep-slate border border-charcoal-grey p-3 flex flex-col gap-1.5">
            <p className="text-sm text-text-main font-medium">What is Vercel Relay?</p>
            <p className="text-xs text-text-muted">
              Deploys an edge relay function to Vercel. All AI provider requests will be forwarded through Vercel&apos;s
              edge network, masking your real IP from providers.
            </p>
            <ul className="text-xs text-text-muted list-disc pl-4 space-y-0.5">
              <li>Your IP is replaced by Vercel&apos;s dynamic edge IPs (hundreds of IPs across 20+ global regions)</li>
              <li>
                Vercel serves millions of apps — providers can&apos;t block Vercel IPs without affecting legitimate
                traffic
              </li>
              <li>Free tier: 100GB bandwidth/month, 500K edge invocations</li>
              <li>Deploy multiple relays on different accounts for more IP diversity</li>
            </ul>
          </div>
          <Input
            label="Vercel API Token"
            value={vercelForm.vercelToken}
            onChange={(e: any) => setVercelForm((prev: any) => ({ ...prev, vercelToken: e.target.value }))}
            placeholder="your-vercel-api-token"
            hint={
              <>
                Token is used once for deployment and not stored.{" "}
                <a
                  href="https://vercel.com/account/tokens"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Get token →
                </a>
              </>
            }
            type="password"
          />
          <Input
            label="Project Name"
            value={vercelForm.projectName}
            onChange={(e: any) => setVercelForm((prev: any) => ({ ...prev, projectName: e.target.value }))}
            placeholder="my-relay"
            hint="Unique name for your Vercel project. Leave empty for auto-generated name."
          />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button fullWidth onClick={handleVercelDeploy} disabled={!vercelForm.vercelToken.trim() || deploying}>
              {deploying ? "Deploying... (may take ~1 min)" : "Deploy"}
            </Button>
            <Button fullWidth variant="ghost" onClick={closeVercelModal} disabled={deploying}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showFormModal}
        title={editingProxyPool ? "Edit Proxy Pool" : "Add Proxy Pool"}
        onClose={closeFormModal}
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Name"
            value={formData.name}
            onChange={(e: any) => setFormData((prev: any) => ({ ...prev, name: e.target.value }))}
            placeholder="Office Proxy"
          />
          <Input
            label="Proxy URL"
            value={formData.proxyUrl}
            onChange={(e: any) => setFormData((prev: any) => ({ ...prev, proxyUrl: e.target.value }))}
            placeholder="http://127.0.0.1:7897"
          />
          <Input
            label="No Proxy"
            value={formData.noProxy}
            onChange={(e: any) => setFormData((prev: any) => ({ ...prev, noProxy: e.target.value }))}
            placeholder="localhost,127.0.0.1,.internal"
            hint="Comma-separated hosts/domains to bypass proxy"
          />

          <div className="flex flex-col gap-3 rounded-lg border border-border/50 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium text-sm">Active</p>
              <p className="text-xs text-text-muted">Inactive pools are ignored by runtime resolution.</p>
            </div>
            <Toggle
              checked={formData.isActive === true}
              onChange={() => setFormData((prev: any) => ({ ...prev, isActive: !prev.isActive }))}
              disabled={saving}
            />
          </div>

          <div className="flex flex-col gap-3 rounded-lg border border-border/50 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium text-sm">Strict Proxy</p>
              <p className="text-xs text-text-muted">
                Fail request if proxy is unreachable instead of falling back to direct.
              </p>
            </div>
            <Toggle
              checked={formData.strictProxy === true}
              onChange={() => setFormData((prev: any) => ({ ...prev, strictProxy: !prev.strictProxy }))}
              disabled={saving}
            />
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button
              fullWidth
              onClick={handleSave}
              disabled={!formData.name.trim() || !formData.proxyUrl.trim() || saving}
            >
              {saving ? "Saving..." : "Save"}
            </Button>
            <Button fullWidth variant="ghost" onClick={closeFormModal} disabled={saving}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

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
