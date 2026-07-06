"use client";

import { Controls, Handle, Position, ReactFlow } from "@xyflow/react";
import PropTypes from "prop-types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "@xyflow/react/dist/style.css";
import { AI_PROVIDERS } from "@/shared/constants/providers";

// Force-stop FE animation if a provider stays active longer than this
const FE_ACTIVE_TIMEOUT_MS: any = 60000;
const FE_ACTIVE_TICK_MS: any = 1000;

function getProviderConfig(providerId: any) {
  return (
    AI_PROVIDERS[providerId] || ({ color: "#6b7280", name: providerId, textIcon: undefined } as any)
  );
}

// Use local provider images from /public/providers/
function getProviderImageUrl(providerId: any) {
  return `/providers/${providerId}.png`;
}

// Custom provider node - rectangle with image + name
function ProviderNode({ data }: any) {
  const { label, color, imageUrl, textIcon, active, error } = data ?? ({} as any);
  const [imgError, setImgError]: any = useState(false);

  const borderColor: any = error ? "#ef4444" : active ? "#22c55e" : "var(--color-border)";
  const dotColor: any = error ? "#ef4444" : "#22c55e";
  const textColor: any = error ? "#ef4444" : active ? "#22c55e" : "var(--color-text)";

  return (
    <div
      className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg border-2 transition-all duration-300 bg-bg"
      style={{
        borderColor,
        boxShadow: "none",
        minWidth: "150px",
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        id="top"
        className="!bg-transparent !border-0 !w-0 !h-0"
      />
      <Handle
        type="target"
        position={Position.Bottom}
        id="bottom"
        className="!bg-transparent !border-0 !w-0 !h-0"
      />
      <Handle
        type="target"
        position={Position.Left}
        id="left"
        className="!bg-transparent !border-0 !w-0 !h-0"
      />
      <Handle
        type="target"
        position={Position.Right}
        id="right"
        className="!bg-transparent !border-0 !w-0 !h-0"
      />

      {/* Provider icon */}
      <div
        className="w-8 h-8 rounded-md flex items-center justify-center shrink-0"
        style={{ backgroundColor: `${color}15` }}
      >
        {!imgError ? (
          <img
            src={imageUrl}
            alt={label}
            className="w-6 h-6 rounded-sm object-contain"
            onError={() => setImgError(true)}
          />
        ) : (
          <span className="text-sm font-bold" style={{ color }}>
            {textIcon}
          </span>
        )}
      </div>

      {/* Provider name */}
      <span className="text-base font-medium truncate" style={{ color: textColor }}>
        {label}
      </span>

      {/* Active / error indicator dot */}
      {(active || error) && (
        <span className="relative flex h-2 w-2 shrink-0">
          {active && !error && (
            <span
              className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
              style={{ backgroundColor: dotColor }}
            />
          )}
          <span
            className="relative inline-flex rounded-full h-2 w-2"
            style={{ backgroundColor: dotColor }}
          />
        </span>
      )}
    </div>
  );
}

ProviderNode.propTypes = {
  data: PropTypes.object.isRequired,
};

// Center Pod node
function RouterNode({ data }: any) {
  return (
    <div className="flex items-center justify-center px-5 py-3 rounded-xl border-2 border-primary bg-primary/5 shadow-md min-w-[130px]">
      <Handle
        type="source"
        position={Position.Top}
        id="top"
        className="!bg-transparent !border-0 !w-0 !h-0"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        className="!bg-transparent !border-0 !w-0 !h-0"
      />
      <Handle
        type="source"
        position={Position.Left}
        id="left"
        className="!bg-transparent !border-0 !w-0 !h-0"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        className="!bg-transparent !border-0 !w-0 !h-0"
      />

      <img src="/logo.svg" alt="Pod" className="w-6 h-6 mr-2 dark:invert" />
      <span className="text-sm font-bold text-primary">Pod</span>
      {data.activeCount > 0 && (
        <span className="ml-2 px-1.5 py-0.5 rounded-full bg-primary text-primary-fg text-xs font-bold">
          {data.activeCount}
        </span>
      )}
    </div>
  );
}

RouterNode.propTypes = {
  data: PropTypes.object.isRequired,
};

const nodeTypes: any = { provider: ProviderNode, router: RouterNode };

// Place N nodes evenly along an ellipse around the router center.
function buildLayout(providers: any, activeSet: any, lastSet: any, errorSet: any) {
  const nodeW: any = 180;
  const nodeH: any = 30;
  const routerW: any = 120;
  const routerH: any = 44;
  const nodeGap: any = 24;

  const count: any = providers.length;

  // Compute rx so arc spacing between nodes >= nodeW + nodeGap
  const minRx: any = ((nodeW + nodeGap) * count) / (2 * Math.PI);
  const rx: any = Math.max(320, minRx);
  const ry: any = Math.max(200, rx * 0.55); // ellipse ratio ~0.55
  if (count === 0) {
    return {
      nodes: [
        {
          id: "router",
          type: "router",
          position: { x: 0, y: 0 },
          data: { activeCount: 0 },
          draggable: false,
        },
      ],
      edges: [],
    };
  }

  const nodes: any = [];
  const edges: any = [];

  nodes.push({
    id: "router",
    type: "router",
    position: { x: -routerW / 2, y: -routerH / 2 },
    data: { activeCount: activeSet.size },
    draggable: false,
  });

  const edgeStyle: any = (active: any, last: any, error: any, color: any) => {
    if (error) return { stroke: "#ef4444", strokeWidth: 2.5, opacity: 0.9 };
    if (active) return { stroke: "#22c55e", strokeWidth: 2.5, opacity: 0.9 };
    if (last) return { stroke: "#22c55e", strokeWidth: 2, opacity: 0.7 };
    return { stroke: "var(--color-porcelain, #E5E5E6)", strokeWidth: 1, opacity: 0.4 };
  };

  providers.forEach((p: any, i: any) => {
    const config: any = getProviderConfig(p.provider);
    const active: any = activeSet.has(p.provider?.toLowerCase());
    const last: any = !active && lastSet.has(p.provider?.toLowerCase());
    const error: any = !active && errorSet.has(p.provider?.toLowerCase());
    const nodeId: any = `provider-${p.provider}`;
    const data: any = {
      label: (config.name !== p.provider ? config.name : null) || p.name || p.provider,
      color: config.color || "#6b7280",
      imageUrl: getProviderImageUrl(p.provider),
      textIcon: config.textIcon || (p.provider || "?").slice(0, 2).toUpperCase(),
      active,
      error,
    };

    // Distribute evenly starting from top (−π/2), clockwise
    const angle: any = -Math.PI / 2 + (2 * Math.PI * i) / count;
    const cx: any = rx * Math.cos(angle);
    const cy: any = ry * Math.sin(angle);

    // Pick router handle closest to the node direction
    let sourceHandle: any, targetHandle: any;
    if (
      Math.abs(angle + Math.PI / 2) < Math.PI / 4 ||
      Math.abs(angle - (3 * Math.PI) / 2) < Math.PI / 4
    ) {
      sourceHandle = "top";
      targetHandle = "bottom";
    } else if (Math.abs(angle - Math.PI / 2) < Math.PI / 4) {
      sourceHandle = "bottom";
      targetHandle = "top";
    } else if (cx > 0) {
      sourceHandle = "right";
      targetHandle = "left";
    } else {
      sourceHandle = "left";
      targetHandle = "right";
    }

    nodes.push({
      id: nodeId,
      type: "provider",
      position: { x: cx - nodeW / 2, y: cy - nodeH / 2 },
      data,
      draggable: false,
    });

    edges.push({
      id: `e-${nodeId}`,
      source: "router",
      sourceHandle,
      target: nodeId,
      targetHandle,
      animated: active,
      style: edgeStyle(active, last, error, config.color),
    });
  });

  return { nodes, edges };
}

const VIEWPORT_SESSION_KEY: any = "providerTopologyViewport";

function saveViewport(viewport: any) {
  try {
    sessionStorage.setItem(VIEWPORT_SESSION_KEY, JSON.stringify(viewport));
  } catch {}
}

function loadViewport() {
  try {
    const raw: any = sessionStorage.getItem(VIEWPORT_SESSION_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

export default function ProviderTopology({
  providers = [],
  activeRequests = [],
  lastProvider = "",
  errorProvider = "",
}: any) {
  // Serialize to stable string keys so useMemo only re-runs when values actually change
  const activeKey: any = useMemo(
    () =>
      activeRequests
        .map((r: any) => r.provider?.toLowerCase())
        .filter(Boolean)
        .sort()
        .join(","),
    [activeRequests],
  );
  const lastKey: any = lastProvider?.toLowerCase() || "";
  const errorKey: any = errorProvider?.toLowerCase() || "";

  const rawActiveSet: any = useMemo(
    () => new Set<any>(activeKey ? activeKey.split(",") : []),
    [activeKey],
  );
  const lastSet: any = useMemo(() => new Set<any>(lastKey ? [lastKey] : []), [lastKey]);
  const errorSet: any = useMemo(() => new Set<any>(errorKey ? [errorKey] : []), [errorKey]);

  // Track firstSeen per active provider; drop provider if running too long (BE stuck)
  const firstSeenRef: any = useRef<Record<string, number>>({});
  const [tick, setTick]: any = useState(0);

  useEffect(() => {
    const seen: any = firstSeenRef.current;
    const now: any = Date.now();
    for (const p of rawActiveSet) {
      const pk: any = p as string;
      if (!seen[pk]) seen[pk] = now;
    }
    for (const p of Object.keys(seen)) {
      if (!rawActiveSet.has(p)) delete seen[p];
    }
  }, [rawActiveSet]);

  useEffect(() => {
    if (rawActiveSet.size === 0) {
      return undefined;
    }
    const id: any = setInterval(() => setTick((t: any) => t + 1), FE_ACTIVE_TICK_MS);
    return () => clearInterval(id);
  }, [rawActiveSet]);

  const activeSet: any = useMemo(() => {
    const now: any = Date.now();
    const filtered: any = new Set<any>();
    for (const p of rawActiveSet) {
      const pk: any = p as string;
      const ts: any = firstSeenRef.current[pk];
      if (!ts || now - ts < FE_ACTIVE_TIMEOUT_MS) filtered.add(pk);
    }
    return filtered;
  }, [rawActiveSet, tick]);

  const { nodes, edges }: any = useMemo(
    () => buildLayout(providers, activeSet, lastSet, errorSet),
    [providers, activeSet, lastKey, errorKey],
  );

  // Stable key — only remount when provider list changes
  const providersKey: any = useMemo(
    () =>
      providers
        .map((p: any) => p.provider)
        .sort()
        .join(","),
    [providers],
  );

  const rfInstance: any = useRef<any>(null);
  const containerRef: any = useRef<any>(null);
  const fitOpts: any = { padding: 0.2, duration: 200 };
  const savedViewport: any = useRef(loadViewport());

  const onInit: any = useCallback((instance: any) => {
    rfInstance.current = instance;
    if (savedViewport.current) {
      // Restore saved zoom + pan position
      instance.setViewport(savedViewport.current, { duration: 0 });
    } else {
      setTimeout(() => instance.fitView(fitOpts), 50);
    }
  }, []);

  const onMoveEnd: any = useCallback((_: any, viewport: any) => {
    saveViewport(viewport);
    savedViewport.current = viewport;
  }, []);

  // Re-fit on container resize — only when no saved viewport
  useEffect(() => {
    const el: any = containerRef.current;
    if (!el) {
      return undefined;
    }
    const ro: any = new ResizeObserver(() => {
      if (rfInstance.current && !savedViewport.current) rfInstance.current.fitView(fitOpts);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Re-fit when node count/layout changes — only when no saved viewport
  useEffect(() => {
    if (rfInstance.current && !savedViewport.current) {
      const id: any = setTimeout(() => rfInstance.current.fitView(fitOpts), 50);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [nodes.length]);

  return (
    <div
      ref={containerRef}
      className="h-[320px] w-full min-w-0 rounded-lg border border-border bg-bg-subtle/30 sm:h-[480px]"
    >
      {providers.length === 0 ? (
        <div className="h-full flex items-center justify-center text-text-muted text-sm">
          No providers connected
        </div>
      ) : (
        <ReactFlow
          key={providersKey}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={fitOpts}
          minZoom={0.1}
          maxZoom={2}
          onInit={onInit}
          onMoveEnd={onMoveEnd}
          proOptions={{ hideAttribution: true }}
          panOnDrag
          zoomOnScroll
          zoomOnPinch
          zoomOnDoubleClick
          preventScrolling={false}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
        >
          <Controls showInteractive={false} className="usage-flow-controls text-black" />
        </ReactFlow>
      )}
    </div>
  );
}

ProviderTopology.propTypes = {
  providers: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string,
      provider: PropTypes.string,
      name: PropTypes.string,
    }),
  ),
  activeRequests: PropTypes.arrayOf(
    PropTypes.shape({
      provider: PropTypes.string,
      model: PropTypes.string,
      account: PropTypes.string,
    }),
  ),
  lastProvider: PropTypes.string,
  errorProvider: PropTypes.string,
};
