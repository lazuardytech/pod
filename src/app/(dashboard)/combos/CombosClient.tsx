"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { loadJsonStaleWhileRevalidate } from "@/shared/services/offlineJsonCache";
import {
  Button,
  Card,
  CardSkeleton,
  IconButton,
  Input,
  Modal,
  ModelSelectModal,
  SegmentedControl,
  Toggle,
} from "@/shared/components";
import LucideIcon from "@/shared/components/LucideIcon";
import { ConfirmModal } from "@/shared/components/Modal";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

import type { ChangeEvent, KeyboardEvent, MouseEvent, ButtonHTMLAttributes } from "react";
import type { DragEndEvent } from "@dnd-kit/core";

type ComboStrategy = { fallbackStrategy?: string; judgeModel?: string; [key: string]: unknown };

const COMBO_STRATEGY_OPTIONS = [
  { value: "fallback", label: "Fallback" },
  { value: "round-robin", label: "RR" },
  { value: "fusion", label: "Fusion" },
];

type CapacityCapKey = "vision" | "audioInput";

type CapacityCapEntry = {
  enabled: boolean;
  roundRobin: boolean;
  models: string[];
};

type CapacityAdapterState = Record<CapacityCapKey, CapacityCapEntry>;

type ComboItem = {
  id: string;
  name: string;
  models?: string[];
  kind?: string;
  systemPrompt?: string;
  contentFilterMessage?: string;
  modelId?: string;
  [key: string]: unknown;
};

type ActiveProvider = {
  id: string;
  provider: string;
  name?: string | null;
  [key: string]: unknown;
};

type ConfirmVariant = "default" | "danger" | "warning" | string;

type ConfirmDialogState = {
  open: boolean;
  title: string;
  message: string;
  onConfirm: (() => void) | null;
  variant: ConfirmVariant;
};

type ComboFormData = {
  name: string;
  models: string[];
  systemPrompt?: string | null;
  contentFilterMessage?: string | null;
  modelId?: string | null;
  [key: string]: unknown;
};

type TestStatus = "ok" | "error" | null;

type ComboTestResults = Record<string, TestStatus>;

interface SortableComboListProps {
  combos: ComboItem[];
  copied: string | null;
  onCopy: (text: string, id: string) => void;
  onEdit: (combo: ComboItem) => void;
  onDelete: (id: string) => void;
  comboStrategies: Record<string, ComboStrategy>;
  onSetComboStrategy: (comboName: string, fallbackStrategy: string) => void;
  onSetJudgeModel: (comboName: string, judgeModel: string | undefined) => void;
  activeProviders: ActiveProvider[];
  onTest: (combo: ComboItem) => void;
  testingComboId: string | null;
  comboTestResults: ComboTestResults;
  onDragEnd: (event: DragEndEvent) => void;
}

interface ComboCardProps {
  combo: ComboItem;
  copied: string | null;
  onCopy: (text: string, id: string) => void;
  onEdit: () => void;
  onDelete: () => void;
  fallbackStrategy: string;
  judgeModel?: string;
  onSetComboStrategy: (fallbackStrategy: string) => void;
  onSetJudgeModel: (judgeModel: string | undefined) => void;
  activeProviders: ActiveProvider[];
  onTest: () => void;
  isTesting: boolean;
  testStatus?: TestStatus;
  dragHandleProps?: Record<string, unknown>;
}

interface ModelItemProps {
  index: number;
  model: string;
  isFirst: boolean;
  isLast: boolean;
  onEdit: (val: string) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}

interface ComboFormModalProps {
  isOpen: boolean;
  combo?: ComboItem | null;
  onClose: () => void;
  onSave: (data: ComboFormData) => void | Promise<void>;
  activeProviders: ActiveProvider[];
  kindFilter?: string | null;
}

// Validate combo name: only a-z, A-Z, 0-9, -, _
const VALID_NAME_REGEX = /^[a-zA-Z0-9_.-]+$/;
const CACHE_COMBOS = "combos:list";
const CACHE_PROVIDERS = "combos:providers";
const CACHE_SETTINGS = "combos:settings";
const MAX_STALE_MS = 1000 * 60 * 60 * 24 * 7;

