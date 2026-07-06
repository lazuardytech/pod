"use client";

import Link from "next/link";
import { notFound, useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AddCustomEmbeddingModal, Badge, Button, Card } from "@/shared/components";
import LucideIcon from "@/shared/components/LucideIcon";
import ProviderIcon from "@/shared/components/ProviderIcon";
import {
  AI_PROVIDERS,
  getProvidersByKind,
  MEDIA_PROVIDER_KINDS,
  type ServiceKind,
} from "@/shared/constants/providers";
import { useHeaderActionStore } from "@/store/headerActionStore";

// Kinds that support combos (currently disabled for image/tts — temporarily hidden).
// webSearch/webFetch handled by /web page.
const COMBO_KINDS = new Set([]);
const COMBO_BASE_NAMES: Record<string, any> = { image: "image-combo", tts: "tts-combo" };

function getEffectiveStatus(conn: any) {
  const isCooldown = Object.entries(conn).some(
    ([k, v]: any) =>
      k.startsWith("modelLock_") &&
      v &&
      new Date(v as string | number | Date).getTime() > Date.now(),
  );
  return conn.testStatus === "unavailable" && !isCooldown ? "active" : conn.testStatus;
}

function MediaProviderCard({ provider, kind, connections, isCustom }: any) {
  const providerInfo = AI_PROVIDERS[provider.id];
  const isNoAuth = !!providerInfo?.noAuth;

  const providerConns = connections.filter((c: any) => c.provider === provider.id);
  const connected = providerConns.filter((c: any) => {
    const s = getEffectiveStatus(c);
    return s === "active" || s === "success";
  }).length;
  const error = providerConns.filter((c: any) => {
    const s = getEffectiveStatus(c);
    return s === "error" || s === "expired" || s === "unavailable";
  }).length;
  const total = providerConns.length;
  const allDisabled = total > 0 && providerConns.every((c: any) => c.isActive === false);

  const renderStatus = () => {
    if (isNoAuth)
      return (
        <Badge variant="success" size="sm">
          Ready
        </Badge>
      );
    if (allDisabled)
      return (
        <Badge variant="default" size="sm">
          Disabled
        </Badge>
      );
    if (total === 0) return <span className="text-xs text-text-muted">No connections</span>;
    return (
      <>
        {connected > 0 && (
          <Badge variant="success" size="sm" dot>
            {connected} Connected
          </Badge>
        )}
        {error > 0 && (
          <Badge variant="error" size="sm" dot>
            {error} Error
          </Badge>
        )}
        {connected === 0 && error === 0 && (
          <Badge variant="default" size="sm">
            {total} Added
          </Badge>
        )}
      </>
    );
  };

  return (
    <Link href={`/media-providers/${kind}/${provider.id}`} className="group">
      <Card
        padding="xs"
        className={`h-full hover:bg-black/[0.01] dark:hover:bg-white/[0.01] transition-colors cursor-pointer ${allDisabled ? "opacity-50" : ""}`}
      >
        <div className="flex min-w-0 items-center gap-3">
          <div
            className="size-8 rounded-lg flex items-center justify-center shrink-0"
            style={{
              backgroundColor: `${provider.color?.length > 7 ? provider.color : (provider.color ?? "#888") + "15"}`,
            }}
          >
            <ProviderIcon
              src={`/providers/${provider.id}.png`}
              alt={provider.name}
              size={30}
              className="object-contain rounded-lg max-w-[30px] max-h-[30px]"
              fallbackText={provider.textIcon || provider.id.slice(0, 2).toUpperCase()}
              fallbackColor={provider.color}
            />
          </div>
          <div>
            <h3 className="font-semibold text-sm">{provider.name}</h3>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {isCustom && (
                <Badge variant="default" size="sm">
                  Custom
                </Badge>
              )}
              {renderStatus()}
            </div>
          </div>
        </div>
      </Card>
    </Link>
  );
}

function ComboList({ combos }: any) {
  if (combos.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {combos.map((combo: any) => (
        <Link key={combo.id} href={`/media-providers/combo/${combo.id}`}>
          <Card
            padding="xs"
            className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors cursor-pointer"
          >
            <div className="flex min-w-0 items-center gap-3">
              <LucideIcon name="layers" className="text-primary text-[18px]" />
              <code className="text-sm font-mono font-medium flex-1 truncate">{combo.name}</code>
              <div className="flex flex-wrap items-center gap-1 sm:shrink-0">
                {combo.models.slice(0, 6).map((entry: any, i: any) => {
                  const pid = typeof entry === "string" ? (entry.split("/")[0] ?? "") : "";
                  const p = AI_PROVIDERS[pid];
                  return (
                    <div
                      key={`${entry}-${i}`}
                      title={p?.name || entry}
                      className="size-5 rounded flex items-center justify-center"
                      style={{ backgroundColor: `${p?.color ?? "#888"}15` }}
                    >
                      <ProviderIcon
                        src={`/providers/${pid}.png`}
                        alt={p?.name || pid}
                        size={18}
                        className="object-contain rounded max-w-[18px] max-h-[18px]"
                        fallbackText={p?.textIcon || pid.slice(0, 2).toUpperCase()}
                        fallbackColor={p?.color}
                      />
                    </div>
                  );
                })}
                {combo.models.length > 6 && (
                  <span className="text-[10px] text-text-muted ml-1">
                    +{combo.models.length - 6}
                  </span>
                )}
              </div>
              <span className="text-[11px] text-text-muted shrink-0">{combo.models.length}</span>
              <LucideIcon name="chevron_right" className="text-text-muted text-[16px]" />
            </div>
          </Card>
        </Link>
      ))}
    </div>
  );
}

