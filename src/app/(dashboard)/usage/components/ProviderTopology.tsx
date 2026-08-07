"use client";

import {
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
  type ReactFlowInstance,
  type Viewport,
} from "@xyflow/react";
import PropTypes from "prop-types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import "@xyflow/react/dist/style.css";
import { AI_PROVIDERS, type ProviderDefinition } from "@/shared/constants/providers";

type TopologyProvider = {
  id?: string;
  provider: string;
  name?: string;
};

type ActiveRequest = {
  provider?: string;
  model?: string;
  account?: string;
};

type ProviderNodeData = {
  label: string;
  color: string;
  imageUrl: string;
  textIcon: string;
  active: boolean;
  error: boolean;
  [key: string]: unknown;
};

type RouterNodeData = {
  activeCount: number;
  [key: string]: unknown;
};

type TopologyNode = Node<ProviderNodeData | RouterNodeData>;
type TopologyEdge = Edge;

// Force-stop FE animation if a provider stays active longer than this
const FE_ACTIVE_TIMEOUT_MS = 60000;
const FE_ACTIVE_TICK_MS = 1000;

function getProviderConfig(providerId: string): Partial<ProviderDefinition> & {
  color: string;
  name: string;
  textIcon?: string;
} {
  return (
    AI_PROVIDERS[providerId] || {
      color: "#6b7280",
      name: providerId,
      textIcon: undefined,
    }
  );
}

// Use local provider images from /public/providers/
function getProviderImageUrl(providerId: string) {
  return `/providers/${providerId}.png`;
}

