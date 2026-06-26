"use client";
import React from "react";
import PropTypes from "prop-types";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge, Button, Input, Modal } from "@/shared/components";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

// Dual-mode modal: edit when `node` provided, add otherwise
export default function AddCustomEmbeddingModal({
  isOpen,
  onClose,
  onCreated,
  onSaved,
  node,
}: {
  isOpen?: any;
  onClose?: any;
  onCreated?: any;
  onSaved?: any;
  node?: any;
  [key: string]: any;
}) {
  const isEdit = !!node;
  const [formData, setFormData] = useState({
    name: "",
    prefix: "",
    baseUrl: DEFAULT_BASE_URL,
  });
  const [submitting, setSubmitting] = useState(false);
  const [checkKey, setCheckKey] = useState("");
  const [checkModelId, setCheckModelId] = useState("");
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<any>(null);

  useEffect(() => {
    if (!isOpen) return;
    setValidationResult(null);
    setCheckKey("");
    setCheckModelId("");
    if (isEdit) {
      setFormData({
        name: node.name || "",
        prefix: node.prefix || "",
        baseUrl: node.baseUrl || DEFAULT_BASE_URL,
      });
    } else {
      setFormData({ name: "", prefix: "", baseUrl: DEFAULT_BASE_URL });
    }
  }, [isOpen, isEdit, node]);

  const handleSubmit = async () => {
    if (!formData.name.trim() || !formData.prefix.trim() || !formData.baseUrl.trim()) return;
    setSubmitting(true);
    try {
      const url = isEdit ? `/api/provider-nodes/${node.id}` : "/api/provider-nodes";
      const method = isEdit ? "PUT" : "POST";
      const payload: Record<string, any> = {
        name: formData.name,
        prefix: formData.prefix,
        baseUrl: formData.baseUrl,
      };
      if (!isEdit) (payload as any).type = "custom-embedding";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (isEdit) onSaved?.(data.node);
        else onCreated?.(data.node);
        toast.success(isEdit ? "Embedding node saved" : "Embedding node created");
      } else {
        toast.error(data?.error || `Failed to ${isEdit ? "save" : "create"} node (HTTP ${res.status})`);
      }
    } catch (error) {
      console.error("Error saving custom embedding node:", error);
      toast.error("Network error — could not reach the server");
    } finally {
      setSubmitting(false);
    }
  };

  const handleValidate = async () => {
    setValidating(true);
    try {
      const res = await fetch("/api/provider-nodes/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: formData.baseUrl,
          apiKey: checkKey,
          type: "custom-embedding",
          modelId: checkModelId.trim() || undefined,
        }),
      });
      const data = await res.json();
      setValidationResult(data);
    } catch {
      setValidationResult({ valid: false, error: "Network error" });
    } finally {
      setValidating(false);
    }
  };

  const renderValidationResult = () => {
    if (!validationResult) return null;
    const { valid, error, dimensions  } = validationResult ?? {} as any;
    if (valid) {
      return (
        <>
          <Badge variant="success">Valid</Badge>
          {dimensions && <span className="text-sm text-text-muted">{dimensions} dims</span>}
        </>
      );
    }
    return (
      <div className="flex flex-col gap-1">
        <Badge variant="error">Invalid</Badge>
        {error && <span className="text-sm text-red-500">{error}</span>}
      </div>
    );
  };

  return (
    <Modal isOpen={isOpen} title={isEdit ? "Edit Custom Embedding" : "Add Custom Embedding"} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Input
          label="Name"
          value={formData.name}
          onChange={(e: any) => setFormData({ ...formData, name: e.target.value })}
          placeholder="Voyage AI"
          hint="Required. A friendly label for this embedding provider."
        />
        <Input
          label="Prefix"
          value={formData.prefix}
          onChange={(e: any) => setFormData({ ...formData, prefix: e.target.value })}
          placeholder="voyage"
          hint="Required. Used as the provider prefix for model IDs (e.g. voyage/voyage-3)."
        />
        <Input
          label="Base URL"
          value={formData.baseUrl}
          onChange={(e: any) => setFormData({ ...formData, baseUrl: e.target.value })}
          placeholder="https://api.voyageai.com/v1"
          hint="Most embedding APIs are OpenAI-compatible: Voyage, Cohere, Jina, Mistral, Together..."
        />
        <Input
          label="API Key (for Check)"
          type="password"
          value={checkKey}
          onChange={(e: any) => setCheckKey(e.target.value)}
        />
        <Input
          label="Model ID (for Check)"
          value={checkModelId}
          onChange={(e: any) => setCheckModelId(e.target.value)}
          placeholder="e.g. voyage-3, embed-english-v3.0, text-embedding-3-small"
          hint="Required for validation. Will send a test embeddings request."
        />
        <div className="flex items-center gap-3">
          <Button
            onClick={handleValidate}
            disabled={!checkKey || !checkModelId.trim() || validating || !formData.baseUrl.trim()}
            variant="secondary"
          >
            {validating ? "Checking..." : "Check"}
          </Button>
          {renderValidationResult()}
        </div>
        <div className="flex gap-2">
          <Button
            onClick={handleSubmit}
            fullWidth
            disabled={!formData.name.trim() || !formData.prefix.trim() || !formData.baseUrl.trim() || submitting}
          >
            {submitting ? (isEdit ? "Saving..." : "Creating...") : isEdit ? "Save" : "Create"}
          </Button>
          <Button onClick={onClose} variant="ghost" fullWidth>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

AddCustomEmbeddingModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onCreated: PropTypes.func,
  onSaved: PropTypes.func,
  node: PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
    prefix: PropTypes.string,
    baseUrl: PropTypes.string,
  }),
};