const EMPTY_CAP_ENTRY: CapacityCapEntry = { enabled: true, roundRobin: false, models: [] };
const EMPTY_CAPACITY_ADAPTER: CapacityAdapterState = {
  vision: { ...EMPTY_CAP_ENTRY, models: [] },
  audioInput: { ...EMPTY_CAP_ENTRY, models: [] },
};
const CAPACITY_ADAPTER_CAPS: Array<{ key: CapacityCapKey; label: string; desc: string }> = [
  { key: "vision", label: "Vision", desc: "Images (png, jpg, webp, …)" },
  { key: "audioInput", label: "Audio", desc: "Audio input" },
];

function normalizeCapEntry(entry: unknown): CapacityCapEntry {
  if (Array.isArray(entry)) {
    return {
      enabled: true,
      roundRobin: false,
      models: entry
        .map((e) => (typeof e === "string" ? e : (e as { model?: string })?.model))
        .filter((m): m is string => typeof m === "string" && !!m),
    };
  }
  if (entry && typeof entry === "object") {
    const rec = entry as { enabled?: unknown; roundRobin?: unknown; models?: unknown };
    return {
      enabled: rec.enabled !== false,
      roundRobin: !!rec.roundRobin,
      models: Array.isArray(rec.models)
        ? rec.models.filter((m): m is string => typeof m === "string" && !!m)
        : [],
    };
  }
  return { ...EMPTY_CAP_ENTRY, models: [] };
}

