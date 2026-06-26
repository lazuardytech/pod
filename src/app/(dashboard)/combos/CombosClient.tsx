"use client";

import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
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
import { Button, Card, CardSkeleton, Input, Modal, ModelSelectModal, Toggle } from "@/shared/components";
import LucideIcon from "@/shared/components/LucideIcon";
import { ConfirmModal } from "@/shared/components/Modal";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

// Validate combo name: only a-z, A-Z, 0-9, -, _
const VALID_NAME_REGEX = /^[a-zA-Z0-9_.-]+$/;

export default function CombosPage() {
  const [combos, setCombos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingCombo, setEditingCombo] = useState<any>(null);
  const [activeProviders, setActiveProviders] = useState<any[]>([]);
  const [comboStrategies, setComboStrategies] = useState<Record<string, any>>({});
  const { copied, copy } = useCopyToClipboard();
  const [testingComboId, setTestingComboId] = useState<any>(null);
  const [comboTestResults, setComboTestResults] = useState({});
  const [testingAll, setTestingAll] = useState(false);

  const [confirmDialog, setConfirmDialog] = useState({
    open: false,
    title: "",
    message: "",
    onConfirm: null as (() => void) | null,
    variant: "default",
  });
  const openConfirm = (title: any, message: any, onConfirm: any, variant: any = "default") =>
    setConfirmDialog({ open: true, title, message, onConfirm, variant });
  const closeConfirm = () =>
    setConfirmDialog((prev: any) => ({ ...prev, open: false, onConfirm: null as (() => void) | null }));

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [combosRes, providersRes, settingsRes] = await Promise.all([
        fetch("/api/combos"),
        fetch("/api/providers"),
        fetch("/api/settings"),
      ]);
      const combosData = await combosRes.json();
      const providersData = await providersRes.json();
      const settingsData = settingsRes.ok ? await settingsRes.json() : {};

      // Only LLM combos here — webSearch/webFetch combos belong to media-providers/web
      if (combosRes.ok) setCombos((combosData.combos || []).filter((c: any) => !c.kind));
      if (providersRes.ok) {
        setActiveProviders(providersData.connections || []);
      }
      setComboStrategies(settingsData.comboStrategies || {});
    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (data: any) => {
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

  const handleUpdate = async (id: any, data: any) => {
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

  const handleDelete = async (id: any) => {
    try {
      const res = await fetch(`/api/combos/${id}`, { method: "DELETE" });
      if (res.ok) {
        setCombos(combos.filter((c: any) => c.id !== id));
      }
    } catch (error) {
      console.error("Error deleting combo:", error);
    }
  };

  const handleDragEnd = async (event: any) => {
    const { active, over } = event ?? ({} as any);
    if (!over || active.id === over.id) return;

    const oldIndex = combos.findIndex((c: any) => c.id === active.id);
    const newIndex = combos.findIndex((c: any) => c.id === over.id);
    const reordered = arrayMove(combos, oldIndex, newIndex);
    setCombos(reordered);

    try {
      await fetch("/api/combos", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: reordered.map((c: any) => c.id) }),
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
        setComboTestResults((prev: any) => ({ ...prev, [combo.id]: ok }));
        if (ok === "ok") passed++;
        else failed++;
      } catch {
        setComboTestResults((prev: any) => ({ ...prev, [combo.id]: "error" }));
        failed++;
      }
    }
    setTestingComboId(null);
    setTestingAll(false);
    if (failed === 0) toast.success(`All ${passed} combos passed`);
    else toast.warning(`${passed} passed, ${failed} failed`);
  };

  const handleTestCombo = async (combo: any) => {
    if (!combo.models?.length) return;
    setTestingComboId(combo.id);
    setComboTestResults((prev: any) => ({ ...prev, [combo.id]: null }));
    try {
      const model = combo.models[0];
      const res = await fetch("/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      });
      const data = await res.json();
      setComboTestResults((prev: any) => ({
        ...prev,
        [combo.id]: data?.ok ? "ok" : "error",
      }));
    } catch {
      setComboTestResults((prev: any) => ({ ...prev, [combo.id]: "error" }));
    } finally {
      setTestingComboId(null);
    }
  };

  const handleToggleRoundRobin = async (comboName: any, enabled: any) => {
    try {
      const updated = { ...comboStrategies };
      if (enabled) {
        updated[comboName] = { fallbackStrategy: "round-robin" };
      } else {
        delete updated[comboName];
      }

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

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">Combos</h1>
          <p className="text-sm text-text-muted mt-1">Create model combos with fallback support</p>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <button
            onClick={handleTestAll}
            disabled={testingAll || combos.length === 0}
            className={`flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors sm:w-auto sm:py-1.5 ${
              testingAll
                ? "bg-primary/20 border-primary/40 text-primary animate-pulse"
                : "bg-bg border-border text-text-muted hover:text-text-main hover:border-primary/40 disabled:opacity-50"
            }`}
            title="Test all combos"
          >
            <LucideIcon
              name={testingAll ? "progress_activity" : "play_arrow"}
              className={`text-[14px]${testingAll ? " animate-spin" : ""}`}
            />
            {testingAll ? "Testing..." : "Test All"}
          </button>
          <Button icon="add" onClick={() => setShowCreateModal(true)} className="w-full sm:w-auto">
            Create Combo
          </Button>
        </div>
      </div>

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
            <p className="text-sm text-text-muted mb-4">Create model combos with fallback support</p>
            <Button icon="add" onClick={() => setShowCreateModal(true)} className="w-full sm:w-auto">
              Create Combo
            </Button>
          </div>
        </Card>
      ) : (
        <SortableComboList
          combos={combos}
          copied={copied}
          onCopy={copy}
          onEdit={(combo: any) => setEditingCombo(combo)}
          onDelete={(id: any) =>
            openConfirm("Delete Combo", "Are you sure you want to delete this combo?", () => handleDelete(id), "danger")
          }
          comboStrategies={comboStrategies}
          onToggleRoundRobin={handleToggleRoundRobin}
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
        onSave={(data: any) => handleUpdate(editingCombo.id, data)}
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
  onToggleRoundRobin,
  onTest,
  testingComboId,
  comboTestResults,
  onDragEnd,
}: any) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={combos.map((c: any) => c.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-4">
          {combos.map((combo: any) => (
            <SortableComboCard
              key={combo.id}
              combo={combo}
              copied={copied}
              onCopy={onCopy}
              onEdit={() => onEdit(combo)}
              onDelete={() => onDelete(combo.id)}
              roundRobinEnabled={comboStrategies[combo.name]?.fallbackStrategy === "round-robin"}
              onToggleRoundRobin={(enabled: any) => onToggleRoundRobin(combo.name, enabled)}
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

function SortableComboCard(props: any) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
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
      <ComboCard {...props} dragHandleProps={{ ref: setActivatorNodeRef, ...attributes, ...listeners }} />
    </div>
  );
}

function ComboCard({
  combo,
  copied,
  onCopy,
  onEdit,
  onDelete,
  roundRobinEnabled,
  onToggleRoundRobin,
  onTest,
  isTesting,
  testStatus,
  dragHandleProps,
}: any) {
  return (
    <Card padding="sm" className="group">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
          {/* Drag handle */}
          <button
            {...dragHandleProps}
            className="shrink-0 cursor-grab active:cursor-grabbing text-text-muted/40 hover:text-text-muted transition-colors touch-none"
            title="Drag to reorder"
            tabIndex={-1}
          >
            <LucideIcon name="drag_indicator" className="text-[18px]" />
          </button>
          <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <LucideIcon name="layers" className="text-primary text-[18px]" />
          </div>
          <div className="min-w-0 flex-1">
            <code className="block truncate font-mono text-sm font-medium">{combo.name}</code>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1">
              {combo.models.length === 0 ? (
                <span className="text-xs text-text-muted italic">No models</span>
              ) : (
                combo.models.slice(0, 3).map((model: any, index: any) => (
                  <code
                    key={index}
                    className="max-w-full truncate rounded bg-black/5 px-1.5 py-0.5 font-mono text-[10px] text-text-muted dark:bg-white/5 sm:max-w-[220px]"
                  >
                    {model}
                  </code>
                ))
              )}
              {combo.models.length > 3 && (
                <span className="text-[10px] text-text-muted">+{combo.models.length - 3} more</span>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-3 sm:shrink-0">
          {/* Round Robin Toggle — always visible */}
          <div className="flex items-center justify-between gap-1.5 rounded-lg bg-black/[0.02] px-2 py-1.5 dark:bg-white/[0.02] sm:justify-start sm:bg-transparent sm:px-0 sm:py-0 sm:dark:bg-transparent">
            <span className="text-xs text-text-muted font-medium">Round Robin</span>
            <Toggle size="sm" checked={roundRobinEnabled} onChange={onToggleRoundRobin} />
          </div>

          <div className="grid grid-cols-4 gap-1 sm:flex">
            <button
              onClick={(e: any) => {
                e.stopPropagation();
                onTest?.();
              }}
              disabled={isTesting || !combo.models?.length}
              className={`flex flex-col items-center rounded px-2 py-1 transition-colors disabled:opacity-50 ${
                testStatus === "ok"
                  ? "text-emerald hover:bg-emerald/10"
                  : testStatus === "error"
                    ? "text-warning-red hover:bg-warning-red/10"
                    : "text-text-muted hover:bg-black/5 hover:text-primary dark:hover:bg-white/5"
              }`}
              title="Test combo"
            >
              <LucideIcon
                name={
                  isTesting
                    ? "progress_activity"
                    : testStatus === "ok"
                      ? "check_circle"
                      : testStatus === "error"
                        ? "error"
                        : "play_arrow"
                }
                className={`text-[18px] ${isTesting ? "animate-spin" : ""}`}
              />
              <span className="text-[10px] leading-tight">Test</span>
            </button>
            <button
              onClick={(e: any) => {
                e.stopPropagation();
                onCopy(combo.name, `combo-${combo.id}`);
              }}
              className="flex flex-col items-center rounded px-2 py-1 text-text-muted transition-colors hover:bg-black/5 hover:text-primary dark:hover:bg-white/5"
              title="Copy combo name"
            >
              <LucideIcon name={copied === `combo-${combo.id}` ? "check" : "content_copy"} className="text-[18px]" />
              <span className="text-[10px] leading-tight">Copy</span>
            </button>
            <button
              onClick={onEdit}
              className="flex flex-col items-center rounded px-2 py-1 text-text-muted transition-colors hover:bg-black/5 hover:text-primary dark:hover:bg-white/5"
              title="Edit"
            >
              <LucideIcon name="edit" className="text-[18px]" />
              <span className="text-[10px] leading-tight">Edit</span>
            </button>
            <button
              onClick={onDelete}
              className="flex flex-col items-center rounded px-2 py-1 text-red-500 transition-colors hover:bg-red-500/10"
              title="Delete"
            >
              <LucideIcon name="delete" className="text-[18px]" />
              <span className="text-[10px] leading-tight">Delete</span>
            </button>
          </div>
        </div>
      </div>
    </Card>
  );
}

// Inline editable model item
function ModelItem({ index, model, isFirst, isLast, onEdit, onMoveUp, onMoveDown, onRemove }: any) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(model);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== model) onEdit(trimmed);
    else setDraft(model); // revert if empty or unchanged
    setEditing(false);
  };

  const handleKeyDown = (e: any) => {
    if (e.key === "Enter") commit();
    if (e.key === "Escape") {
      setDraft(model);
      setEditing(false);
    }
  };

  return (
    <div className="group flex min-w-0 items-center gap-1.5 rounded-md bg-black/[0.02] px-2 py-1 transition-colors hover:bg-black/[0.04] dark:bg-white/[0.02] dark:hover:bg-white/[0.04]">
      {/* Index badge */}
      <span className="text-[10px] font-medium text-text-muted w-3 text-center shrink-0">{index + 1}</span>

      {/* Inline editable model value */}
      {editing ? (
        <input
          aria-label="Model value"
          autoFocus
          value={draft}
          onChange={(e: any) => setDraft(e.target.value)}
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
        <button
          onClick={onMoveUp}
          disabled={isFirst}
          className={`p-0.5 rounded ${isFirst ? "text-text-muted/20 cursor-not-allowed" : "text-text-muted hover:text-primary hover:bg-black/5 dark:hover:bg-white/5"}`}
          title="Move up"
        >
          <LucideIcon name="arrow_upward" className="text-[12px]" />
        </button>
        <button
          onClick={onMoveDown}
          disabled={isLast}
          className={`p-0.5 rounded ${isLast ? "text-text-muted/20 cursor-not-allowed" : "text-text-muted hover:text-primary hover:bg-black/5 dark:hover:bg-white/5"}`}
          title="Move down"
        >
          <LucideIcon name="arrow_downward" className="text-[12px]" />
        </button>
      </div>

      {/* Remove */}
      <button
        onClick={onRemove}
        className="p-0.5 hover:bg-red-500/10 rounded text-text-muted hover:text-red-500 transition-all"
        title="Remove"
      >
        <LucideIcon name="close" className="text-[12px]" />
      </button>
    </div>
  );
}

const SYSTEM_PROMPT_MAX = 50000;

function ComboFormModal({ isOpen, combo, onClose, onSave, activeProviders, kindFilter = null }: any) {
  // Initialize state with combo values - key prop on parent handles reset on remount
  const [name, setName] = useState(combo?.name || "");
  const [models, setModels] = useState(combo?.models || []);
  const [systemPrompt, setSystemPrompt] = useState(combo?.systemPrompt || "");
  const [modelId, setModelId] = useState(combo?.modelId || "");
  const [contentFilterMessage, setContentFilterMessage] = useState(combo?.contentFilterMessage || "");
  const [showModelSelect, setShowModelSelect] = useState(false);
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState("");
  const [modelAliases, setModelAliases] = useState({});

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

  const validateName = (value: any) => {
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

  const handleNameChange = (e: any) => {
    const value = e.target.value;
    setName(value);
    if (value) validateName(value);
    else setNameError("");
  };

  const handleAddModel = (model: any) => {
    if (!models.includes(model.value)) {
      setModels([...models, model.value]);
    }
  };

  const handleDeselectModel = (model: any) => {
    setModels(models.filter((m: any) => m !== model.value));
  };

  const handleRemoveModel = (index: any) => {
    setModels(models.filter((_: any, i: any) => i !== index));
  };

  const handleMoveUp = (index: any) => {
    if (index === 0) return;
    const newModels = [...models];
    [newModels[index - 1], newModels[index]] = [newModels[index], newModels[index - 1]];
    setModels(newModels);
  };

  const handleMoveDown = (index: any) => {
    if (index === models.length - 1) return;
    const newModels = [...models];
    [newModels[index], newModels[index + 1]] = [newModels[index + 1], newModels[index]];
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
            <p className="text-[10px] text-text-muted mt-0.5">Only letters, numbers, -, _ and . allowed</p>
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
                {models.map((model: any, index: any) => (
                  <ModelItem
                    key={index}
                    index={index}
                    model={model}
                    isFirst={index === 0}
                    isLast={index === models.length - 1}
                    onEdit={(newVal: any) => {
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
            <button
              onClick={() => setShowModelSelect(true)}
              className="w-full mt-2 py-2 border border-dashed border-black/10 dark:border-white/10 rounded-lg text-xs text-primary font-medium hover:text-primary hover:border-primary/50 transition-colors flex items-center justify-center gap-1"
            >
              <LucideIcon name="add" className="text-[16px]" />
              Add Model
            </button>
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
              onChange={(e: any) => setModelId(e.target.value)}
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
                  Content Filter Message <span className="text-text-muted font-normal">(optional)</span>
                </>
              }
              value={contentFilterMessage}
              onChange={(e: any) => setContentFilterMessage(e.target.value.slice(0, 2000))}
              placeholder="e.g. I'm sorry, I can't help with that."
            />
            <p className="text-[10px] text-text-muted mt-0.5">
              Humanistic reply shown to clients when upstream content filter is triggered. Defaults to a programmatic
              error if not set.
            </p>
          </div>

          {/* System Prompt */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[13px] font-[510] text-porcelain tracking-[-0.12px]" htmlFor="combo-system-prompt">
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
              onChange={(e: any) => setSystemPrompt(e.target.value.slice(0, SYSTEM_PROMPT_MAX))}
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
              disabled={!name.trim() || !!nameError || saving || systemPrompt.length > SYSTEM_PROMPT_MAX}
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
        selectedModel={null}
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
