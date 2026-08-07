import PropTypes from "prop-types";
import LucideIcon from "@/shared/components/LucideIcon";

type ModelInfo = {
  id: string;
  name?: string;
};

type TestStatus = string | null | undefined;

export default function ModelRow({
  model,
  fullModel,
  alias: _alias,
  copied,
  onCopy,
  testStatus,
  isCustom,
  isFree: _isFree,
  onDeleteAlias,
  onTest,
  isTesting,
  onDisable,
  onSetAlias: _onSetAlias,
}: {
  model: ModelInfo;
  fullModel?: string;
  alias?: string;
  copied?: string | null;
  onCopy?: (value: string, key: string) => void;
  testStatus?: TestStatus;
  isCustom?: boolean;
  isFree?: boolean;
  onDeleteAlias?: () => void;
  onTest?: () => void;
  isTesting?: boolean;
  onDisable?: () => void;
  onSetAlias?: (modelId: string, alias: string) => void;
}) {
  const borderColor = isTesting
    ? "border-border"
    : testStatus === "ok"
      ? "border-green-500/40"
      : testStatus === "error"
        ? "border-red-500/40"
        : "border-border";

  const iconColor = isTesting
    ? undefined
    : testStatus === "ok"
      ? "#22c55e"
      : testStatus === "error"
        ? "#ef4444"
        : undefined;

  return (
    <div
      className={`group min-w-0 max-w-full rounded-lg border px-3 py-2 ${
        isTesting ? "animate-pulse " + borderColor : borderColor
      } hover:bg-sidebar/50`}
    >
      <div className="flex min-w-0 items-start gap-2 sm:items-center">
        <LucideIcon
          name={
            isTesting
              ? "smart_toy"
              : testStatus === "ok"
                ? "check_circle"
                : testStatus === "error"
                  ? "cancel"
                  : "smart_toy"
          }
          className="shrink-0 text-base"
          style={iconColor ? { color: iconColor } : undefined}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <code className="max-w-[72vw] truncate rounded bg-sidebar px-1.5 py-0.5 font-mono text-xs text-text-muted sm:max-w-[360px]">
            {fullModel}
          </code>
          {model.name && (
            <span className="truncate pl-1 text-[9px] italic text-text-muted/70">{model.name}</span>
          )}
        </div>
        {onTest && (
          <div className="relative shrink-0 group/btn">
            <button
              onClick={onTest}
              disabled={isTesting}
              className="rounded p-0.5 text-text-muted hover:bg-sidebar hover:text-primary"
            >
              <LucideIcon
                name={isTesting ? "progress_activity" : "science"}
                className="text-sm"
                style={isTesting ? { animation: "spin 1s linear infinite" } : undefined}
              />
            </button>
            <span className="pointer-events-none absolute mt-1 top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
              {isTesting ? "Testing..." : "Test"}
            </span>
          </div>
        )}
        <div className="relative shrink-0 group/btn">
          <button
            onClick={() => onCopy?.(fullModel ?? "", `model-${model.id}`)}
            className="rounded p-0.5 text-text-muted hover:bg-sidebar hover:text-primary"
          >
            <LucideIcon
              name={copied === `model-${model.id}` ? "check" : "content_copy"}
              className="text-sm"
            />
          </button>
          <span className="pointer-events-none absolute mt-1 top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
            {copied === `model-${model.id}` ? "Copied!" : "Copy"}
          </span>
        </div>
        {isCustom ? (
          <button
            onClick={onDeleteAlias}
            className="ml-auto rounded p-0.5 text-text-muted hover:bg-red-500/10 hover:text-red-500"
            title="Remove custom model"
          >
            <LucideIcon name="close" className="text-sm" />
          </button>
        ) : onDisable ? (
          <button
            onClick={onDisable}
            className="ml-auto rounded p-0.5 text-text-muted hover:bg-red-500/10 hover:text-red-500"
            title="Disable this model"
          >
            <LucideIcon name="close" className="text-sm" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

ModelRow.propTypes = {
  model: PropTypes.shape({
    id: PropTypes.string.isRequired,
  }).isRequired,
  fullModel: PropTypes.string.isRequired,
  alias: PropTypes.string,
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  testStatus: PropTypes.oneOf(["ok", "error"]),
  isCustom: PropTypes.bool,
  isFree: PropTypes.bool,
  onDeleteAlias: PropTypes.func,
  onTest: PropTypes.func,
  isTesting: PropTypes.bool,
  onDisable: PropTypes.func,
};