export default function CombosPage() {
  const [combos, setCombos] = useState<ComboItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingCombo, setEditingCombo] = useState<ComboItem | null>(null);
  const [activeProviders, setActiveProviders] = useState<ActiveProvider[]>([]);
  const [comboStrategies, setComboStrategies] = useState<Record<string, ComboStrategy>>({});
  const [capacityAdapter, setCapacityAdapter] =
    useState<CapacityAdapterState>(EMPTY_CAPACITY_ADAPTER);
  const { copied, copy } = useCopyToClipboard();
  const [testingComboId, setTestingComboId] = useState<string | null>(null);
  const [comboTestResults, setComboTestResults] = useState<ComboTestResults>({});
  const [testingAll, setTestingAll] = useState(false);

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
    variant: ConfirmVariant = "default",
  ) => setConfirmDialog({ open: true, title, message, onConfirm, variant });
  const closeConfirm = () =>
    setConfirmDialog((prev) => ({
      ...prev,
      open: false,
      onConfirm: null,
    }));

  const applyCombos = (data: unknown) => {
    const payload = data as { combos?: ComboItem[] };
    setCombos((payload?.combos || []).filter((c) => !c.kind));
  };
  const applyProviders = (data: unknown) => {
    const payload = data as { connections?: ActiveProvider[] };
    setActiveProviders(payload?.connections || []);
  };
  const applySettings = (data: unknown) => {
    const payload = data as {
      comboStrategies?: Record<string, ComboStrategy>;
      capacityAdapter?: Record<string, unknown>;
    };
    setComboStrategies(payload?.comboStrategies || {});
    const raw = payload?.capacityAdapter || {};
    setCapacityAdapter({
      vision: normalizeCapEntry(raw.vision),
      audioInput: normalizeCapEntry(raw.audioInput),
    });
  };

  const fetchData = async () => {
    try {
      await Promise.all([
        loadJsonStaleWhileRevalidate({
          url: "/api/combos",
          cacheKey: CACHE_COMBOS,
          maxStaleMs: MAX_STALE_MS,
          onCacheData: (d) => {
            applyCombos(d);
            setLoading(false);
          },
          onFreshData: applyCombos,
        }),
        loadJsonStaleWhileRevalidate({
          url: "/api/providers",
          cacheKey: CACHE_PROVIDERS,
          maxStaleMs: MAX_STALE_MS,
          onCacheData: applyProviders,
          onFreshData: applyProviders,
        }),
        loadJsonStaleWhileRevalidate({
          url: "/api/settings",
          cacheKey: CACHE_SETTINGS,
          maxStaleMs: MAX_STALE_MS,
          onCacheData: applySettings,
          onFreshData: applySettings,
        }),
      ]);
    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCreate = async (data: ComboFormData) => {
    try {
      const res = await fetch("/api/combos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        await fetchData();
        setShowCreateModal(false);
      } else {
        const err = await res.json();
        toast.error(err.error || "Failed to create combo");
      }
    } catch (error) {
      console.error("Error creating combo:", error);
    }
  };

  const handleUpdate = async (id: string, data: ComboFormData) => {
    try {
      const res = await fetch(`/api/combos/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        await fetchData();
        setEditingCombo(null);
      } else {
        const err = await res.json();
        toast.error(err.error || "Failed to update combo");
      }
    } catch (error) {
      console.error("Error updating combo:", error);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/combos/${id}`, { method: "DELETE" });
      if (res.ok) {
        setCombos(combos.filter((c) => c.id !== id));
      }
    } catch (error) {
      console.error("Error deleting combo:", error);
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = combos.findIndex((c) => c.id === active.id);
    const newIndex = combos.findIndex((c) => c.id === over.id);
    const reordered = arrayMove(combos, oldIndex, newIndex);
    setCombos(reordered);

    try {
      await fetch("/api/combos", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: reordered.map((c) => c.id) }),
      });
    } catch (error) {
      console.error("Error saving combo order:", error);
    }
  };

  const handleTestAll = async () => {
    if (testingAll || combos.length === 0) return;
    setTestingAll(true);
    setComboTestResults({});
    let passed = 0;
    let failed = 0;
    for (const combo of combos) {
      if (!combo.models?.length) continue;
      setTestingComboId(combo.id);
      try {
        const res = await fetch("/api/models/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: combo.models[0] }),
        });
        const data = await res.json();
        const ok = data?.ok ? "ok" : "error";
        setComboTestResults((prev) => ({ ...prev, [combo.id]: ok }));
        if (ok === "ok") passed++;
        else failed++;
      } catch {
        setComboTestResults((prev) => ({ ...prev, [combo.id]: "error" }));
        failed++;
      }
    }
    setTestingComboId(null);
    setTestingAll(false);
    if (failed === 0) toast.success(`All ${passed} combos passed`);
    else toast.warning(`${passed} passed, ${failed} failed`);
  };

  const handleTestCombo = async (combo: ComboItem) => {
    if (!combo.models?.length) return;
    setTestingComboId(combo.id);
    setComboTestResults((prev) => ({ ...prev, [combo.id]: null }));
    try {
      const model = combo.models[0];
      const res = await fetch("/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      });
      const data = await res.json();
      setComboTestResults((prev) => ({
        ...prev,
        [combo.id]: data?.ok ? "ok" : "error",
      }));
    } catch {
      setComboTestResults((prev) => ({ ...prev, [combo.id]: "error" }));
    } finally {
      setTestingComboId(null);
    }
  };

  const persistComboStrategy = async (comboName: string, patch: ComboStrategy) => {
    try {
      const updated = {
        ...comboStrategies,
        [comboName]: { ...comboStrategies[comboName], ...patch },
      };

      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comboStrategies: updated }),
      });

      setComboStrategies(updated);
    } catch (error) {
      console.error("Error updating combo strategy:", error);
    }
  };

  const persistCapacityAdapter = async (next: CapacityAdapterState) => {
    const previous = capacityAdapter;
    setCapacityAdapter(next);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capacityAdapter: next }),
      });
      if (!res.ok) {
        setCapacityAdapter(previous);
        toast.error("Failed to update Vision Adapter");
      }
    } catch (error) {
      setCapacityAdapter(previous);
      console.error("Error updating Vision Adapter:", error);
      toast.error("Failed to update Vision Adapter");
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">Combos</h1>
          <p className="text-sm text-text-muted mt-1">Create model combos with fallback support</p>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <Button
            variant="outline"
            size="sm"
            icon="play_arrow"
            loading={testingAll}
            onClick={handleTestAll}
            disabled={testingAll || combos.length === 0}
            title="Test all combos"
            className="w-full sm:w-auto"
          >
            {testingAll ? "Testing..." : "Test All"}
          </Button>
          <Button icon="add" onClick={() => setShowCreateModal(true)} className="w-full sm:w-auto">
            Create Combo
          </Button>
        </div>
      </div>

      <Card>
        <VisionAdapterSection
          capacityAdapter={capacityAdapter}
          onChange={(next) => void persistCapacityAdapter(next)}
          activeProviders={activeProviders}
        />
      </Card>

      {/* Combos List */}
      {loading ? (
        <div className="flex flex-col gap-4">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : combos.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-4">
              <LucideIcon name="layers" className="text-[32px]" />
            </div>
            <p className="text-text-main font-medium mb-1">No combos yet</p>
            <p className="text-sm text-text-muted mb-4">
              Create model combos with fallback support
            </p>
            <Button
              icon="add"
              onClick={() => setShowCreateModal(true)}
              className="w-full sm:w-auto"
            >
              Create Combo
            </Button>
          </div>
        </Card>
      ) : (
        <SortableComboList
          combos={combos}
          copied={copied}
          onCopy={copy}
          onEdit={(combo) => setEditingCombo(combo)}
          onDelete={(id) =>
            openConfirm(
              "Delete Combo",
              "Are you sure you want to delete this combo?",
              () => handleDelete(id),
              "danger",
            )
          }
          comboStrategies={comboStrategies}
          onSetComboStrategy={(name, fallbackStrategy) =>
            void persistComboStrategy(name, { fallbackStrategy })
          }
          onSetJudgeModel={(name, judgeModel) => void persistComboStrategy(name, { judgeModel })}
          activeProviders={activeProviders}
          onTest={handleTestCombo}
          testingComboId={testingComboId}
          comboTestResults={comboTestResults}
          onDragEnd={handleDragEnd}
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

      {/* Create Modal - Use key to force remount and reset state */}
      <ComboFormModal
        key="create"
        isOpen={showCreateModal}
        combo={null}
        onClose={() => setShowCreateModal(false)}
        onSave={handleCreate}
        activeProviders={activeProviders}
      />

      {/* Edit Modal - Use key to force remount and reset state */}
      <ComboFormModal
        key={editingCombo?.id || "new"}
        isOpen={!!editingCombo}
        combo={editingCombo}
        onClose={() => setEditingCombo(null)}
        onSave={(data: ComboFormData) => {
          if (editingCombo) void handleUpdate(editingCombo.id, data);
        }}
        activeProviders={activeProviders}
      />
    </div>
  );
}

function SortableComboList({
  combos,
  copied,
  onCopy,
  onEdit,
  onDelete,
  comboStrategies,
  onSetComboStrategy,
  onSetJudgeModel,
  activeProviders,
  onTest,
  testingComboId,
  comboTestResults,
  onDragEnd,
}: SortableComboListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={combos.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-4">
          {combos.map((combo) => (
            <SortableComboCard
              key={combo.id}
              combo={combo}
              copied={copied}
              onCopy={onCopy}
              onEdit={() => onEdit(combo)}
              onDelete={() => onDelete(combo.id)}
              fallbackStrategy={comboStrategies[combo.name]?.fallbackStrategy || "fallback"}
              judgeModel={comboStrategies[combo.name]?.judgeModel}
              onSetComboStrategy={(fallbackStrategy) =>
                onSetComboStrategy(combo.name, fallbackStrategy)
              }
              onSetJudgeModel={(judgeModel) => onSetJudgeModel(combo.name, judgeModel)}
              activeProviders={activeProviders}
              onTest={() => onTest(combo)}
              isTesting={testingComboId === combo.id}
              testStatus={comboTestResults[combo.id]}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableComboCard(props: ComboCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: props.combo.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <ComboCard
        {...props}
        dragHandleProps={{ ref: setActivatorNodeRef, ...attributes, ...listeners }}
      />
    </div>
  );
}

function modelValue(model: unknown): string {
  if (typeof model === "string") return model;
  if (model && typeof model === "object" && "value" in model) {
    return String((model as { value?: unknown }).value ?? "");
  }
  return "";
}

function ComboCard({
  combo,
  copied,
  onCopy,
  onEdit,
  onDelete,
  fallbackStrategy,
  judgeModel,
  onSetComboStrategy,
  onSetJudgeModel,
  activeProviders,
  onTest,
  isTesting,
  testStatus,
  dragHandleProps,
}: ComboCardProps) {
  const [showJudgeSelect, setShowJudgeSelect] = useState(false);
  const autoJudge = combo.models?.[0] || "first";

  return (
    <>
      <Card padding="sm" className="group">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
            {/* Drag handle */}
            <Button
              variant="ghost"
              size="icon"
              icon="drag_indicator"
              title="Drag to reorder"
              {...(dragHandleProps as ButtonHTMLAttributes<HTMLButtonElement>)}
              tabIndex={-1}
              className="shrink-0 cursor-grab touch-none text-text-muted/40 transition-colors hover:text-text-muted active:cursor-grabbing"
            />
            <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <LucideIcon name="layers" className="text-primary text-[18px]" />
            </div>
            <div className="min-w-0 flex-1">
              <code className="block truncate font-mono text-sm font-medium">{combo.name}</code>
              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1">
                {(combo.models?.length ?? 0) === 0 ? (
                  <span className="text-xs text-text-muted italic">No models</span>
                ) : (
                  (combo.models || []).slice(0, 3).map((model, index) => (
                    <code
                      key={index}
                      className="max-w-full truncate rounded bg-black/5 px-1.5 py-0.5 font-mono text-[10px] text-text-muted dark:bg-white/5 sm:max-w-[220px]"
                    >
                      {model}
                    </code>
                  ))
                )}
                {(combo.models?.length ?? 0) > 3 && (
                  <span className="text-[10px] text-text-muted">
                    +{(combo.models?.length ?? 0) - 3} more
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-3 sm:shrink-0">
            <div className="flex min-w-0 flex-col gap-1.5">
              <SegmentedControl
                size="sm"
                aria-label="Combo strategy"
                value={fallbackStrategy}
                onChange={onSetComboStrategy}
                options={COMBO_STRATEGY_OPTIONS}
              />
              {fallbackStrategy === "fusion" && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowJudgeSelect(true)}
                    title="Judge model"
                    className="max-w-full justify-start truncate"
                  >
                    Judge: {judgeModel || `Auto — ${autoJudge}`}
                  </Button>
                  <p className="text-[10px] text-text-muted">
                    Each request can bill all successful panels + judge (N+1).
                  </p>
                </>
              )}
            </div>

            <div className="grid grid-cols-4 gap-1 sm:flex">
              <Button
                variant="ghost"
                size="sm"
                icon={
                  isTesting
                    ? "progress_activity"
                    : testStatus === "ok"
                      ? "check_circle"
                      : testStatus === "error"
                        ? "error"
                        : "play_arrow"
                }
                loading={isTesting}
                onClick={(e: MouseEvent) => {
                  e.stopPropagation();
                  onTest?.();
                }}
                disabled={isTesting || !combo.models?.length}
                title="Test combo"
                className={`h-auto flex-col gap-0 px-2 py-1 ${
                  testStatus === "ok"
                    ? "text-emerald hover:bg-emerald/10"
                    : testStatus === "error"
                      ? "text-warning-red hover:bg-warning-red/10"
                      : "text-text-muted hover:text-primary"
                }`}
              >
                <span className="text-[10px] leading-tight font-normal">Test</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon={copied === `combo-${combo.id}` ? "check" : "content_copy"}
                onClick={(e: MouseEvent) => {
                  e.stopPropagation();
                  onCopy(combo.name, `combo-${combo.id}`);
                }}
                title="Copy combo name"
                className="h-auto flex-col gap-0 px-2 py-1 text-text-muted hover:text-primary"
              >
                <span className="text-[10px] leading-tight font-normal">Copy</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon="edit"
                onClick={onEdit}
                title="Edit"
                className="h-auto flex-col gap-0 px-2 py-1 text-text-muted hover:text-primary"
              >
                <span className="text-[10px] leading-tight font-normal">Edit</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon="delete"
                onClick={onDelete}
                title="Delete"
                className="h-auto flex-col gap-0 px-2 py-1 text-red-500 hover:bg-red-500/10"
              >
                <span className="text-[10px] leading-tight font-normal">Delete</span>
              </Button>
            </div>
          </div>
        </div>
      </Card>
      <ModelSelectModal
        isOpen={showJudgeSelect}
        onClose={() => setShowJudgeSelect(false)}
        onSelect={(model) => {
          const value = modelValue(model);
          if (value) onSetJudgeModel(value);
          setShowJudgeSelect(false);
        }}
        onDeselect={() => {
          onSetJudgeModel(undefined);
          setShowJudgeSelect(false);
        }}
        selectedModel={judgeModel}
        activeProviders={activeProviders}
        title="Judge model"
        addedModelValues={judgeModel ? [judgeModel] : []}
        closeOnSelect
      />
    </>
  );
}

// Inline editable model item
function ModelItem({
  index,
  model,
  isFirst,
  isLast,
  onEdit,
  onMoveUp,
  onMoveDown,
  onRemove,
}: ModelItemProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(model);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== model) onEdit(trimmed);
    else setDraft(model); // revert if empty or unchanged
    setEditing(false);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") commit();
    if (e.key === "Escape") {
      setDraft(model);
      setEditing(false);
    }
  };

  return (
    <div className="group flex min-w-0 items-center gap-1.5 rounded-md bg-black/[0.02] px-2 py-1 transition-colors hover:bg-black/[0.04] dark:bg-white/[0.02] dark:hover:bg-white/[0.04]">
      {/* Index badge */}
      <span className="text-[10px] font-medium text-text-muted w-3 text-center shrink-0">
        {index + 1}
      </span>

      {/* Inline editable model value */}
      {editing ? (
        <input
          aria-label="Model value"
          autoFocus
          value={draft}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={handleKeyDown}
          className="min-w-0 flex-1 rounded border border-primary/40 bg-white px-1.5 py-0.5 font-mono text-xs text-text-main outline-none dark:bg-black/20"
          name="model-value"
        />
      ) : (
        <div
          className="min-w-0 flex-1 cursor-text truncate rounded px-1.5 py-0.5 font-mono text-xs text-text-main hover:bg-black/5 dark:hover:bg-white/5"
          onClick={() => setEditing(true)}
          title="Click to edit"
        >
          {model}
        </div>
      )}

      {/* Priority arrows */}
      <div className="flex shrink-0 items-center gap-0.5">
        <IconButton
          icon="arrow_upward"
          title="Move up"
          size="sm"
          onClick={onMoveUp}
          disabled={isFirst}
          className={isFirst ? "text-text-muted/20" : "text-text-muted hover:text-primary"}
        />
        <IconButton
          icon="arrow_downward"
          title="Move down"
          size="sm"
          onClick={onMoveDown}
          disabled={isLast}
          className={isLast ? "text-text-muted/20" : "text-text-muted hover:text-primary"}
        />
      </div>

      {/* Remove */}
      <IconButton
        icon="close"
        title="Remove"
        size="sm"
        onClick={onRemove}
        className="text-text-muted hover:bg-red-500/10 hover:text-red-500"
      />
    </div>
  );
}

const SYSTEM_PROMPT_MAX = 50000;

function ComboFormModal({
  isOpen,
  combo,
  onClose,
  onSave,
  activeProviders,
  kindFilter = null,
}: ComboFormModalProps) {
  // Initialize state with combo values - key prop on parent handles reset on remount
  const [name, setName] = useState(combo?.name || "");
  const [models, setModels] = useState<string[]>(combo?.models || []);
  const [systemPrompt, setSystemPrompt] = useState(combo?.systemPrompt || "");
  const [modelId, setModelId] = useState(combo?.modelId || "");
  const [contentFilterMessage, setContentFilterMessage] = useState(
    combo?.contentFilterMessage || "",
  );
  const [showModelSelect, setShowModelSelect] = useState(false);
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState("");
  const [modelAliases, setModelAliases] = useState<Record<string, string>>({});

  const fetchModalData = async () => {
    try {
      const aliasesRes = await fetch("/api/models/alias");
      if (!aliasesRes.ok) return;
      const aliasesData = await aliasesRes.json();
      setModelAliases(aliasesData.aliases || {});
    } catch (error) {
      console.error("Error fetching modal data:", error);
    }
  };

  useEffect(() => {
    if (isOpen) fetchModalData();
  }, [isOpen]);

  const validateName = (value: string) => {
    if (!value.trim()) {
      setNameError("Name is required");
      return false;
    }
    if (!VALID_NAME_REGEX.test(value)) {
      setNameError("Only letters, numbers, -, _ and . allowed");
      return false;
    }
    setNameError("");
    return true;
  };

  const handleNameChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setName(value);
    if (value) validateName(value);
    else setNameError("");
  };

  const handleAddModel = (model: unknown) => {
    const value =
      typeof model === "string"
        ? model
        : model && typeof model === "object" && "value" in model
          ? String((model as { value?: unknown }).value ?? "")
          : "";
    if (!value || models.includes(value)) return;
    setModels([...models, value]);
  };

  const handleDeselectModel = (model: unknown) => {
    const value =
      model && typeof model === "object" && "value" in model
        ? String((model as { value?: unknown }).value ?? "")
        : String(model);
    setModels(models.filter((m) => m !== value));
  };

  const handleRemoveModel = (index: number) => {
    setModels(models.filter((_, i) => i !== index));
  };

  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    const newModels = [...models];
    const a = newModels[index - 1]!;
    const b = newModels[index]!;
    newModels[index - 1] = b;
    newModels[index] = a;
    setModels(newModels);
  };

  const handleMoveDown = (index: number) => {
    if (index === models.length - 1) return;
    const newModels = [...models];
    const a = newModels[index]!;
    const b = newModels[index + 1]!;
    newModels[index] = b;
    newModels[index + 1] = a;
    setModels(newModels);
  };

  const handleSave = async () => {
    if (!validateName(name)) return;
    if (systemPrompt.length > SYSTEM_PROMPT_MAX) return;
    setSaving(true);
    await onSave({
      name: name.trim(),
      models,
      systemPrompt: systemPrompt.trim() || null,
      modelId: modelId.trim() || null,
      contentFilterMessage: contentFilterMessage.trim() || null,
    });
    setSaving(false);
  };

  const isEdit = !!combo;

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title={isEdit ? "Edit Combo" : "Create Combo"}>
        <div className="flex flex-col gap-3">
          {/* Name */}
          <div>
            <Input
              label="Combo Name"
              value={name}
              onChange={handleNameChange}
              placeholder="my-combo"
              error={nameError}
            />
            <p className="text-[10px] text-text-muted mt-0.5">
              Only letters, numbers, -, _ and . allowed
            </p>
          </div>

          {/* Models */}
          <div>
            <label className="text-sm font-medium mb-1.5 block">Models</label>

            {models.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-1 py-4 border border-dashed border-black/10 dark:border-white/10 rounded-lg bg-black/[0.01] dark:bg-white/[0.01]">
                <LucideIcon name="layers" className="text-[20px] text-text-muted" />
                <p className="text-xs text-text-muted">No models added yet</p>
              </div>
            ) : (
              <div className="flex max-h-[55vh] min-w-0 flex-col gap-1 overflow-y-auto sm:max-h-[350px]">
                {models.map((model, index) => (
                  <ModelItem
                    key={index}
                    index={index}
                    model={model}
                    isFirst={index === 0}
                    isLast={index === models.length - 1}
                    onEdit={(newVal) => {
                      const updated = [...models];
                      updated[index] = newVal;
                      setModels(updated);
                    }}
                    onMoveUp={() => handleMoveUp(index)}
                    onMoveDown={() => handleMoveDown(index)}
                    onRemove={() => handleRemoveModel(index)}
                  />
                ))}
              </div>
            )}

            {/* Add Model button */}
            <Button
              variant="outline"
              size="sm"
              icon="add"
              onClick={() => setShowModelSelect(true)}
              className="mt-2 w-full border-dashed text-xs font-medium text-primary hover:border-primary/50"
            >
              Add Model
            </Button>
          </div>

          {/* Model ID */}
          <div>
            <Input
              label={
                <>
                  Model ID <span className="text-text-muted font-normal">(optional)</span>
                </>
              }
              value={modelId}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setModelId(e.target.value)}
              placeholder="e.g. melma-zen"
            />
            <p className="text-[10px] text-text-muted mt-0.5">
              Override the model name returned to clients in API responses.
            </p>
          </div>

          {/* Content Filter Message */}
          <div>
            <Input
              label={
                <>
                  Content Filter Message{" "}
                  <span className="text-text-muted font-normal">(optional)</span>
                </>
              }
              value={contentFilterMessage}
              onChange={(e) => setContentFilterMessage(e.target.value.slice(0, 2000))}
              placeholder="e.g. I'm sorry, I can't help with that."
            />
            <p className="text-[10px] text-text-muted mt-0.5">
              Humanistic reply shown to clients when upstream content filter is triggered. Defaults
              to a programmatic error if not set.
            </p>
          </div>

          {/* System Prompt */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label
                className="text-[13px] font-[510] text-porcelain tracking-[-0.12px]"
                htmlFor="combo-system-prompt"
              >
                System Prompt <span className="text-fog-grey font-[400]">(optional)</span>
              </label>
              <span
                className={`text-[10px] ${systemPrompt.length > SYSTEM_PROMPT_MAX ? "text-warning-red" : "text-fog-grey"}`}
              >
                {systemPrompt.length.toLocaleString()} / {SYSTEM_PROMPT_MAX.toLocaleString()}
              </span>
            </div>
            <textarea
              id="combo-system-prompt"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value.slice(0, SYSTEM_PROMPT_MAX))}
              placeholder="Optional system prompt injected into every request routed through this combo (max 50000 chars)."
              rows={6}
              className="w-full rounded-[6px] border border-charcoal-grey bg-deep-slate px-3 py-2 text-[13px] text-porcelain placeholder:text-fog-grey outline-none focus:border-porcelain/30 resize-y min-h-[96px] transition-colors duration-100"
            />
            <p className="text-[10px] text-fog-grey mt-0.5">
              Will be prepended as a system message to every model call routed via this combo.
            </p>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2 pt-1 sm:flex-row">
            <Button onClick={onClose} variant="ghost" fullWidth size="sm">
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              fullWidth
              size="sm"
              disabled={
                !name.trim() || !!nameError || saving || systemPrompt.length > SYSTEM_PROMPT_MAX
              }
            >
              {saving ? "Saving..." : isEdit ? "Save" : "Create"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Model Select Modal */}
      <ModelSelectModal
        isOpen={showModelSelect}
        onClose={() => setShowModelSelect(false)}
        onSelect={handleAddModel}
        onDeselect={handleDeselectModel}
        selectedModel={undefined}
        activeProviders={activeProviders}
        modelAliases={modelAliases}
        title="Add Model to Combo"
        kindFilter={kindFilter}
        addedModelValues={models}
        closeOnSelect={false}
      />
    </>
  );
}