export default function MediaProviderKindPage() {
  const { kind: kindParam } = useParams();
  const kind = (Array.isArray(kindParam) ? kindParam[0] : kindParam) as ServiceKind;
  const router = useRouter();
  const [connections, setConnections] = useState<any[]>([]);
  const [customNodes, setCustomNodes] = useState<any[]>([]);
  const [combos, setCombos] = useState<any[]>([]);
  const [showAddCustomEmbedding, setShowAddCustomEmbedding] = useState(false);
  const [showConnectedOnly, setShowConnectedOnly] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("media-providers:connectedOnly") === "true";
  });

  const toggleConnectedOnly = (v?: boolean) => {
    const next = typeof v === "boolean" ? v : !showConnectedOnly;
    setShowConnectedOnly(next);
    window.localStorage.setItem("media-providers:connectedOnly", String(next));
  };
  const registerAction = useHeaderActionStore((s: any) => s.register);
  const unregisterAction = useHeaderActionStore((s: any) => s.unregister);

  useEffect(() => {
    registerAction({
      label: "Connected only",
      icon: "wifi",
      active: showConnectedOnly,
      title: "Show connected providers only",
      onClick: () => toggleConnectedOnly(),
    });
    return () => unregisterAction();
  }, [showConnectedOnly, registerAction, unregisterAction]);

  // webSearch/webFetch listing pages are merged into /web
  useEffect(() => {
    if (kind === "webSearch" || kind === "webFetch") {
      router.replace("/media-providers/web");
    }
  }, [kind, router]);

  const kindConfig = MEDIA_PROVIDER_KINDS.find((k: any) => k.id === kind);
  const isEmbedding = kind === "embedding";
  const supportsCombo = (COMBO_KINDS as Set<string>).has(kind);

  useEffect(() => {
    if (!kindConfig) return;
    fetch("/api/providers", { cache: "no-store" })
      .then((r: any) => r.json())
      .then((d: any) => setConnections(d.connections || []))
      .catch(() => {});
    if (isEmbedding) {
      fetch("/api/provider-nodes", { cache: "no-store" })
        .then((r: any) => r.json())
        .then((d: any) =>
          setCustomNodes((d.nodes || []).filter((n: any) => n.type === "custom-embedding")),
        )
        .catch(() => {});
    }
    if (supportsCombo) {
      fetch("/api/combos", { cache: "no-store" })
        .then((r: any) => r.json())
        .then((d: any) => setCombos(d.combos || []))
        .catch(() => {});
    }
  }, [isEmbedding, supportsCombo, kindConfig]);

  if (!kindConfig) return notFound();

  const providers = getProvidersByKind(kind);
  const kindCombos = combos.filter((c: any) => c.kind === kind);

  // Map custom nodes to MediaProviderCard shape
  const customProviders = customNodes.map((n: any) => ({
    id: n.id,
    name: n.name || "Custom Embedding",
    color: "#6366F1",
    textIcon: "CE",
  }));

  const allProviders = [...providers, ...customProviders].filter((p: any) => {
    if (!showConnectedOnly) return true;
    // noAuth providers (e.g. Kiro) have no connections — hide when Connected Only
    const providerInfo = AI_PROVIDERS[p.id];
    if (providerInfo?.noAuth) return false;
    const providerConns = connections.filter((c: any) => c.provider === p.id);
    const hasConnected = providerConns.some((c: any) => {
      const s = getEffectiveStatus(c);
      return (s === "active" || s === "success") && c.isActive !== false;
    });
    return hasConnected;
  });

  const handleCreateCombo = async () => {
    const base = COMBO_BASE_NAMES[kind] || `${kind}-combo`;
    let name = base;
    let i = 1;
    const existing = new Set(combos.map((c: any) => c.name));
    while (existing.has(name)) {
      name = `${base}-${i++}`;
    }
    const res = await fetch("/api/combos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, models: [], kind }),
    });
    if (res.ok) {
      const created = await res.json();
      router.push(`/media-providers/combo/${created.id}`);
    } else {
      const err = await res.json();
      alert(err.error || "Failed to create combo");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {(isEmbedding || supportsCombo) && (
        <div className="flex items-center justify-end gap-2">
          {supportsCombo && (
            <Button size="sm" icon="add" onClick={handleCreateCombo}>
              Create Combo
            </Button>
          )}
          {isEmbedding && (
            <Button size="sm" icon="add" onClick={() => setShowAddCustomEmbedding(true)}>
              Add Custom Embedding
            </Button>
          )}
        </div>
      )}

      {supportsCombo && kindCombos.length > 0 && <ComboList combos={kindCombos} />}

      {allProviders.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-border rounded-xl text-text-muted text-sm">
          {showConnectedOnly ? (
            <div className="flex items-center justify-center gap-0 py-12">
              <LucideIcon name="wifi_off" className="text-[32px]" />
              <span className="ms-2">No connected providers available</span>
            </div>
          ) : (
            <>
              No providers support <strong>{kindConfig.label}</strong> yet.
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {allProviders.map((provider: any) => (
            <MediaProviderCard
              key={provider.id}
              provider={provider}
              kind={kind}
              connections={connections}
              isCustom={customProviders.some((c: any) => c.id === provider.id)}
            />
          ))}
        </div>
      )}

      {isEmbedding && (
        <AddCustomEmbeddingModal
          isOpen={showAddCustomEmbedding}
          onClose={() => setShowAddCustomEmbedding(false)}
          onCreated={(node: any) => {
            setCustomNodes((prev: any) => [...prev, node]);
            setShowAddCustomEmbedding(false);
          }}
        />
      )}
    </div>
  );
}
