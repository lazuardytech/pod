import PropTypes from "prop-types";
import { IconButton } from "@/shared/components";
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
  thinkingSuffix,
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
  thinkingSuffix?: string | null;
}) {
  const displayModel =
    thinkingSuffix && fullModel ? `${fullModel}(${thinkingSuffix})` : (fullModel ?? "");
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
            {displayModel}
          </code>
          {model.name && (
            <span className="truncate pl-1 text-[9px] italic text-text-muted/70">{model.name}</span>
          )}
        </div>
        {onTest && (
          <IconButton
            icon="science"
            title={isTesting ? "Testing..." : "Test"}
            size="sm"
            onClick={onTest}
            disabled={isTesting}
            loading={isTesting}
            className="shrink-0"
          />
        )}
        <IconButton
          icon={copied === `model-${model.id}` ? "check" : "content_copy"}
          title={
            copied === `model-${model.id}`
              ? "Copied!"
              : thinkingSuffix
                ? "Copy with (level) suffix"
                : "Copy"
          }
          size="sm"
          onClick={() => onCopy?.(displayModel, `model-${model.id}`)}
          className="shrink-0"
        />
        {isCustom ? (
          <IconButton
            icon="close"
            title="Remove custom model"
            size="sm"
            onClick={onDeleteAlias}
            className="ml-auto text-red-500 hover:bg-red-500/10 hover:text-red-500"
          />
        ) : onDisable ? (
          <IconButton
            icon="close"
            title="Disable this model"
            size="sm"
            onClick={onDisable}
            className="ml-auto text-red-500 hover:bg-red-500/10 hover:text-red-500"
          />
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
  thinkingSuffix: PropTypes.string,
};