function VisionAdapterSection({
  capacityAdapter,
  onChange,
  activeProviders,
}: {
  capacityAdapter: CapacityAdapterState;
  onChange: (next: CapacityAdapterState) => void;
  activeProviders: ActiveProvider[];
}) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold">Vision Adapter</h2>
        <p className="text-sm text-text-muted mt-1">
          If the current model cannot read image or audio, route to a pool model instead of dropping
          the media. Empty pool is a no-op.
        </p>
      </div>
      <div className="flex flex-col gap-4">
        {CAPACITY_ADAPTER_CAPS.map((cap) => (
          <VisionAdapterCap
            key={cap.key}
            cap={cap}
            entry={capacityAdapter[cap.key] || EMPTY_CAP_ENTRY}
            onChange={(entry) => onChange({ ...capacityAdapter, [cap.key]: entry })}
            activeProviders={activeProviders}
          />
        ))}
      </div>
    </div>
  );
}

function VisionAdapterCap({
  cap,
  entry,
  onChange,
  activeProviders,
}: {
  cap: { key: CapacityCapKey; label: string; desc: string };
  entry: CapacityCapEntry;
  onChange: (entry: CapacityCapEntry) => void;
  activeProviders: ActiveProvider[];
}) {
  const [showModelSelect, setShowModelSelect] = useState(false);
  const { enabled, roundRobin, models } = entry;
  const patch = (p: Partial<CapacityCapEntry>) => onChange({ ...entry, ...p });

  const handleAdd = (model: unknown) => {
    const value =
      typeof model === "string"
        ? model
        : model && typeof model === "object" && "value" in model
          ? String((model as { value?: unknown }).value ?? "")
          : "";
    if (!value || models.includes(value)) return;
    patch({ models: [...models, value] });
  };

  return (
    <div className={`flex flex-col gap-3 ${enabled ? "" : "opacity-50"}`}>
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Toggle
            checked={enabled}
            onChange={(v) => patch({ enabled: v })}
            aria-label={`Enable ${cap.label} adapter`}
          />
          <div className="min-w-0">
            <p className="font-medium text-sm">{cap.label}</p>
            <p className="text-xs text-text-muted">{cap.desc}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-text-muted">Round-robin</span>
            <Toggle
              checked={roundRobin}
              onChange={(v) => patch({ roundRobin: v })}
              aria-label={`${cap.label} round-robin`}
            />
          </div>
          <Button size="sm" variant="outline" icon="add" onClick={() => setShowModelSelect(true)}>
            Add
          </Button>
        </div>
      </div>
      {models.length === 0 ? (
        <p className="text-xs text-text-muted italic">No models in pool</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {models.map((model, index) => (
            <code
              key={`${model}-${index}`}
              className="inline-flex items-center gap-1 rounded bg-black/5 px-1.5 py-0.5 font-mono text-xs text-text-muted dark:bg-white/5"
            >
              {model}
              <button
                type="button"
                onClick={() => patch({ models: models.filter((_, i) => i !== index) })}
                className="text-text-muted hover:text-warning-red leading-none"
                aria-label={`Remove ${model}`}
              >
                <LucideIcon name="close" className="text-[12px]" />
              </button>
            </code>
          ))}
        </div>
      )}
      <ModelSelectModal
        isOpen={showModelSelect}
        onClose={() => setShowModelSelect(false)}
        onSelect={handleAdd}
        selectedModel={undefined}
        activeProviders={activeProviders}
        title={`Add ${cap.label} model`}
        addedModelValues={models}
        closeOnSelect={false}
        capabilityFilter={cap.key}
      />
    </div>
  );
}
