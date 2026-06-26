"use client";

import PropTypes from "prop-types";
import { useEffect, useState } from "react";
import { Badge, Button, Input, Modal, Select } from "@/shared/components";

// Type prefix that must be preserved on rename so isOpenAICompatibleProvider()
// / isAnthropicCompatibleProvider() keep classifying the node correctly.
function requiredIdPrefix(node, isAnthropic) {
  if (!node) return isAnthropic ? "anthropic-compatible-" : "openai-compatible-";
  if (node.type === "anthropic-compatible") return "anthropic-compatible-";
  if (node.type === "openai-compatible") return "openai-compatible-";
  if (node.type === "custom-embedding") return "custom-embedding-";
  return "";
}

export default function EditCompatibleNodeModal({ isOpen, node, onSave, onRename, onClose, isAnthropic }) {
  const [formData, setFormData] = useState({
    identifier: "",
    name: "",
    prefix: "",
    apiType: "chat",
    baseUrl: "https://api.openai.com/v1",
  });
  const [saving, setSaving] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState("");
  const [checkKey, setCheckKey] = useState("");
  const [checkModelId, setCheckModelId] = useState("");
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);

  useEffect(() => {
    if (node) {
      setFormData({
        identifier: node.id || "",
        name: node.name || "",
        prefix: node.prefix || "",
        apiType: node.apiType || "chat",
        baseUrl: node.baseUrl || (isAnthropic ? "https://api.anthropic.com/v1" : "https://api.openai.com/v1"),
      });
      setRenameError("");
    }
  }, [node, isAnthropic]);

  const apiTypeOptions = [
    { value: "chat", label: "Chat Completions" },
    { value: "responses", label: "Responses API" },
  ];

  const handleSubmit = async () => {
    if (!formData.name.trim() || !formData.prefix.trim() || !formData.baseUrl.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: formData.name,
        prefix: formData.prefix,
        baseUrl: formData.baseUrl,
      };
      if (!isAnthropic) {
        payload.apiType = formData.apiType;
      }
      await onSave(payload);
    } finally {
      setSaving(false);
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
          type: isAnthropic ? "anthropic-compatible" : "openai-compatible",
          modelId: checkModelId.trim() || undefined,
        }),
      });
      const data = await res.json();
      setValidationResult(data.valid ? "success" : "failed");
    } catch {
      setValidationResult("failed");
    } finally {
      setValidating(false);
    }
  };

  if (!node) return null;

  const idPrefix = requiredIdPrefix(node, isAnthropic);
  const trimmedId = formData.identifier.trim();
  const idChanged = trimmedId && trimmedId !== node.id;
  const idLooksValid =
    trimmedId && /^[a-zA-Z0-9_.-]+$/.test(trimmedId) && (!idPrefix || trimmedId.startsWith(idPrefix));

  const handleRename = async () => {
    if (!onRename || !idChanged || !idLooksValid) return;
    setRenameError("");
    setRenaming(true);
    try {
      await onRename(trimmedId);
    } catch (err) {
      setRenameError(err?.message || "Failed to rename");
    } finally {
      setRenaming(false);
    }
  };

  return (
    <Modal isOpen={isOpen} title={`Edit ${isAnthropic ? "Anthropic" : "OpenAI"} Compatible`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Input
          label="Name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder={`${isAnthropic ? "Anthropic" : "OpenAI"} Compatible (Prod)`}
          hint="Required. A friendly label for this node."
        />
        <div className="flex flex-col gap-1">
          <label className="text-[12px] font-medium text-text-muted">Identifier</label>
          <div className="flex gap-2">
            <Input
              value={formData.identifier}
              onChange={(e) => setFormData({ ...formData, identifier: e.target.value })}
              inputClassName="font-mono text-[12px]"
              className="flex-1"
            />
            <Button
              onClick={handleRename}
              disabled={!idChanged || !idLooksValid || renaming}
              variant="secondary"
              size="md"
            >
              {renaming ? "Renaming..." : "Rename"}
            </Button>
          </div>
          {renameError && <span className="text-[11px] text-error">{renameError}</span>}
          {!renameError && idChanged && idLooksValid && (
            <span className="text-[11px] text-text-muted">
              Press Rename to apply. The page will redirect to the new identifier.
            </span>
          )}
          {!renameError && !idChanged && idPrefix && (
            <span className="text-[11px] text-text-subtle">Must start with &quot;{idPrefix}&quot;</span>
          )}
        </div>
        <Input
          label="Prefix"
          value={formData.prefix}
          onChange={(e) => setFormData({ ...formData, prefix: e.target.value })}
          placeholder={isAnthropic ? "ac-prod" : "oc-prod"}
          hint="Required. Used as the provider prefix for model IDs."
        />
        {!isAnthropic && (
          <Select
            label="API Type"
            options={apiTypeOptions}
            value={formData.apiType}
            onChange={(e) => setFormData({ ...formData, apiType: e.target.value })}
          />
        )}
        <Input
          label="Base URL"
          value={formData.baseUrl}
          onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
          placeholder={isAnthropic ? "https://api.anthropic.com/v1" : "https://api.openai.com/v1"}
          hint={`Use the base URL (ending in /v1) for your ${isAnthropic ? "Anthropic" : "OpenAI"}-compatible API.`}
        />
        <div className="flex gap-2">
          <Input
            label="API Key (for Check)"
            type="password"
            value={checkKey}
            onChange={(e) => setCheckKey(e.target.value)}
            className="flex-1"
          />
          <div className="pt-6">
            <Button
              onClick={handleValidate}
              disabled={!checkKey || validating || !formData.baseUrl.trim()}
              variant="secondary"
            >
              {validating ? "Checking..." : "Check"}
            </Button>
          </div>
        </div>
        <Input
          label="Model ID (optional)"
          value={checkModelId}
          onChange={(e) => setCheckModelId(e.target.value)}
          placeholder="e.g. my-model-id"
          hint="If provider lacks /models endpoint, enter a model ID to validate via chat/completions instead."
        />
        {validationResult && (
          <Badge variant={validationResult === "success" ? "success" : "error"}>
            {validationResult === "success" ? "Valid" : "Invalid"}
          </Badge>
        )}
        <div className="flex gap-2">
          <Button
            onClick={handleSubmit}
            fullWidth
            disabled={!formData.name.trim() || !formData.prefix.trim() || !formData.baseUrl.trim() || saving}
          >
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button onClick={onClose} variant="ghost" fullWidth>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

EditCompatibleNodeModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  node: PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
    prefix: PropTypes.string,
    apiType: PropTypes.string,
    baseUrl: PropTypes.string,
    type: PropTypes.string,
  }),
  onSave: PropTypes.func.isRequired,
  onRename: PropTypes.func,
  onClose: PropTypes.func.isRequired,
  isAnthropic: PropTypes.bool,
};