// Custom provider node - rectangle with image + name
function ProviderNode({ data }: NodeProps<Node<ProviderNodeData>>) {
  const { label, color, imageUrl, textIcon, active, error } = data;
  const [imgError, setImgError] = useState(false);

  const borderColor = error ? "#ef4444" : active ? "#22c55e" : "var(--color-border)";
  const dotColor = error ? "#ef4444" : "#22c55e";
  const textColor = error ? "#ef4444" : active ? "#22c55e" : "var(--color-text)";

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
          <Image
            src={imageUrl}
            alt={label}
            width={24}
            height={24}
            className="w-6 h-6 rounded-sm object-contain"
            onError={() => setImgError(true)}
            unoptimized
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
function RouterNode({ data }: NodeProps<Node<RouterNodeData>>) {
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

      <Image
        src="/logo.svg"
        alt="Pod"
        width={24}
        height={24}
        className="w-6 h-6 mr-2 dark:invert"
        unoptimized
      />
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

const nodeTypes = {
  provider: ProviderNode,
  router: RouterNode,
} as NodeTypes;

// Place N nodes evenly along an ellipse around the router center.
function buildLayout(
  providers: TopologyProvider[],
  activeSet: Set<string>,
  lastSet: Set<string>,
  errorSet: Set<string>,
) {
  const nodeW = 180;
  const nodeH = 30;
  const routerW = 120;
  const routerH = 44;
  const nodeGap = 24;

  const count = providers.length;

  // Compute rx so arc spacing between nodes >= nodeW + nodeGap
  const minRx = ((nodeW + nodeGap) * count) / (2 * Math.PI);
  const rx = Math.max(320, minRx);
  const ry = Math.max(200, rx * 0.55); // ellipse ratio ~0.55
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
      ] as TopologyNode[],
      edges: [] as TopologyEdge[],
    };
  }

  const nodes: TopologyNode[] = [];
  const edges: TopologyEdge[] = [];

  nodes.push({
    id: "router",
    type: "router",
    position: { x: -routerW / 2, y: -routerH / 2 },
    data: { activeCount: activeSet.size },
    draggable: false,
  });

  const edgeStyle = (active: boolean, last: boolean, error: boolean, _color: string) => {
    if (error) return { stroke: "#ef4444", strokeWidth: 2.5, opacity: 0.9 };
    if (active) return { stroke: "#22c55e", strokeWidth: 2.5, opacity: 0.9 };
    if (last) return { stroke: "#22c55e", strokeWidth: 2, opacity: 0.7 };
    return { stroke: "var(--color-porcelain, #E5E5E6)", strokeWidth: 1, opacity: 0.4 };
  };

  providers.forEach((p, i) => {
    const config = getProviderConfig(p.provider);
    const providerKey = p.provider?.toLowerCase() ?? "";
    const active = activeSet.has(providerKey);
    const last = !active && lastSet.has(providerKey);
    const error = !active && errorSet.has(providerKey);
    const nodeId = `provider-${p.provider}`;
    const data: ProviderNodeData = {
      label: (config.name !== p.provider ? config.name : null) || p.name || p.provider,
      color: config.color || "#6b7280",
      imageUrl: getProviderImageUrl(p.provider),
      textIcon: config.textIcon || (p.provider || "?").slice(0, 2).toUpperCase(),
      active,
      error,
    };

    // Distribute evenly starting from top (−π/2), clockwise
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / count;
    const cx = rx * Math.cos(angle);
    const cy = ry * Math.sin(angle);

    // Pick router handle closest to the node direction
    let sourceHandle: string, targetHandle: string;
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

const VIEWPORT_SESSION_KEY = "providerTopologyViewport";

function saveViewport(viewport: Viewport) {
  try {
    sessionStorage.setItem(VIEWPORT_SESSION_KEY, JSON.stringify(viewport));
  } catch {}
}

function loadViewport(): Viewport | null {
  try {
    const raw = sessionStorage.getItem(VIEWPORT_SESSION_KEY);
    if (raw) return JSON.parse(raw) as Viewport;
  } catch {}
  return null;
}

interface ProviderTopologyProps {
  providers?: TopologyProvider[];
  activeRequests?: ActiveRequest[];
  lastProvider?: string;
  errorProvider?: string;
}

export default function ProviderTopology({
  providers = [],
  activeRequests = [],
  lastProvider = "",
  errorProvider = "",
}: ProviderTopologyProps) {
  // Serialize to stable string keys so useMemo only re-runs when values actually change
  const activeKey = useMemo(
    () =>
      activeRequests
        .map((r) => r.provider?.toLowerCase())
        .filter(Boolean)
        .sort()
        .join(","),
    [activeRequests],
  );
  const lastKey = lastProvider?.toLowerCase() || "";
  const errorKey = errorProvider?.toLowerCase() || "";

  const rawActiveSet = useMemo(
    () => new Set<string>(activeKey ? activeKey.split(",") : []),
    [activeKey],
  );
  const lastSet = useMemo(() => new Set<string>(lastKey ? [lastKey] : []), [lastKey]);
  const errorSet = useMemo(() => new Set<string>(errorKey ? [errorKey] : []), [errorKey]);

  // Track firstSeen per active provider; drop provider if running too long (BE stuck)
  const firstSeenRef = useRef<Record<string, number>>({});
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const seen = firstSeenRef.current;
    const now = Date.now();
    for (const p of rawActiveSet) {
      if (!seen[p]) seen[p] = now;
    }
    for (const p of Object.keys(seen)) {
      if (!rawActiveSet.has(p)) delete seen[p];
    }
  }, [rawActiveSet]);

  useEffect(() => {
    if (rawActiveSet.size === 0) {
      return undefined;
    }
    const id = setInterval(() => setTick((t) => t + 1), FE_ACTIVE_TICK_MS);
    return () => clearInterval(id);
  }, [rawActiveSet]);

  /* eslint-disable react-hooks/exhaustive-deps */
  const activeSet = useMemo(() => {
    const now = Date.now();
    const filtered = new Set<string>();
    for (const p of rawActiveSet) {
      const ts = firstSeenRef.current[p];
      if (!ts || now - ts < FE_ACTIVE_TIMEOUT_MS) filtered.add(p);
    }
    return filtered;
  }, [rawActiveSet, tick]);
  /* eslint-enable react-hooks/exhaustive-deps */

  /* eslint-disable react-hooks/exhaustive-deps */
  const { nodes, edges } = useMemo(
    /* eslint-enable react-hooks/exhaustive-deps */
    () => buildLayout(providers, activeSet, lastSet, errorSet),
    [providers, activeSet, lastKey, errorKey],
  );

  // Stable key — only remount when provider list changes
  const providersKey = useMemo(
    () =>
      providers
        .map((p) => p.provider)
        .sort()
        .join(","),
    [providers],
  );

  const rfInstance = useRef<ReactFlowInstance<TopologyNode, TopologyEdge> | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fitOpts = { padding: 0.2, duration: 200 };
  const savedViewport = useRef(loadViewport());

  /* eslint-disable react-hooks/exhaustive-deps */
  const onInit = useCallback((instance: ReactFlowInstance<TopologyNode, TopologyEdge>) => {
    rfInstance.current = instance;
    if (savedViewport.current) {
      // Restore saved zoom + pan position
      instance.setViewport(savedViewport.current, { duration: 0 });
    } else {
      setTimeout(() => instance.fitView(fitOpts), 50);
    }
  }, []);
  /* eslint-enable react-hooks/exhaustive-deps */

  const onMoveEnd = useCallback((_: unknown, viewport: Viewport) => {
    saveViewport(viewport);
    savedViewport.current = viewport;
  }, []);

  // Re-fit on container resize — only when no saved viewport
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return undefined;
    }
    const ro = new ResizeObserver(() => {
      if (rfInstance.current && !savedViewport.current) rfInstance.current.fitView(fitOpts);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  /* eslint-enable react-hooks/exhaustive-deps */

  // Re-fit when node count/layout changes — only when no saved viewport
  useEffect(() => {
    if (rfInstance.current && !savedViewport.current) {
      const id = setTimeout(() => rfInstance.current?.fitView(fitOpts), 50);
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
