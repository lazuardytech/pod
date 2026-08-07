"use client";

import { notFound, useParams, useRouter } from "next/navigation";
import Image from "next/image";
import { GOOGLE_TTS_LANGUAGES } from "open-sse/config/googleTtsLanguages.js";
import { getTtsVoicesForModel } from "open-sse/config/ttsModels.js";
import { useEffect, useState } from "react";
import ConnectionsCard from "@/app/(dashboard)/providers/components/ConnectionsCard";
import ModelsCard from "@/app/(dashboard)/providers/components/ModelsCard";
import {
  AddCustomEmbeddingModal,
  Badge,
  Button,
  Card,
  NoAuthProxyCard,
  ProviderInfoCard,
} from "@/shared/components";
import LucideIcon from "@/shared/components/LucideIcon";
import { ConfirmModal } from "@/shared/components/Modal";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { getModelsByProviderId } from "@/shared/constants/models";
import {
  AI_PROVIDERS,
  getProviderAlias,
  isCustomEmbeddingProvider,
  MEDIA_PROVIDER_KINDS,
} from "@/shared/constants/providers";
import { TTS_PROVIDER_CONFIG } from "@/shared/constants/ttsProviders";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

// Shared row layout — defined outside components to avoid re-mount on re-render
function Row({ label, children }: any): any {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
      <span className="w-full text-xs font-medium text-text-muted sm:w-20 sm:shrink-0">
        {label}
      </span>
      <div className="w-full min-w-0 flex-1">{children}</div>
    </div>
  );
}

const DEFAULT_TTS_RESPONSE_EXAMPLE = `// Audio will appear here after running.
// Example JSON response (response_format=json):
{
  "format": "mp3",
  "audio": "//NExAANaAIIAUAAANNNNNNNN..." // base64 encoded MP3
}`;

const DEFAULT_RESPONSE_EXAMPLE = `{
  "object": "list",
  "data": [{
    "object": "embedding",
    "index": 0,
    "embedding": [0.002301, -0.019212, 0.004815, -0.031249, ...]
  }],
  "model": "...",
  "usage": { "prompt_tokens": 9, "total_tokens": 9 }
}`;

const CLOUDFLARE_TEST_IMAGE_URL = "https://pub-1fb693cb11cc46b2b2f656f51e015a2c.r2.dev/dog.png";
const CLOUDFLARE_TEST_MASK_URL = "https://pub-1fb693cb11cc46b2b2f656f51e015a2c.r2.dev/dog-mask.png";

function getImageEditDefaults(providerId: any, modelId: any): any {
  if (providerId !== "cloudflare-ai") return {};
  if (modelId === "@cf/runwayml/stable-diffusion-v1-5-img2img") {
    return { image: CLOUDFLARE_TEST_IMAGE_URL };
  }
  if (modelId === "@cf/runwayml/stable-diffusion-v1-5-inpainting") {
    return { image: CLOUDFLARE_TEST_IMAGE_URL, mask_image: CLOUDFLARE_TEST_MASK_URL };
  }
  return {};
}

function toImagePreviewSrc(value: any): any {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return "";
  // Only allow https URLs or data:image/ URIs to prevent XSS via javascript: or other schemes
  if (/^https:\/\//i.test(trimmed)) return trimmed;
  if (/^data:image\//i.test(trimmed)) return trimmed;
  // Treat anything else as raw base64
  return `data:image/png;base64,${trimmed}`;
}

// Config-driven example defaults per kind
const KIND_EXAMPLE_CONFIG = {
  webSearch: {
    inputLabel: "Query",
    inputPlaceholder: "What is the latest news about AI?",
    defaultInput: "What is the latest news about AI?",
    bodyKey: "query",
    defaultResponse: `{\n  "results": [\n    { "title": "...", "url": "...", "snippet": "..." }\n  ]\n}`,
    extraFields: [
      {
        key: "search_type",
        label: "Type",
        type: "select",
        default: "web",
        options: ["web", "news"],
      },
      { key: "max_results", label: "Max results", type: "number", default: 5, min: 1, max: 100 },
      { key: "country", label: "Country", type: "text", default: "" },
      { key: "language", label: "Language", type: "text", default: "" },
    ],
  },
  webFetch: {
    inputLabel: "URL",
    inputPlaceholder: "https://example.com",
    defaultInput: "https://example.com",
    bodyKey: "url",
    defaultResponse: `{\n  "content": "...",\n  "title": "...",\n  "url": "..."\n}`,
    extraFields: [
      {
        key: "format",
        label: "Format",
        type: "select",
        default: "markdown",
        options: ["markdown", "text", "html"],
      },
      { key: "max_characters", label: "Max chars", type: "number", default: 0, min: 0 },
    ],
  },
  image: {
    inputLabel: "Prompt",
    inputPlaceholder: "A cute cat wearing a hat",
    defaultInput: "A cute cat wearing a hat",
    bodyKey: "prompt",
    defaultResponse: `{\n  "data": [\n    { "url": "...", "b64_json": "..." }\n  ]\n}`,
    extraFields: [
      { key: "n", label: "n", type: "number", default: 1, min: 1, max: 4 },
      {
        key: "size",
        label: "Size",
        type: "select",
        default: "auto",
        options: ["auto", "1024x1024", "1024x1536", "1536x1024", "1024x1792", "1792x1024"],
      },
      {
        key: "quality",
        label: "Quality",
        type: "select",
        default: "auto",
        options: ["auto", "low", "medium", "high", "standard", "hd"],
      },
      {
        key: "background",
        label: "Background",
        type: "select",
        default: "auto",
        options: ["auto", "transparent", "opaque"],
      },
      {
        key: "style",
        label: "Style",
        type: "select",
        default: "",
        options: ["", "vivid", "natural"],
      },
      {
        key: "response_format",
        label: "Format",
        type: "select",
        default: "",
        options: ["", "url", "b64_json"],
      },
      {
        key: "image_detail",
        label: "Image Detail",
        type: "select",
        default: "high",
        options: ["auto", "low", "high", "original"],
      },
      {
        key: "output_format",
        label: "Codec",
        type: "select",
        default: "png",
        options: ["png", "jpeg", "webp"],
      },
    ],
  },
  imageToText: {
    inputLabel: "Image URL",
    inputPlaceholder: "https://example.com/image.png",
    defaultInput:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Cat03.jpg/1200px-Cat03.jpg",
    bodyKey: "url",
    extraBody: { prompt: "Describe this image in detail" },
    defaultResponse: `{\n  "text": "A cat sitting on a windowsill...",\n  "model": "..."\n}`,
  },
  video: {
    inputLabel: "Prompt",
    inputPlaceholder: "A serene lake at sunset",
    defaultInput: "A serene lake at sunset",
    bodyKey: "prompt",
    defaultResponse: `{\n  "data": [\n    { "url": "..." }\n  ]\n}`,
  },
  music: {
    inputLabel: "Prompt",
    inputPlaceholder: "A calm piano melody",
    defaultInput: "A calm piano melody",
    bodyKey: "prompt",
    defaultResponse: `{\n  "data": [\n    { "url": "...", "format": "mp3" }\n  ]\n}`,
  },
};

// EmbeddingExampleCard
function EmbeddingExampleCard({ providerId, customAlias }: any): any {
  const isCustom = isCustomEmbeddingProvider(providerId);
  const providerAlias = isCustom ? customAlias || providerId : getProviderAlias(providerId);
  const embeddingModels = isCustom
    ? []
    : getModelsByProviderId(providerId).filter((m: any): any => m.type === "embedding");

  const [selectedModel, setSelectedModel] = useState(embeddingModels[0]?.id ?? "");
  const [input, setInput] = useState("The quick brown fox jumps over the lazy dog");
  const [dimensions, setDimensions] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [useTunnel, setUseTunnel] = useState(false);
  const [localEndpoint, setLocalEndpoint] = useState("");
  const [tunnelEndpoint, setTunnelEndpoint] = useState("");
  const [result, setResult] = useState<any>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const { copied: copiedCurl, copy: copyCurl } = useCopyToClipboard();
  const { copied: copiedRes, copy: copyRes } = useCopyToClipboard();

  useEffect((): any => {
    setLocalEndpoint(window.location.origin);
    fetch("/api/keys")
      .then((r: any): any => r.json())
      .then((d: any): any => {
        setApiKey((d.keys || []).find((k: any): any => k.isActive !== false)?.key || "");
      })
      .catch((): any => {});
    fetch("/api/tunnel/status")
      .then((r: any): any => r.json())
      .then((d: any): any => {
        if (d.tunnel?.tunnelUrl) setTunnelEndpoint(d.tunnel.tunnelUrl);
      })
      .catch((): any => {});
  }, []);

  const endpoint = useTunnel ? tunnelEndpoint : localEndpoint;
  const modelFull = selectedModel ? `${providerAlias}/${selectedModel}` : "";

  // Build request body — include dimensions only if user provided a positive number
  const buildBody = (): any => {
    const body: { model: string; input: string; dimensions?: number } = {
      model: modelFull,
      input: input.trim(),
    };
    const dim = Number(dimensions);
    if (dimensions && Number.isFinite(dim) && dim > 0) body.dimensions = dim;
    return body;
  };

  const curlSnippet = `curl -X POST ${endpoint}/v1/embeddings \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${apiKey || "YOUR_KEY"}" \\
  -d '${JSON.stringify(buildBody())}'`;

  const handleRun = async (): Promise<any> => {
    if (!input.trim() || !modelFull) return;
    setRunning(true);
    setError("");
    setResult(null);
    const start = Date.now();
    try {
      const headers: Record<string, any> = { "Content-Type": "application/json" };
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
      const res = await fetch("/api/v1/embeddings", {
        method: "POST",
        headers,
        body: JSON.stringify(buildBody()),
      });
      const latencyMs = Date.now() - start;
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message || data?.error || `HTTP ${res.status}`);
        return;
      }
      setResult({ data, latencyMs });
    } catch (e) {
      setError((e as any).message || "Network error");
    } finally {
      setRunning(false);
    }
  };

  // Compact embedding array: first 4 values + count
  const formatResultJson = (data: any): any => {
    if (!data) return DEFAULT_RESPONSE_EXAMPLE;
    const clone = JSON.parse(JSON.stringify(data));
    (clone.data || []).forEach((item: any): any => {
      if (Array.isArray(item.embedding) && item.embedding.length > 4) {
        item.embedding = [
          ...item.embedding.slice(0, 4).map((v: any): any => parseFloat(v.toFixed(6))),
          `... (${item.embedding.length} dims)`,
        ];
      }
    });
    return JSON.stringify(clone, null, 2);
  };

  const resultJson = result ? JSON.stringify(result.data, null, 2) : "";

  return (
    <Card>
      <h2 className="text-lg font-semibold mb-4">Example</h2>

      <div className="flex flex-col gap-2.5">
        {/* Model — text input for custom node, dropdown otherwise */}
        <Row label="Model">
          {isCustom ? (
            <input
              aria-label="Model"
              value={selectedModel}
              onChange={(e: any): any => setSelectedModel(e.target.value)}
              placeholder="e.g. voyage-3, embed-english-v3.0, text-embedding-3-small"
              className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary font-mono"
              name="model"
            />
          ) : (
            <select
              aria-label="Model"
              value={selectedModel}
              onChange={(e: any): any => setSelectedModel(e.target.value)}
              className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
              name="model"
            >
              {embeddingModels.map((m: any): any => (
                <option key={m.id} value={m.id}>
                  {m.name || m.id}
                </option>
              ))}
            </select>
          )}
        </Row>

        {/* Endpoint */}
        <Row label="Endpoint">
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <input
              aria-label="Endpoint"
              value={endpoint}
              onChange={(e: any): any =>
                useTunnel ? setTunnelEndpoint(e.target.value) : setLocalEndpoint(e.target.value)
              }
              className="w-full min-w-0 flex-1 px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary font-mono"
              placeholder="http://localhost:3000"
              name="endpoint"
            />
            {/* Tunnel toggle — only show if tunnel URL is available */}
            {tunnelEndpoint && (
              <button
                onClick={(): any => setUseTunnel((v: any): any => !v)}
                title={useTunnel ? "Using tunnel" : "Using local"}
                className={`flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg border shrink-0 transition-colors ${
                  useTunnel
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border text-text-muted hover:text-primary"
                }`}
              >
                <LucideIcon name="wifi_tethering" className="text-[14px]" />
                Tunnel
              </button>
            )}
          </div>
        </Row>

        {/* API Key */}
        <Row label="API Key">
          <input
            aria-label="API Key"
            type="password"
            value={apiKey}
            onChange={(e: any): any => setApiKey(e.target.value)}
            placeholder="sk-..."
            className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary font-mono"
            name="api-key"
          />
        </Row>

        {/* Input */}
        <Row label="Input">
          <div className="relative">
            <input
              aria-label="Input"
              value={input}
              onChange={(e: any): any => setInput(e.target.value)}
              className="w-full px-3 py-1.5 pr-7 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
              name="input-text"
            />
            {input && (
              <button
                type="button"
                onClick={(): any => setInput("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-primary transition-colors"
              >
                <LucideIcon name="close" className="text-[14px]" />
              </button>
            )}
          </div>
        </Row>

        {/* Dimensions (optional) — truncate embedding vector length */}
        <Row label="Dimensions">
          <input
            aria-label="Dimensions"
            type="number"
            min="1"
            value={dimensions}
            onChange={(e: any): any => setDimensions(e.target.value)}
            placeholder="optional, e.g. 512, 1024 (leave empty for default)"
            className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
            name="dimensions"
          />
        </Row>

        {/* Curl + Run */}
        <div className="mt-1">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-1.5">
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
              Request
            </span>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
              <button
                onClick={(): any => copyCurl(curlSnippet)}
                className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-primary transition-colors"
              >
                <LucideIcon
                  name={copiedCurl ? "check" : "content_copy"}
                  size={12}
                  className="shrink-0"
                />
                {copiedCurl ? "Copied" : "Copy"}
              </button>
              <button
                onClick={handleRun}
                disabled={running || !input.trim() || !modelFull}
                className="flex w-full sm:w-auto items-center justify-center gap-1.5 px-3 py-1 rounded-lg bg-primary text-primary-fg text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <LucideIcon
                  name={running ? "progress_activity" : "play_arrow"}
                  size={12}
                  className={running ? "shrink-0 animate-spin" : "shrink-0"}
                />
                {running ? "Running..." : "Run"}
              </button>
            </div>
          </div>
          <pre className="bg-sidebar rounded-lg px-3 py-2.5 text-xs font-mono text-text-main overflow-x-auto whitespace-pre-wrap break-all">
            {curlSnippet}
          </pre>
        </div>

        {/* Error */}
        {error && <p className="text-xs text-red-500 break-words">{error}</p>}

        {/* Response — default example or real result */}
        <div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-1.5">
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
              Response{" "}
              {result && (
                <span className="font-normal normal-case">&#9889; {result.latencyMs}ms</span>
              )}
            </span>
            {result && (
              <button
                onClick={(): any => copyRes(resultJson)}
                className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-primary transition-colors"
              >
                <LucideIcon
                  name={copiedRes ? "check" : "content_copy"}
                  size={12}
                  className="shrink-0"
                />
                {copiedRes ? "Copied" : "Copy"}
              </button>
            )}
          </div>
          <pre className="bg-sidebar rounded-lg px-3 py-2.5 text-xs font-mono text-text-main overflow-x-auto whitespace-pre-wrap break-all opacity-70">
            {formatResultJson(result?.data)}
          </pre>
        </div>
      </div>
    </Card>
  );
}

// ─── TTS Example Card ────────────────────────────────────────────────────────
function TtsExampleCard({ providerId }: any): any {
  const providerAlias = getProviderAlias(providerId);
  const config = TTS_PROVIDER_CONFIG[providerId] || TTS_PROVIDER_CONFIG["edge-tts"]!;

  // Voice state
  const [selectedVoice, setSelectedVoice] = useState("");
  const [_selectedVoiceName, setSelectedVoiceName] = useState("");
  const [voiceId, setVoiceId] = useState(""); // editable voice id (elevenlabs)
  // Voices shown below Voice row after language selected
  const [countryVoices, setCountryVoices] = useState<any[]>([]);
  const [selectedLang, setSelectedLang] = useState("");
  const [selectedModel, setSelectedModel] = useState((): any => {
    const cfgModels = AI_PROVIDERS[providerId]?.ttsConfig?.models;
    if (cfgModels?.length) return cfgModels[0]!.id;
    if (config.hasModelSelector && config.modelKey) {
      const models = getModelsByProviderId(config.modelKey);
      return models?.[0]?.id || "";
    }
    return "";
  });

  // Form state
  const [input, setInput] = useState("Hello, this is a text to speech test.");
  const [apiKey, setApiKey] = useState("");
  const [useTunnel, setUseTunnel] = useState(false);
  const [localEndpoint, setLocalEndpoint] = useState("");
  const [tunnelEndpoint, setTunnelEndpoint] = useState("");
  const [responseFormat, setResponseFormat] = useState("mp3"); // mp3 | json
  const [audioUrl, setAudioUrl] = useState("");
  const [jsonResponse, setJsonResponse] = useState<any>(null); // Store JSON response
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [latency, setLatency] = useState<any>(null);
  const { copied: copiedCurl, copy: copyCurl } = useCopyToClipboard();

  // Country picker modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [languages, setLanguages] = useState<any[]>([]);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalSearch, setModalSearch] = useState("");
  const [modalError, setModalError] = useState("");
  const [byLang, setByLang] = useState<Record<string, any>>({});
  // Language hint (e.g. Gemini): controls the spoken language without affecting voice selection
  const [languageHint, setLanguageHint] = useState("");

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect((): any => {
    setLocalEndpoint(window.location.origin);
    fetch("/api/keys")
      .then((r: any): any => r.json())
      .then((d: any): any => {
        setApiKey((d.keys || []).find((k: any): any => k.isActive !== false)?.key || "");
      })
      .catch((): any => {});
    fetch("/api/tunnel/status")
      .then((r: any): any => r.json())
      .then((d: any): any => {
        if (d.tunnel?.tunnelUrl) setTunnelEndpoint(d.tunnel.tunnelUrl);
      })
      .catch((): any => {});

    // Pre-select default voice based on provider config
    if (config.voiceSource === "hardcoded") {
      const defaultModel =
        config.hasModelSelector && config.modelKey
          ? getModelsByProviderId(config.modelKey)?.[0]?.id || ""
          : "";
      // Use per-model voices if available, else flat list
      const voices =
        config.voicesPerModel && defaultModel
          ? getTtsVoicesForModel(providerId, defaultModel) || []
          : getModelsByProviderId(config.voiceKey || providerId).filter(
              (m: any): any => m.type === "tts",
            );
      if (voices.length) {
        if (config.hasBrowseButton) {
          // Google TTS: pre-select "en" (English) as default, show as single voice chip
          const defaultVoice = voices.find((v: any): any => v.id === "en") ?? voices[0];
          if (defaultVoice) {
            setSelectedLang(defaultVoice.id);
            setSelectedVoice(defaultVoice.id);
            setSelectedVoiceName(defaultVoice.name);
            setCountryVoices([{ id: defaultVoice.id, name: defaultVoice.name }]);
          }
        } else {
          // OpenAI/OpenRouter: set voice chips directly (no language picker)
          const firstVoice = voices[0];
          setCountryVoices(voices);
          if (firstVoice) {
            setSelectedVoice(firstVoice.id);
            setSelectedVoiceName(firstVoice.name || firstVoice.id);
          }
        }
      }
    }
    // api-language (edge-tts, local-device, elevenlabs): NO default load, wait for user to pick language
    // config (nvidia, hyperbolic, deepgram, huggingface, cartesia, playht, coqui, tortoise, inworld, qwen):
    // use ttsConfig.models for model selector; voice is empty by default (backend uses provider default)
  }, [providerId]);
  /* eslint-enable react-hooks/exhaustive-deps */

  // Update voices when model changes (voicesPerModel providers)
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect((): any => {
    if (!config.voicesPerModel || !selectedModel) return;
    const voices = getTtsVoicesForModel(providerId, selectedModel) || [];
    setCountryVoices(voices);
    const firstVoice = voices[0];
    if (firstVoice) {
      setSelectedVoice(firstVoice.id);
      setSelectedVoiceName(firstVoice.name || firstVoice.id);
    }
  }, [selectedModel]);
  /* eslint-enable react-hooks/exhaustive-deps */

  // Open modal — load language list
  const openModal = async (): Promise<any> => {
    setModalOpen(true);
    setModalSearch("");
    setModalError("");
    if (languages.length) return; // already loaded
    setModalLoading(true);
    try {
      if (config.voiceSource === "hardcoded") {
        // Build languages/byLang from static providerModels data
        const voiceKey = config.voiceKey || providerId;
        const voices = getModelsByProviderId(voiceKey).filter((m: any): any => m.type === "tts");
        const byLangMap: Record<
          string,
          { code: string; name: string; voices: Array<{ id: string; name: string }> }
        > = {};
        for (const v of voices) {
          if (!byLangMap[v.id])
            byLangMap[v.id] = { code: v.id, name: v.name, voices: [{ id: v.id, name: v.name }] };
        }
        setByLang(byLangMap);
        setLanguages(
          Object.values(byLangMap).sort((a: any, b: any): any => a.name.localeCompare(b.name)),
        );
      } else {
        // Use provider-specific apiEndpoint if available, else default to edge-tts voices API
        const url = config.apiEndpoint
          ? config.apiEndpoint
          : `/api/media-providers/tts/voices?provider=${providerId === "local-device" ? "local-device" : "edge-tts"}`;
        const r = await fetch(url);
        const d = await r.json();
        if (d.error) {
          setModalError(d.error);
          return;
        }
        setLanguages(d.languages || []);
        setByLang(d.byLang || {});
      }
    } catch (e) {
      setModalError((e as any).message);
    } finally {
      setModalLoading(false);
    }
  };

  // Click language → close modal → show voices below
  const handlePickLanguage = (lang: any): any => {
    setModalOpen(false);
    setSelectedLang(lang.code);
    const voices = byLang[lang.code]?.voices || [];
    setCountryVoices(voices);
    // Auto-select first voice
    if (voices.length) {
      setSelectedVoice(voices[0].id);
      setSelectedVoiceName(voices[0].name);
      if (config.hasVoiceIdInput) setVoiceId(voices[0].id);
    }
  };

  const filteredLanguages = modalSearch
    ? languages.filter(
        (c: any): any =>
          c.name.toLowerCase().includes(modalSearch.toLowerCase()) ||
          c.code.toLowerCase().includes(modalSearch.toLowerCase()),
      )
    : languages;

  const endpoint = useTunnel ? tunnelEndpoint : localEndpoint;
  // For ElevenLabs/config-driven: prefer manual voiceId (if any), else fall back to selectedVoice
  const activeVoiceId = config.hasVoiceIdInput ? voiceId || selectedVoice : selectedVoice;
  const modelFull = ((): any => {
    if (config.hasModelSelector && selectedModel && activeVoiceId)
      return `${providerAlias}/${selectedModel}/${activeVoiceId}`;
    if (config.hasModelSelector && selectedModel) return `${providerAlias}/${selectedModel}`;
    if (activeVoiceId) return `${providerAlias}/${activeVoiceId}`;
    return "";
  })();

  const ttsBody = ((): any => {
    const b: { model: string; input: string; language?: string } = { model: modelFull, input };
    if (config.hasLanguageHint && languageHint) b.language = languageHint;
    return b;
  })();
  const curlSnippet = `curl -X POST ${endpoint}/v1/audio/speech${responseFormat === "json" ? "?response_format=json" : ""} \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${apiKey || "YOUR_KEY"}" \\
  -d '${JSON.stringify(ttsBody)}' \\
  ${responseFormat === "json" ? "" : "--output speech.mp3"}`;

  const handleRun = async (): Promise<any> => {
    if (!input.trim() || !modelFull) return;
    setRunning(true);
    setError("");
    setAudioUrl("");
    setJsonResponse(null);
    const start = Date.now();
    try {
      const headers: Record<string, any> = { "Content-Type": "application/json" };
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
      const url = `/api/v1/audio/speech${responseFormat === "json" ? "?response_format=json" : ""}`;
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ ...ttsBody, input: input.trim() }),
      });
      setLatency(Date.now() - start);
      if (!res.ok) {
        const d = await res.json().catch((): any => ({}));
        setError(d?.error?.message || d?.error || `HTTP ${res.status}`);
        return;
      }

      if (responseFormat === "json") {
        const data = await res.json();
        setJsonResponse(data); // Store full JSON response
        const audioBlob = await fetch(`data:audio/mp3;base64,${data.audio}`).then((r: any): any =>
          r.blob(),
        );
        setAudioUrl(URL.createObjectURL(audioBlob));
      } else {
        const blob = await res.blob();
        setAudioUrl(URL.createObjectURL(blob));
      }
    } catch (e) {
      setError((e as any).message || "Network error");
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <Card>
        <h2 className="text-lg font-semibold mb-4">Example</h2>

        <div className="flex flex-col gap-2.5">
          {/* Endpoint + API Key as read-only text */}
          <Row label="Endpoint">
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
              <span className="w-full min-w-0 flex-1 px-3 py-1.5 text-sm font-mono text-text-main bg-sidebar rounded-lg truncate">
                {endpoint}/v1/audio/speech
              </span>
              {tunnelEndpoint && (
                <button
                  onClick={(): any => setUseTunnel((v: any): any => !v)}
                  title={useTunnel ? "Using tunnel" : "Using local"}
                  className={`flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg border shrink-0 transition-colors ${
                    useTunnel
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border text-text-muted hover:text-primary"
                  }`}
                >
                  <LucideIcon name="wifi_tethering" className="text-[14px]" />
                  Tunnel
                </button>
              )}
            </div>
          </Row>
          <Row label="API Key">
            <span className="px-3 py-1.5 text-sm font-mono text-text-main bg-sidebar rounded-lg truncate block">
              {apiKey ? (
                `${apiKey.slice(0, 8)}${"•".repeat(Math.min(20, apiKey.length - 8))}`
              ) : (
                <span className="text-text-muted italic">No key configured</span>
              )}
            </span>
          </Row>

          {/* Model selector — prefer ttsConfig.models, else providerModels via modelKey */}
          {config.hasModelSelector &&
            (config.modelKey || AI_PROVIDERS[providerId]?.ttsConfig?.models?.length) && (
              <Row label="Model">
                <select
                  aria-label="Model"
                  value={selectedModel}
                  onChange={(e: any): any => setSelectedModel(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
                  name="model"
                >
                  {(
                    (AI_PROVIDERS[providerId]?.ttsConfig?.models?.length
                      ? AI_PROVIDERS[providerId].ttsConfig.models
                      : getModelsByProviderId(config.modelKey)) || []
                  ).map((m: any): any => (
                    <option key={m.id} value={m.id}>
                      {m.name || m.id}
                    </option>
                  ))}
                </select>
              </Row>
            )}

          {/* Language hint dropdown (Gemini) — sends body.language to guide pronunciation */}
          {config.hasLanguageHint && (
            <Row label="Language">
              <select
                aria-label="Language"
                value={languageHint}
                onChange={(e: any): any => setLanguageHint(e.target.value)}
                className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
                name="language"
              >
                <option value="">Auto-detect</option>
                {GOOGLE_TTS_LANGUAGES.map((l: any): any => (
                  <option key={l.id} value={l.name}>
                    {l.name}
                  </option>
                ))}
              </select>
            </Row>
          )}

          {/* Language row + Browse button (edge-tts, local-device, elevenlabs) */}
          {config.hasBrowseButton && (
            <Row label="Language">
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                <button
                  onClick={openModal}
                  className="w-full min-w-0 flex-1 px-3 py-1.5 text-sm border border-border rounded-lg bg-background font-mono truncate text-left hover:border-primary/40 transition-colors"
                >
                  {selectedLang ? (
                    <span className="text-text-main">
                      {languages.find((l: any): any => l.code === selectedLang)?.name ||
                        selectedLang}
                    </span>
                  ) : (
                    <span className="text-text-muted">No language selected</span>
                  )}
                </button>
                <button
                  onClick={openModal}
                  className="flex w-full items-center justify-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-border text-text-muted hover:text-primary hover:border-primary/40 transition-colors sm:w-auto sm:shrink-0"
                >
                  <LucideIcon name="language" className="text-[14px]" />
                  Select language
                </button>
              </div>
            </Row>
          )}

          {/* Voice chips — shown after language picked (edge-tts, local-device) or always (OpenAI/ElevenLabs) */}
          {countryVoices.length > 0 && (
            <Row label="Voice">
              <div className="flex flex-wrap gap-1.5">
                {countryVoices.map((v: any): any => (
                  <button
                    key={v.id}
                    onClick={(): any => {
                      setSelectedVoice(v.id);
                      setSelectedVoiceName(v.name);
                      if (config.hasVoiceIdInput) setVoiceId(v.id);
                    }}
                    className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                      selectedVoice === v.id
                        ? "bg-primary/15 border-primary/40 text-primary font-medium"
                        : "border-border text-text-muted hover:text-primary hover:border-primary/40"
                    }`}
                  >
                    {v.name}
                    {v.gender ? ` · ${v.gender[0].toUpperCase()}` : ""}
                    {v.free_users_allowed === true && (
                      <span className="ml-1.5 px-1 py-0.5 text-[9px] font-semibold rounded bg-green-500/15 text-green-600 border border-green-500/20">
                        Free
                      </span>
                    )}
                    {v.free_users_allowed === false && (
                      <span className="ml-1.5 px-1 py-0.5 text-[9px] font-semibold rounded bg-amber-500/15 text-amber-600 border border-amber-500/20">
                        Paid
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </Row>
          )}

          {/* Voice ID input (ElevenLabs) — manual entry or auto-fill from chip */}
          {config.hasVoiceIdInput && (
            <Row label="Voice ID">
              <div className="flex flex-col gap-1">
                <div className="relative">
                  <input
                    aria-label="Voice ID"
                    value={voiceId}
                    onChange={(e: any): any => {
                      setVoiceId(e.target.value);
                      setSelectedVoice(e.target.value);
                    }}
                    placeholder="e.g. CwhRBWXzGAHq8TQ4Fs17"
                    className="w-full px-3 py-1.5 pr-7 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary font-mono"
                    name="voice-id"
                  />
                  {voiceId && (
                    <button
                      type="button"
                      onClick={(): any => {
                        setVoiceId("");
                        setSelectedVoice("");
                      }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-primary transition-colors"
                    >
                      <LucideIcon name="close" className="text-[14px]" />
                    </button>
                  )}
                </div>
              </div>
            </Row>
          )}

          {/* Google TTS: Language dropdown */}
          {config.hasLanguageDropdown && (
            <Row label="Language">
              <select
                aria-label="Language"
                value={selectedVoice}
                name="language"
                onChange={(e: any): any => {
                  const m = getModelsByProviderId(providerId)
                    .filter((m: any): any => m.type === "tts")
                    .find((m: any): any => m.id === e.target.value);
                  setSelectedVoice(e.target.value);
                  setSelectedVoiceName(m?.name || e.target.value);
                }}
                className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
              >
                {getModelsByProviderId(providerId)
                  .filter((m: any): any => m.type === "tts")
                  .map((m: any): any => (
                    <option key={m.id} value={m.id}>
                      {m.name || m.id}
                    </option>
                  ))}
              </select>
            </Row>
          )}

          {/* Input */}
          <Row label="Input">
            <div className="relative">
              <input
                aria-label="Input"
                value={input}
                onChange={(e: any): any => setInput(e.target.value)}
                className="w-full px-3 py-1.5 pr-7 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
                name="input-text"
              />
              {input && (
                <button
                  type="button"
                  onClick={(): any => setInput("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-primary transition-colors"
                >
                  <LucideIcon name="close" className="text-[14px]" />
                </button>
              )}
            </div>
          </Row>

          {/* Output Format */}
          <Row label="Output Format">
            <select
              aria-label="Output format"
              value={responseFormat}
              onChange={(e: any): any => setResponseFormat(e.target.value)}
              className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
              name="output-format"
            >
              <option value="mp3">MP3 (Binary)</option>
              <option value="json">JSON (Base64)</option>
            </select>
          </Row>

          {/* Curl + Run */}
          <div className="mt-1">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-1.5">
              <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                Request
              </span>
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                <button
                  onClick={(): any => copyCurl(curlSnippet)}
                  className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-primary transition-colors"
                >
                  <LucideIcon
                    name={copiedCurl ? "check" : "content_copy"}
                    size={12}
                    className="shrink-0"
                  />
                  {copiedCurl ? "Copied" : "Copy"}
                </button>
                <button
                  onClick={handleRun}
                  disabled={running || !input.trim() || !modelFull}
                  className="flex w-full sm:w-auto items-center justify-center gap-1.5 px-3 py-1 rounded-lg bg-primary text-primary-fg text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <LucideIcon
                    name={running ? "progress_activity" : "play_arrow"}
                    size={12}
                    className={running ? "shrink-0 animate-spin" : "shrink-0"}
                  />
                  {running ? "Generating..." : "Run"}
                </button>
              </div>
            </div>
            <pre className="bg-sidebar rounded-lg px-3 py-2.5 text-xs font-mono text-text-main overflow-x-auto whitespace-pre-wrap break-all">
              {curlSnippet}
            </pre>
          </div>

          {error && <p className="text-xs text-red-500 break-words">{error}</p>}

          {/* Audio player */}
          {audioUrl ? (
            <div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-1.5">
                <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                  Response{" "}
                  {latency && <span className="font-normal normal-case">&#9889; {latency}ms</span>}
                </span>
                <a
                  href={audioUrl}
                  download="speech.mp3"
                  className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-primary transition-colors"
                >
                  <LucideIcon name="download" size={12} className="shrink-0" />
                  Download
                </a>
              </div>
              <audio controls src={audioUrl} className="w-full" />

              {/* JSON Response (if format is json) */}
              {jsonResponse && (
                <div className="mt-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-1.5">
                    <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                      JSON Response
                    </span>
                  </div>
                  <pre className="bg-sidebar rounded-lg px-3 py-2.5 text-xs font-mono text-text-main overflow-x-auto whitespace-pre-wrap break-all">
                    {JSON.stringify(
                      {
                        format: jsonResponse.format,
                        audio: jsonResponse.audio
                          ? `${jsonResponse.audio.substring(0, 100)}...`
                          : "",
                      },
                      null,
                      2,
                    )}
                  </pre>
                </div>
              )}
            </div>
          ) : (
            <div>
              <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                Response
              </span>
              <pre className="mt-1.5 bg-sidebar rounded-lg px-3 py-2.5 text-xs font-mono text-text-main overflow-x-auto whitespace-pre-wrap break-all opacity-50">
                {DEFAULT_TTS_RESPONSE_EXAMPLE}
              </pre>
            </div>
          )}
        </div>
      </Card>

      {/* Country Picker Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
          style={{ backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(2px)" }}
          onClick={(): any => setModalOpen(false)}
        >
          <div
            className="border border-border rounded-xl shadow-2xl w-full max-w-md mx-4 flex flex-col max-h-[80vh]"
            style={{ backgroundColor: "var(--color-bg)", isolation: "isolate" }}
            onClick={(e: any): any => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0 rounded-t-xl">
              <h3 className="text-sm font-semibold">Select Language</h3>
              <button
                onClick={(): any => setModalOpen(false)}
                className="text-text-muted hover:text-primary transition-colors"
              >
                <LucideIcon name="close" className="text-[20px]" />
              </button>
            </div>

            {/* Search */}
            <div className="px-4 py-2.5 border-b border-border shrink-0">
              <input
                aria-label="Search language"
                autoFocus
                value={modalSearch}
                onChange={(e: any): any => setModalSearch(e.target.value)}
                placeholder="Search language..."
                className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
                name="search"
              />
            </div>

            {/* Language list */}
            <div className="overflow-y-auto flex-1 p-2">
              {modalError && <p className="text-xs text-red-500 px-2 py-1">{modalError}</p>}
              {modalLoading ? (
                <p className="text-xs text-text-muted px-2 py-3">Loading...</p>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {filteredLanguages.map((c: any): any => (
                    <button
                      key={c.code}
                      onClick={(): any => handlePickLanguage(c)}
                      className={`flex items-center justify-between w-full px-3 py-2 rounded-lg text-left hover:bg-sidebar transition-colors ${
                        selectedLang === c.code ? "bg-primary/10 text-primary" : ""
                      }`}
                    >
                      <span className="text-sm">{c.name}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-text-muted">{c.voices.length} voices</span>
                        {selectedLang === c.code && (
                          <LucideIcon name="check" className="text-[16px] text-primary" />
                        )}
                      </div>
                    </button>
                  ))}
                  {filteredLanguages.length === 0 && (
                    <p className="text-xs text-text-muted px-2 py-3">No languages found.</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Generic Example Card — config-driven for webSearch, webFetch, image, imageToText, stt, video, music
function GenericExampleCard({ providerId, kind }: any): any {
  const provider = AI_PROVIDERS[providerId];
  const defaultBaseUrl = provider?.searchConfig?.baseUrl || provider?.fetchConfig?.baseUrl || "";
  const supportsBaseUrlOverride =
    Boolean(defaultBaseUrl) && (kind === "webSearch" || kind === "webFetch");
  const providerAlias = getProviderAlias(providerId);
  const kindConfig = MEDIA_PROVIDER_KINDS.find((k: any): any => k.id === kind);
  const exConfig = (KIND_EXAMPLE_CONFIG as Record<string, any>)[kind];
  const safeExConfig = exConfig || {};

  // Get models for this kind (e.g., type="image")
  const kindModels = getModelsByProviderId(providerId).filter((m: any): any => m.type === kind);
  // Kinds that need a model identifier in the request (image/video/music)
  const KIND_NEEDS_MODEL = new Set(["image", "video", "music", "imageToText"]);
  const needsModel = KIND_NEEDS_MODEL.has(kind);
  const allowManualModel = needsModel && kindModels.length === 0;
  const [selectedModel, setSelectedModel] = useState(kindModels[0]?.id ?? "");
  const selectedModelObj = kindModels.find((m: any): any => m.id === selectedModel);
  const supportsEdit = !!selectedModelObj?.capabilities?.includes("edit");
  const supportsMask = !!selectedModelObj?.capabilities?.includes("mask");

  const [input, setInput] = useState(safeExConfig.defaultInput || "");
  const [refImage, setRefImage] = useState("");
  const [maskImage, setMaskImage] = useState("");
  const [extraValues, setExtraValues] = useState((): any =>
    (safeExConfig.extraFields || []).reduce((acc: any, f: any): any => {
      acc[f.key] = f.default ?? "";
      return acc;
    }, {}),
  );
  const [apiKey, setApiKey] = useState("");
  const [baseUrlOverride, setBaseUrlOverride] = useState("");
  const [useTunnel, setUseTunnel] = useState(false);
  const [localEndpoint, setLocalEndpoint] = useState("");
  const [tunnelEndpoint, setTunnelEndpoint] = useState("");
  const [result, setResult] = useState<any>(null);
  const [progress, setProgress] = useState<any>(null); // { stage, bytesReceived }
  const [partialImage, setPartialImage] = useState<any>(null);
  const [imageOutputFormat, setImageOutputFormat] = useState("json"); // json | binary
  const [binaryImageUrl, setBinaryImageUrl] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [connections, setConnections] = useState<any[]>([]);
  const [pinnedConnectionId, setPinnedConnectionId] = useState("");
  const { copied: copiedCurl, copy: copyCurl } = useCopyToClipboard();
  const { copied: copiedRes, copy: copyRes } = useCopyToClipboard();

  useEffect((): any => {
    setLocalEndpoint(window.location.origin);
    fetch("/api/keys")
      .then((r: any): any => r.json())
      .then((d: any): any => {
        setApiKey((d.keys || []).find((k: any): any => k.isActive !== false)?.key || "");
      })
      .catch((): any => {});
    fetch("/api/tunnel/status")
      .then((r: any): any => r.json())
      .then((d: any): any => {
        if (d.tunnel?.tunnelUrl) setTunnelEndpoint(d.tunnel.tunnelUrl);
      })
      .catch((): any => {});
    // Load active connections of this provider for pinning
    fetch("/api/providers/client")
      .then((r: any): any => r.json())
      .then((d: any): any => {
        const conns = (d.connections || []).filter(
          (c: any): any => c.provider === providerId && c.isActive !== false,
        );
        setConnections(conns);
      })
      .catch((): any => {});
  }, [providerId]);

  useEffect((): any => {
    if (supportsBaseUrlOverride) {
      setBaseUrlOverride(defaultBaseUrl);
    } else {
      setBaseUrlOverride("");
    }
  }, [defaultBaseUrl, supportsBaseUrlOverride]);

  // Safe to early-return now that all hooks are declared
  if (!kindConfig || !exConfig) return null;

  const endpoint = useTunnel ? tunnelEndpoint : localEndpoint;
  const apiPath = kindConfig.endpoint.path;
  // webSearch/webFetch: use providerAlias only. Other kinds: append model when present.
  const modelFull = !needsModel
    ? providerAlias
    : selectedModel
      ? `${providerAlias}/${selectedModel}`
      : allowManualModel
        ? ""
        : providerAlias;
  const imageEditDefaults = getImageEditDefaults(providerId, selectedModel);
  const effectiveRefImage = refImage.trim() || imageEditDefaults.image || "";
  const effectiveMaskImage = maskImage.trim() || imageEditDefaults.mask_image || "";
  const refImagePreviewSrc = toImagePreviewSrc(effectiveRefImage);
  const maskImagePreviewSrc = toImagePreviewSrc(effectiveMaskImage);

  // Build request body with optional extra fields (only non-empty values)
  const extraBodyFromFields = Object.entries(extraValues).reduce((acc: any, [k, v]: any): any => {
    if (v === "" || v === null || v === undefined) return acc;
    if (typeof v === "number" && Number.isNaN(v)) return acc;
    acc[k] = v;
    return acc;
  }, {});
  const requestBody = {
    model: modelFull,
    [exConfig.bodyKey]: input,
    ...exConfig.extraBody,
    ...extraBodyFromFields,
    ...(supportsEdit && effectiveRefImage ? { image: effectiveRefImage } : {}),
    ...(supportsMask && effectiveMaskImage ? { mask_image: effectiveMaskImage } : {}),
    ...(supportsBaseUrlOverride && baseUrlOverride.trim()
      ? { provider_options: { baseUrl: baseUrlOverride.trim() } }
      : {}),
  };

  // Streaming supported for codex image (Plus/Pro accounts) — disabled when binary output requested
  const wantBinary = kind === "image" && imageOutputFormat === "binary";
  const useStreaming = kind === "image" && providerId === "codex" && !wantBinary;
  const apiPathWithQuery = `${apiPath}${wantBinary ? "?response_format=binary" : ""}`;
  // Sanitize pinnedConnectionId to prevent header injection in the curl snippet display
  const safeConnectionId = pinnedConnectionId ? pinnedConnectionId.replace(/[^\w-]/g, "") : "";
  const headersPreview = `-H "Content-Type: application/json" \\\n  -H "Authorization: Bearer ${apiKey || "YOUR_KEY"}"${safeConnectionId ? ` \\\n  -H "x-connection-id: ${safeConnectionId}"` : ""}${useStreaming ? ` \\\n  -H "Accept: text/event-stream"` : ""}`;
  const curlSnippet = `curl -X ${kindConfig.endpoint.method} ${endpoint}${apiPathWithQuery} \\
  ${headersPreview.replace(/\\\n {2}/g, "\\\n  ")} \\
  -d '${JSON.stringify(requestBody)}'${wantBinary ? " \\\n  --output image.png" : ""}`;

  const handleRun = async (): Promise<any> => {
    if (!input.trim() || !modelFull) return;
    setRunning(true);
    setError("");
    setResult(null);
    setProgress(null);
    setPartialImage(null);
    if (binaryImageUrl) {
      try {
        URL.revokeObjectURL(binaryImageUrl);
      } catch {}
      setBinaryImageUrl("");
    }
    const start = Date.now();
    try {
      const headers: Record<string, any> = { "Content-Type": "application/json" };
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
      if (pinnedConnectionId) headers["x-connection-id"] = pinnedConnectionId;
      if (useStreaming) headers["Accept"] = "text/event-stream";
      const body = { ...requestBody, model: modelFull };
      const res = await fetch(`/api${apiPathWithQuery}`, {
        method: kindConfig.endpoint.method,
        headers,
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch((): any => ({}));
        setError(data?.error?.message || data?.error || `HTTP ${res.status}`);
        return;
      }
      const ctype = res.headers.get("content-type") || "";
      // Binary image response — convert to blob URL
      if (ctype.startsWith("image/")) {
        const blob = await res.blob();
        const objUrl = URL.createObjectURL(blob);
        setBinaryImageUrl(objUrl);
        setResult({
          data: { binary: true, mime: ctype, size: blob.size },
          latencyMs: Date.now() - start,
        });
        return;
      }
      const isSse = ctype.includes("text/event-stream");
      if (isSse && res.body) {
        // Parse SSE: progress / partial_image / done / error
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let finalData = null;
        let streamErr = null;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let sep;
          // biome-ignore lint/suspicious/noAssignInExpressions: standard SSE buffer parsing pattern
          while ((sep = buf.indexOf("\n\n")) !== -1) {
            const block = buf.slice(0, sep);
            buf = buf.slice(sep + 2);
            let evt: string | null = null,
              dataStr = "";
            for (const line of block.split("\n")) {
              if (line.startsWith("event:")) evt = line.slice(6).trim();
              else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
            }
            if (!evt) continue;
            try {
              const payload = dataStr ? JSON.parse(dataStr) : {};
              if (evt === "progress") setProgress(payload);
              else if (evt === "partial_image") setPartialImage(payload);
              else if (evt === "done") finalData = payload;
              else if (evt === "error") streamErr = payload?.message || "Stream error";
            } catch {}
          }
        }
        const latencyMs = Date.now() - start;
        if (streamErr) {
          setError(streamErr);
          return;
        }
        if (finalData) setResult({ data: finalData, latencyMs });
      } else {
        const data = await res.json();
        const latencyMs = Date.now() - start;
        setResult({ data, latencyMs });
      }
    } catch (e) {
      setError((e as any).message || "Network error");
    } finally {
      setRunning(false);
    }
  };

  // Mask large b64_json strings in JSON view to keep it readable
  const maskB64 = (obj: any): any => {
    if (!obj || typeof obj !== "object") return obj;
    if (Array.isArray(obj)) return obj.map(maskB64);
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] =
        k === "b64_json" && typeof v === "string" && v.length > 100
          ? `<${v.length} chars base64>`
          : maskB64(v);
    }
    return out;
  };
  const resultJson = result ? JSON.stringify(maskB64(result.data), null, 2) : "";

  return (
    <Card>
      <h2 className="text-lg font-semibold mb-4">Example</h2>
      <div className="flex flex-col gap-2.5">
        {/* Model selector — dropdown if presets exist, else manual input for media kinds */}
        {kindModels.length > 0 ? (
          <Row label="Model">
            <select
              aria-label="Model"
              value={selectedModel}
              onChange={(e: any): any => setSelectedModel(e.target.value)}
              className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
              name="model"
            >
              {kindModels.map((m: any): any => (
                <option key={m.id} value={m.id}>
                  {m.name || m.id}
                </option>
              ))}
            </select>
          </Row>
        ) : allowManualModel ? (
          <Row label="Model">
            <input
              aria-label="Model"
              value={selectedModel}
              onChange={(e: any): any => setSelectedModel(e.target.value)}
              placeholder="Enter model id (provider-specific)"
              className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary font-mono"
              name="model"
            />
          </Row>
        ) : null}

        {/* Endpoint */}
        <Row label="Endpoint">
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <span className="w-full min-w-0 flex-1 px-3 py-1.5 text-sm font-mono text-text-main bg-sidebar rounded-lg truncate">
              {endpoint}
              {apiPath}
            </span>
            {tunnelEndpoint && (
              <button
                onClick={(): any => setUseTunnel((v: any): any => !v)}
                title={useTunnel ? "Using tunnel" : "Using local"}
                className={`flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg border shrink-0 transition-colors ${
                  useTunnel
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border text-text-muted hover:text-primary"
                }`}
              >
                <LucideIcon name="wifi_tethering" className="text-[14px]" />
                Tunnel
              </button>
            )}
          </div>
        </Row>

        {/* API Key */}
        <Row label="API Key">
          <span className="px-3 py-1.5 text-sm font-mono text-text-main bg-sidebar rounded-lg truncate block">
            {apiKey ? (
              `${apiKey.slice(0, 8)}${"\u2022".repeat(Math.min(20, apiKey.length - 8))}`
            ) : (
              <span className="text-text-muted italic">No key configured</span>
            )}
          </span>
        </Row>

        {/* Connection picker - only show when 2+ connections (or any with email) */}
        {connections.length > 0 && (
          <Row label="Connection">
            <select
              aria-label="Connection"
              value={pinnedConnectionId}
              onChange={(e: any): any => setPinnedConnectionId(e.target.value)}
              className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
              name="connection"
            >
              <option value="">Auto (by priority)</option>
              {connections.map((c: any): any => {
                const plan = c.providerSpecificData?.chatgptPlanType;
                const label = c.email || c.name || c.id.slice(0, 8);
                return (
                  <option key={c.id} value={c.id}>
                    {label}
                    {plan ? ` [${plan}]` : ""}
                  </option>
                );
              })}
            </select>
          </Row>
        )}

        {/* Input */}
        <Row label={exConfig.inputLabel}>
          <div className="relative">
            <input
              aria-label="Input"
              value={input}
              onChange={(e: any): any => setInput(e.target.value)}
              placeholder={exConfig.inputPlaceholder}
              className="w-full px-3 py-1.5 pr-7 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
              name="input-text"
            />
            {input && (
              <button
                type="button"
                onClick={(): any => setInput("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-primary transition-colors"
              >
                <LucideIcon name="close" className="text-[14px]" />
              </button>
            )}
          </div>
        </Row>

        {/* Reference image (only for edit-capable image models) */}
        {supportsEdit && (
          <Row label="Ref Image (URL)">
            <div className="flex flex-col gap-2">
              <div className="relative">
                <input
                  aria-label="Reference image URL"
                  value={refImage}
                  onChange={(e: any): any => setRefImage(e.target.value)}
                  placeholder={imageEditDefaults.image || "https://example.com/source.png"}
                  className="w-full px-3 py-1.5 pr-7 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
                  name="ref-image"
                />
                {refImage && (
                  <button
                    type="button"
                    onClick={(): any => setRefImage("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-primary transition-colors"
                  >
                    <LucideIcon name="close" className="text-[14px]" />
                  </button>
                )}
              </div>
              {refImagePreviewSrc && (
                <Image
                  // Only https:// or data:image/ allowed by toImagePreviewSrc()
                  src={refImagePreviewSrc}
                  alt="Reference"
                  width={320}
                  height={320}
                  className="max-h-40 rounded-lg border border-border object-contain bg-sidebar"
                  onError={(e: any): any => {
                    e.currentTarget.style.display = "none";
                  }}
                  onLoad={(e: any): any => {
                    e.currentTarget.style.display = "block";
                  }}
                  unoptimized
                />
              )}
            </div>
          </Row>
        )}

        {supportsMask && (
          <Row label="Mask (URL)">
            <div className="flex flex-col gap-2">
              <div className="relative">
                <input
                  aria-label="Mask image URL"
                  value={maskImage}
                  onChange={(e: any): any => setMaskImage(e.target.value)}
                  placeholder={imageEditDefaults.mask_image || "https://example.com/mask.png"}
                  className="w-full px-3 py-1.5 pr-7 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
                  name="mask-image"
                />
                {maskImage && (
                  <button
                    type="button"
                    onClick={(): any => setMaskImage("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-primary transition-colors"
                  >
                    <LucideIcon name="close" className="text-[14px]" />
                  </button>
                )}
              </div>
              {maskImagePreviewSrc && (
                <Image
                  // Only https:// or data:image/ allowed by toImagePreviewSrc()
                  src={maskImagePreviewSrc}
                  alt="Mask"
                  width={320}
                  height={320}
                  className="max-h-40 rounded-lg border border-border object-contain bg-sidebar"
                  onError={(e: any): any => {
                    e.currentTarget.style.display = "none";
                  }}
                  onLoad={(e: any): any => {
                    e.currentTarget.style.display = "block";
                  }}
                  unoptimized
                />
              )}
            </div>
          </Row>
        )}

        {/* Extra fields — for kinds without model concept (webSearch/webFetch), show all; otherwise filter by model.params */}
        {(exConfig.extraFields || [])
          .filter(
            (f: any): any =>
              kindModels.length === 0 ||
              (Array.isArray(selectedModelObj?.params) && selectedModelObj.params.includes(f.key)),
          )
          .map((f: any): any => (
            <Row key={f.key} label={f.label}>
              {f.type === "select" ? (
                <select
                  aria-label="Parameter value"
                  value={extraValues[f.key] ?? ""}
                  onChange={(e: any): any =>
                    setExtraValues((s: any): any => ({ ...s, [f.key]: e.target.value }))
                  }
                  className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
                  name={`param-${f.key}`}
                >
                  {(f.options || []).map((opt: any): any => (
                    <option key={opt} value={opt}>
                      {opt === "" ? "(default)" : opt}
                    </option>
                  ))}
                </select>
              ) : f.type === "text" ? (
                <input
                  aria-label="Parameter value"
                  type="text"
                  value={extraValues[f.key] ?? ""}
                  placeholder={f.placeholder}
                  onChange={(e: any): any =>
                    setExtraValues((s: any): any => ({ ...s, [f.key]: e.target.value }))
                  }
                  className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
                  name={`param-${f.key}`}
                />
              ) : (
                <input
                  aria-label="Parameter value"
                  type="number"
                  value={extraValues[f.key] ?? ""}
                  min={f.min}
                  max={f.max}
                  onChange={(e: any): any =>
                    setExtraValues((s: any): any => ({
                      ...s,
                      [f.key]: e.target.value === "" ? "" : Number(e.target.value),
                    }))
                  }
                  className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
                  name={`param-${f.key}`}
                />
              )}
            </Row>
          ))}

        {supportsBaseUrlOverride && (
          <Row label="Base URL">
            <input
              aria-label="Provider base URL"
              type="text"
              value={baseUrlOverride}
              placeholder={defaultBaseUrl}
              onChange={(e: any): any => setBaseUrlOverride(e.target.value)}
              className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
              name="provider-base-url"
            />
          </Row>
        )}

        {/* Output Format toggle (image only) — last */}
        {kind === "image" && (
          <Row label="Output Format">
            <select
              aria-label="Output format"
              value={imageOutputFormat}
              onChange={(e: any): any => setImageOutputFormat(e.target.value)}
              className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
              name="output-format"
            >
              <option value="json">JSON (Base64)</option>
              <option value="binary">Binary File</option>
            </select>
          </Row>
        )}

        {/* Curl + Run */}
        <div className="mt-1">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-1.5">
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
              Request
            </span>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
              <button
                onClick={(): any => copyCurl(curlSnippet)}
                className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-primary transition-colors"
              >
                <LucideIcon
                  name={copiedCurl ? "check" : "content_copy"}
                  size={12}
                  className="shrink-0"
                />
                {copiedCurl ? "Copied" : "Copy"}
              </button>
              <button
                onClick={handleRun}
                disabled={running || !input.trim() || !modelFull}
                className="flex w-full sm:w-auto items-center justify-center gap-1.5 px-3 py-1 rounded-lg bg-primary text-primary-fg text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <LucideIcon
                  name={running ? "progress_activity" : "play_arrow"}
                  size={12}
                  className={running ? "shrink-0 animate-spin" : "shrink-0"}
                />
                {running ? "Running..." : "Run"}
              </button>
            </div>
          </div>
          <pre className="bg-sidebar rounded-lg px-3 py-2.5 text-xs font-mono text-text-main overflow-x-auto whitespace-pre-wrap break-all">
            {curlSnippet}
          </pre>
        </div>

        {/* Streaming progress */}
        {(running || progress) && useStreaming && (
          <div className="flex flex-col gap-2 px-3 py-2 rounded-lg bg-sidebar border border-border sm:flex-row sm:items-center sm:gap-3">
            <LucideIcon
              name={running ? "progress_activity" : "check_circle"}
              className="text-[16px] text-primary"
              style={running ? { animation: "spin 1s linear infinite" } : undefined}
            />
            <span className="text-xs text-text-muted">
              {progress?.stage || "starting"}
              {!running && progress?.bytesReceived
                ? ` · ${(progress.bytesReceived / 1024).toFixed(1)} KB`
                : ""}
            </span>
          </div>
        )}

        {/* Partial image preview (codex stream) */}
        {partialImage?.b64_json && !result && (
          <div>
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
              Partial preview
            </span>
            <Image
              src={`data:image/png;base64,${partialImage.b64_json}`}
              alt="Partial"
              width={512}
              height={512}
              className="max-w-full rounded-lg border border-border mt-1.5 opacity-80"
              unoptimized
            />
          </div>
        )}

        {/* Error */}
        {error && <p className="text-xs text-red-500 break-words">{error}</p>}

        {/* Response */}
        <div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-1.5">
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
              Response{" "}
              {result && (
                <span className="font-normal normal-case">&#9889; {result.latencyMs}ms</span>
              )}
            </span>
            {result && (
              <button
                onClick={(): any => copyRes(resultJson)}
                className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-primary transition-colors"
              >
                <LucideIcon
                  name={copiedRes ? "check" : "content_copy"}
                  size={12}
                  className="shrink-0"
                />
                {copiedRes ? "Copied" : "Copy"}
              </button>
            )}
          </div>
          <pre className="bg-sidebar rounded-lg px-3 py-2.5 text-xs font-mono text-text-main overflow-x-auto whitespace-pre-wrap break-all opacity-70">
            {result ? resultJson : exConfig.defaultResponse}
          </pre>
          {kind === "image" && (binaryImageUrl || result?.data?.data?.[0]) && (
            <div className="mt-2">
              <div className="flex items-center justify-end mb-1.5">
                <a
                  href={
                    binaryImageUrl ||
                    (result?.data?.data?.[0]?.b64_json
                      ? `data:image/png;base64,${result.data.data[0].b64_json}`
                      : result?.data?.data?.[0]?.url || "")
                  }
                  download="image.png"
                  className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-primary transition-colors"
                >
                  <LucideIcon name="download" size={12} className="shrink-0" />
                  Download
                </a>
              </div>
              <Image
                src={
                  binaryImageUrl ||
                  (result?.data?.data?.[0]?.b64_json
                    ? `data:image/png;base64,${result.data.data[0].b64_json}`
                    : result?.data?.data?.[0]?.url)
                }
                alt="Generated"
                width={512}
                height={512}
                className="max-w-full rounded-lg border border-border"
                unoptimized
              />
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

// ─── STT Example Card ────────────────────────────────────────────────────────
function SttExampleCard({ providerId }: any): any {
  const providerAlias = getProviderAlias(providerId);
  const builtinSttModels = getModelsByProviderId(providerId).filter(
    (m: any): any => m.type === "stt",
  );
  const [customSttModels, setCustomSttModels] = useState<any[]>([]);
  const sttModels = [...builtinSttModels, ...customSttModels];

  const [selectedModel, setSelectedModel] = useState(builtinSttModels[0]?.id ?? "");
  const selectedModelObj = sttModels.find((m: any): any => m.id === selectedModel);
  const allowedParams = Array.isArray(selectedModelObj?.params) ? selectedModelObj.params : [];

  const [audioFile, setAudioFile] = useState<any>(null);
  const [language, setLanguage] = useState("");
  const [prompt, setPrompt] = useState("");
  const [responseFormat, setResponseFormat] = useState("json");
  const [temperature, setTemperature] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [useTunnel, setUseTunnel] = useState(false);
  const [localEndpoint, setLocalEndpoint] = useState("");
  const [tunnelEndpoint, setTunnelEndpoint] = useState("");
  const [result, setResult] = useState<any>(null);
  const [latency, setLatency] = useState<any>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const { copied: copiedCurl, copy: copyCurl } = useCopyToClipboard();
  const { copied: copiedRes, copy: copyRes } = useCopyToClipboard();

  useEffect((): any => {
    setLocalEndpoint(window.location.origin);
    fetch("/api/keys")
      .then((r: any): any => r.json())
      .then((d: any): any => {
        setApiKey((d.keys || []).find((k: any): any => k.isActive !== false)?.key || "");
      })
      .catch((): any => {});
    fetch("/api/tunnel/status")
      .then((r: any): any => r.json())
      .then((d: any): any => {
        if (d.tunnel?.tunnelUrl) setTunnelEndpoint(d.tunnel.tunnelUrl);
      })
      .catch((): any => {});
    const loadCustom = (): any => {
      fetch("/api/models/custom", { cache: "no-store" })
        .then((r: any): any => r.json())
        .then((d: any): any => {
          const list = (d.models || []).filter(
            (m: any): any => m.type === "stt" && m.providerAlias === providerAlias,
          );
          setCustomSttModels(list);
        })
        .catch((): any => {});
    };
    loadCustom();
    window.addEventListener("focus", loadCustom);
    window.addEventListener("customModelChanged", loadCustom);
    return (): any => {
      window.removeEventListener("focus", loadCustom);
      window.removeEventListener("customModelChanged", loadCustom);
    };
  }, [providerAlias]);

  const endpoint = useTunnel ? tunnelEndpoint : localEndpoint;
  const modelFull = selectedModel ? `${providerAlias}/${selectedModel}` : "";

  const curlSnippet = `curl -X POST ${endpoint}/v1/audio/transcriptions \\
  -H "Authorization: Bearer ${apiKey || "YOUR_KEY"}" \\
  -F "file=@${audioFile?.name || "audio.mp3"}" \\
  -F "model=${modelFull}"${allowedParams.includes("language") && language ? ` \\\n  -F "language=${language}"` : ""}${allowedParams.includes("response_format") ? ` \\\n  -F "response_format=${responseFormat}"` : ""}${allowedParams.includes("temperature") && temperature ? ` \\\n  -F "temperature=${temperature}"` : ""}${allowedParams.includes("prompt") && prompt ? ` \\\n  -F "prompt=${prompt}"` : ""}`;

  const handleRun = async (): Promise<any> => {
    if (!audioFile || !modelFull) return;
    setRunning(true);
    setError("");
    setResult(null);
    const start = Date.now();
    try {
      const fd = new FormData();
      fd.append("file", audioFile);
      fd.append("model", modelFull);
      if (allowedParams.includes("language") && language) fd.append("language", language);
      if (allowedParams.includes("response_format")) fd.append("response_format", responseFormat);
      if (allowedParams.includes("temperature") && temperature)
        fd.append("temperature", temperature);
      if (allowedParams.includes("prompt") && prompt) fd.append("prompt", prompt);

      const headers: Record<string, any> = {};
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
      const res = await fetch("/api/v1/audio/transcriptions", {
        method: "POST",
        headers,
        body: fd,
      });
      setLatency(Date.now() - start);
      const ct = res.headers.get("content-type") || "";
      const data = ct.includes("application/json") ? await res.json() : await res.text();
      if (!res.ok) {
        setError(data?.error?.message || data?.error || data || `HTTP ${res.status}`);
        return;
      }
      setResult(data);
    } catch (e) {
      setError((e as any).message || "Network error");
    } finally {
      setRunning(false);
    }
  };

  const resultStr =
    typeof result === "string"
      ? result
      : result
        ? JSON.stringify(result, null, 2)
        : `{\n  "text": "Hello world..."\n}`;

  return (
    <Card>
      <h2 className="text-lg font-semibold mb-4">Example</h2>
      <div className="flex flex-col gap-2.5">
        {/* Model */}
        {sttModels.length > 0 ? (
          <Row label="Model">
            <select
              aria-label="Model"
              value={selectedModel}
              onChange={(e: any): any => setSelectedModel(e.target.value)}
              className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
              name="model"
            >
              {sttModels.map((m: any): any => (
                <option key={m.id} value={m.id}>
                  {m.name || m.id}
                </option>
              ))}
            </select>
          </Row>
        ) : (
          <Row label="Model">
            <input
              aria-label="Model"
              value={selectedModel}
              onChange={(e: any): any => setSelectedModel(e.target.value)}
              placeholder="Enter model id"
              className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary font-mono"
              name="model"
            />
          </Row>
        )}

        {/* Endpoint */}
        <Row label="Endpoint">
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <span className="w-full min-w-0 flex-1 px-3 py-1.5 text-sm font-mono text-text-main bg-sidebar rounded-lg truncate">
              {endpoint}/v1/audio/transcriptions
            </span>
            {tunnelEndpoint && (
              <button
                onClick={(): any => setUseTunnel((v: any): any => !v)}
                title={useTunnel ? "Using tunnel" : "Using local"}
                className={`flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg border shrink-0 transition-colors ${
                  useTunnel
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border text-text-muted hover:text-primary"
                }`}
              >
                <LucideIcon name="wifi_tethering" className="text-[14px]" />
                Tunnel
              </button>
            )}
          </div>
        </Row>

        {/* API Key */}
        <Row label="API Key">
          <span className="px-3 py-1.5 text-sm font-mono text-text-main bg-sidebar rounded-lg truncate block">
            {apiKey ? (
              `${apiKey.slice(0, 8)}${"\u2022".repeat(Math.min(20, apiKey.length - 8))}`
            ) : (
              <span className="text-text-muted italic">No key configured</span>
            )}
          </span>
        </Row>

        {/* Audio file */}
        <Row label="Audio File">
          <div className="flex flex-col gap-2">
            <input
              aria-label="Audio file"
              type="file"
              accept="audio/*,video/mp4,.m4a,.mp3,.wav,.ogg,.flac,.webm,.opus"
              onChange={(e: any): any => setAudioFile(e.target.files?.[0] || null)}
              className="w-full text-xs text-text-muted file:mr-2 file:py-1 file:px-2.5 file:rounded-lg file:border file:border-border file:bg-background file:text-text-main hover:file:bg-sidebar file:cursor-pointer"
            />
            {audioFile && (
              <span className="text-xs text-text-muted font-mono">
                {audioFile.name} · {(audioFile.size / 1024).toFixed(1)} KB
              </span>
            )}
          </div>
        </Row>

        {/* Language (if model supports) */}
        {allowedParams.includes("language") && (
          <Row label="Language">
            <input
              aria-label="Language"
              value={language}
              onChange={(e: any): any => setLanguage(e.target.value)}
              placeholder="e.g. en, vi, ja (auto-detect if empty)"
              className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary font-mono"
              name="language"
            />
          </Row>
        )}

        {/* Prompt (if model supports) */}
        {allowedParams.includes("prompt") && (
          <Row label="Prompt">
            <input
              aria-label="Prompt"
              value={prompt}
              onChange={(e: any): any => setPrompt(e.target.value)}
              placeholder="optional context to improve accuracy"
              className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
              name="prompt"
            />
          </Row>
        )}

        {/* Temperature (if model supports) */}
        {allowedParams.includes("temperature") && (
          <Row label="Temperature">
            <input
              aria-label="Temperature"
              type="number"
              step="0.1"
              min="0"
              max="1"
              value={temperature}
              onChange={(e: any): any => setTemperature(e.target.value)}
              placeholder="0 - 1 (default 0)"
              className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
              name="temperature"
            />
          </Row>
        )}

        {/* Response format (if model supports) */}
        {allowedParams.includes("response_format") && (
          <Row label="Response Format">
            <select
              aria-label="Response format"
              value={responseFormat}
              onChange={(e: any): any => setResponseFormat(e.target.value)}
              className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
              name="response-format"
            >
              <option value="json">json</option>
              <option value="text">text</option>
              <option value="srt">srt</option>
              <option value="verbose_json">verbose_json</option>
              <option value="vtt">vtt</option>
            </select>
          </Row>
        )}

        {/* Curl + Run */}
        <div className="mt-1">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-1.5">
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
              Request
            </span>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
              <button
                onClick={(): any => copyCurl(curlSnippet)}
                className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-primary transition-colors"
              >
                <LucideIcon
                  name={copiedCurl ? "check" : "content_copy"}
                  size={12}
                  className="shrink-0"
                />
                {copiedCurl ? "Copied" : "Copy"}
              </button>
              <button
                onClick={handleRun}
                disabled={running || !audioFile || !modelFull}
                className="flex w-full sm:w-auto items-center justify-center gap-1.5 px-3 py-1 rounded-lg bg-primary text-primary-fg text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <LucideIcon
                  name={running ? "progress_activity" : "play_arrow"}
                  size={12}
                  className={running ? "shrink-0 animate-spin" : "shrink-0"}
                />
                {running ? "Transcribing..." : "Run"}
              </button>
            </div>
          </div>
          <pre className="bg-sidebar rounded-lg px-3 py-2.5 text-xs font-mono text-text-main overflow-x-auto whitespace-pre-wrap break-all">
            {curlSnippet}
          </pre>
        </div>

        {error && <p className="text-xs text-red-500 break-words">{error}</p>}

        {/* Response */}
        <div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-1.5">
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
              Response{" "}
              {result && latency && (
                <span className="font-normal normal-case">&#9889; {latency}ms</span>
              )}
            </span>
            {result && (
              <button
                onClick={(): any => copyRes(resultStr)}
                className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-primary transition-colors"
              >
                <LucideIcon
                  name={copiedRes ? "check" : "content_copy"}
                  size={12}
                  className="shrink-0"
                />
                {copiedRes ? "Copied" : "Copy"}
              </button>
            )}
          </div>
          <pre className="bg-sidebar rounded-lg px-3 py-2.5 text-xs font-mono text-text-main overflow-x-auto whitespace-pre-wrap break-all opacity-70">
            {resultStr}
          </pre>
        </div>
      </div>
    </Card>
  );
}

// MediaProviderDetailPage
export default function MediaProviderDetailPage(): any {
  const { kind: kindParam, id: idParam } = useParams();
  const kind = (Array.isArray(kindParam) ? kindParam[0] : kindParam) as string;
  const id = Array.isArray(idParam) ? idParam[0] : idParam;
  const router = useRouter();
  const kindConfig = MEDIA_PROVIDER_KINDS.find((k: any): any => k.id === kind);
  const isCustom = isCustomEmbeddingProvider(id) && kind === "embedding";

  const handleDeleteCustom = async (): Promise<any> => {
    try {
      const res = await fetch(`/api/provider-nodes/${id}`, { method: "DELETE" });
      if (res.ok) router.push(`/media-providers/${kind}`);
    } catch (error) {
      console.error("Error deleting custom embedding node:", error);
    }
  };

  const [customNode, setCustomNode] = useState<any>(null);
  const [customLoading, setCustomLoading] = useState(isCustom);
  const [showEditModal, setShowEditModal] = useState(false);

  const [confirmDialog, setConfirmDialog] = useState({
    open: false,
    title: "",
    message: "",
    onConfirm: null as (() => void) | null,
    variant: "default",
  });
  const openConfirm = (title: any, message: any, onConfirm: any, variant: any = "default"): any =>
    setConfirmDialog({ open: true, title, message, onConfirm, variant });
  const closeConfirm = (): any =>
    setConfirmDialog((prev: any): any => ({
      ...prev,
      open: false,
      onConfirm: null as (() => void) | null,
    }));

  // Fetch custom node info from API for custom embedding nodes
  useEffect((): any => {
    if (!isCustom) {
      return undefined;
    }
    let cancelled = false;
    fetch("/api/provider-nodes", { cache: "no-store" })
      .then((r: any): any => r.json())
      .then((d: any): any => {
        if (cancelled) return;
        setCustomNode((d.nodes || []).find((n: any): any => n.id === id) || null);
        setCustomLoading(false);
      })
      .catch((): any => {
        if (!cancelled) setCustomLoading(false);
      });
    return (): any => {
      cancelled = true;
    };
  }, [id, isCustom]);

  if (!kindConfig) return notFound();

  const builtInProvider = AI_PROVIDERS[id as string];

  // For custom embedding nodes, build a synthetic provider object
  const provider = isCustom
    ? customNode
      ? { id, name: customNode.name || "Custom Embedding", color: "#6366F1", textIcon: "CE" }
      : null
    : builtInProvider;

  if (!isCustom && !builtInProvider) return notFound();
  if (isCustom && !customLoading && !customNode) return notFound();
  if (isCustom && customLoading) {
    return <div className="text-text-muted text-sm py-12 text-center">Loading...</div>;
  }

  if (provider === null || provider === undefined) return null;

  const kinds = isCustom ? ["embedding"] : (builtInProvider?.serviceKinds ?? ["llm"]);
  if (!isCustom && !kinds.includes(kind)) return notFound();

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        <div
          className="size-12 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${provider.color}15` }}
        >
          <ProviderIcon
            src={`/providers/${provider.id}.png`}
            alt={provider.name}
            size={48}
            className="object-contain rounded-lg max-w-[48px] max-h-[48px]"
            fallbackText={provider.textIcon || provider.id!.slice(0, 2).toUpperCase()}
            fallbackColor={provider.color}
          />
        </div>
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">{provider.name}</h1>
            {!isCustom && builtInProvider?.notice?.apiKeyUrl && (
              <a
                href={builtInProvider.notice.apiKeyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary hover:underline inline-flex items-center gap-1"
              >
                <LucideIcon name="open_in_new" className="text-sm" />
                Get API Key
              </a>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {isCustom && (
              <Badge variant="default" size="sm">
                Custom · {customNode?.prefix}
              </Badge>
            )}
            {kinds.map((k: any): any => (
              <Badge key={k} variant={k === kind ? "primary" : "default"} size="sm">
                {k.toUpperCase()}
              </Badge>
            ))}
          </div>
        </div>
        {isCustom && (
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <Button
              size="sm"
              variant="secondary"
              icon="edit"
              onClick={(): any => setShowEditModal(true)}
            >
              Edit
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon="delete"
              onClick={(): any =>
                openConfirm(
                  "Delete Custom Embedding",
                  "Delete this Custom Embedding node? This cannot be undone.",
                  handleDeleteCustom,
                  "danger",
                )
              }
            >
              Delete
            </Button>
          </div>
        )}
      </div>

      {/* Kind-specific notice (e.g. codex/image requires Plus) */}
      {!isCustom && (builtInProvider?.kindNotice as Record<string, any>)?.[kind] && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-400">
          <LucideIcon name="warning" className="text-[20px] mt-0.5" />
          <p className="text-sm">{(builtInProvider!.kindNotice as Record<string, any>)[kind]}</p>
        </div>
      )}

      {/* Provider notice text (only when there's actual text content) */}
      {!isCustom && builtInProvider?.notice?.text && !builtInProvider?.deprecated && (
        <div className="flex flex-col gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 sm:flex-row sm:items-center">
          <LucideIcon name="info" className="text-[16px] text-blue-500 shrink-0" />
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-blue-600 dark:text-blue-400">
            {builtInProvider.notice.text}
          </p>
          {builtInProvider.notice.apiKeyUrl && (
            <a
              href={builtInProvider.notice.apiKeyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex justify-center rounded bg-blue-500 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-600 sm:py-0.5"
            >
              Get API Key →
            </a>
          )}
        </div>
      )}

      {/* Connections */}
      {!isCustom && builtInProvider?.noAuth ? (
        <NoAuthProxyCard providerId={id} />
      ) : (
        <ConnectionsCard providerId={id} isOAuth={false} />
      )}

      {/* Models - hidden for tts/webSearch/webFetch (provider IS the model); custom uses prefix as alias */}
      {kind !== "tts" && kind !== "webSearch" && kind !== "webFetch" && (
        <ModelsCard
          providerId={id}
          kindFilter={kind}
          providerAliasOverride={isCustom ? customNode?.prefix : undefined}
        />
      )}

      {/* Provider Info — config-driven, supports searchConfig, fetchConfig, ttsConfig, embeddingConfig, searchViaChat */}
      {!isCustom &&
        (builtInProvider?.searchConfig ||
          builtInProvider?.fetchConfig ||
          builtInProvider?.ttsConfig ||
          builtInProvider?.sttConfig ||
          builtInProvider?.embeddingConfig ||
          builtInProvider?.searchViaChat) && (
          <ProviderInfoCard
            config={
              kind === "webFetch"
                ? builtInProvider?.fetchConfig
                : kind === "tts"
                  ? builtInProvider?.ttsConfig
                  : kind === "stt"
                    ? builtInProvider?.sttConfig
                    : kind === "embedding"
                      ? builtInProvider?.embeddingConfig
                      : builtInProvider?.searchConfig || {
                          mode: "chat-completions",
                          defaultModel: builtInProvider?.searchViaChat?.defaultModel,
                          pricingUrl: builtInProvider?.searchViaChat?.pricingUrl,
                          freeTier: builtInProvider?.searchViaChat?.freeTier,
                        }
            }
            provider={builtInProvider}
            title={`${kindConfig.label} Config`}
          />
        )}

      {/* Example — per kind */}
      {kind === "embedding" && (
        <EmbeddingExampleCard providerId={id} customAlias={customNode?.prefix} />
      )}
      {kind === "tts" && <TtsExampleCard providerId={id} />}
      {kind === "stt" && !isCustom && <SttExampleCard providerId={id} />}
      {!isCustom && (KIND_EXAMPLE_CONFIG as Record<string, any>)[kind] && (
        <GenericExampleCard providerId={id} kind={kind} />
      )}

      {isCustom && (
        <AddCustomEmbeddingModal
          isOpen={showEditModal}
          node={customNode}
          onClose={(): any => setShowEditModal(false)}
          onSaved={(updated: any): any => {
            setCustomNode(updated);
            setShowEditModal(false);
          }}
        />
      )}

      <ConfirmModal
        isOpen={confirmDialog.open}
        title={confirmDialog.title}
        message={confirmDialog.message}
        onConfirm={(): any => {
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
