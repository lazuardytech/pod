"use client";

import PropTypes from "prop-types";
import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Card from "@/shared/components/Card";
import LucideIcon from "@/shared/components/LucideIcon";

const fmt = (n: number | null | undefined) => new Intl.NumberFormat().format(n || 0);
const fmtCost = (n: number | null | undefined) => `$${(n || 0).toFixed(2)}`;

function fmtTime(iso: string | number | Date | null | undefined) {
  if (!iso) return "Never";
  const diffMins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
  return new Date(iso).toLocaleDateString();
}

function SortIcon({
  field,
  currentSort,
  currentOrder,
}: {
  field: string;
  currentSort: string;
  currentOrder: string;
}) {
  if (currentSort !== field) return <span className="ml-1 opacity-20">↕</span>;
  return <span className="ml-1">{currentOrder === "asc" ? "↑" : "↓"}</span>;
}

SortIcon.propTypes = {
  field: PropTypes.string.isRequired,
  currentSort: PropTypes.string.isRequired,
  currentOrder: PropTypes.string.isRequired,
};

type UsageValueItem = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  inputCost?: number;
  outputCost?: number;
  totalCost?: number;
  cost?: number;
  pending?: number;
  [key: string]: unknown;
};

/**
 * Render 3 token or cost cells based on viewMode
 */
function ValueCells({
  item,
  viewMode,
  isSummary = false,
}: {
  item: UsageValueItem;
  viewMode: string;
  isSummary?: boolean;
}) {
  if (viewMode === "tokens") {
    return (
      <>
        <td className="px-6 py-3 text-right text-text-muted">
          {isSummary && item.promptTokens === undefined ? "—" : fmt(item.promptTokens)}
        </td>
        <td className="px-6 py-3 text-right text-text-muted">
          {isSummary && item.completionTokens === undefined ? "—" : fmt(item.completionTokens)}
        </td>
        <td className="px-6 py-3 text-right font-medium">{fmt(item.totalTokens)}</td>
      </>
    );
  }
  return (
    <>
      <td className="px-6 py-3 text-right text-text-muted">
        {isSummary && item.inputCost === undefined ? "—" : fmtCost(item.inputCost)}
      </td>
      <td className="px-6 py-3 text-right text-text-muted">
        {isSummary && item.outputCost === undefined ? "—" : fmtCost(item.outputCost)}
      </td>
      <td className="px-6 py-3 text-right font-medium text-warning">
        {fmtCost(item.totalCost || item.cost)}
      </td>
    </>
  );
}

ValueCells.propTypes = {
  item: PropTypes.object.isRequired,
  viewMode: PropTypes.string.isRequired,
  isSummary: PropTypes.bool,
};

type UsageColumn = {
  field: string;
  label: string;
  align?: string;
};

type UsageGroup = {
  groupKey: string;
  summary: UsageValueItem;
  items: Array<UsageValueItem & { key?: string }>;
};

type UsageTableProps = {
  title: string;
  columns: UsageColumn[];
  groupedData: UsageGroup[];
  tableType: string;
  sortBy: string;
  sortOrder: string;
  onToggleSort: (tableType: string, field: string) => void;
  viewMode: string;
  storageKey: string;
  renderDetailCells: (item: UsageValueItem & { key?: string }) => ReactNode;
  renderSummaryCells: (group: UsageGroup) => ReactNode;
  emptyMessage: string;
};

/**
 * Reusable sortable usage table with expandable group rows.
 */
export default function UsageTable({
  title,
  columns,
  groupedData,
  tableType,
  sortBy,
  sortOrder,
  onToggleSort,
  viewMode,
  storageKey,
  renderDetailCells,
  renderSummaryCells,
  emptyMessage,
}: UsageTableProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Load expanded state from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) setExpanded(new Set(JSON.parse(saved) as string[]));
    } catch (e) {
      console.error(`Failed to load ${storageKey}:`, e);
    }
  }, [storageKey]);

  // Save expanded state to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify([...expanded]));
    } catch (e) {
      console.error(`Failed to save ${storageKey}:`, e);
    }
  }, [expanded, storageKey]);

  const toggleGroup = useCallback((groupKey: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  }, []);

  const valueColumns = useMemo(() => {
    if (viewMode === "tokens") {
      return [
        { field: "promptTokens", label: "Input Tokens" },
        { field: "completionTokens", label: "Output Tokens" },
        { field: "totalTokens", label: "Total Tokens" },
      ];
    }
    return [
      { field: "promptTokens", label: "Input Cost" },
      { field: "completionTokens", label: "Output Cost" },
      { field: "cost", label: "Total Cost" },
    ];
  }, [viewMode]);

  const totalColSpan = columns.length + valueColumns.length;

  return (
    <Card className="overflow-hidden px-3 pb-3 pt-0" padding="none">
      <div className="border-b border-border bg-bg-subtle/50 px-4 py-2">
        <h3 className="font-semibold">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="bg-bg-subtle/30 text-text-muted uppercase text-xs">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.field}
                  className={`px-6 py-3 cursor-pointer hover:bg-bg-subtle/50 ${col.align === "right" ? "text-right" : ""}`}
                  onClick={() => onToggleSort(tableType, col.field)}
                >
                  {col.label}{" "}
                  <SortIcon field={col.field} currentSort={sortBy} currentOrder={sortOrder} />
                </th>
              ))}
              {valueColumns.map((col) => (
                <th
                  key={col.field}
                  className="px-6 py-3 text-right cursor-pointer hover:bg-bg-subtle/50"
                  onClick={() => onToggleSort(tableType, col.field)}
                >
                  {col.label}{" "}
                  <SortIcon field={col.field} currentSort={sortBy} currentOrder={sortOrder} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {groupedData.map((group) => (
              <Fragment key={group.groupKey}>
                {/* Group summary row */}
                <tr
                  className="group-summary cursor-pointer hover:bg-bg-subtle/50 transition-colors"
                  onClick={() => toggleGroup(group.groupKey)}
                >
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-2">
                      <LucideIcon
                        name="chevron_right"
                        className={`text-[18px] text-text-muted transition-transform ${expanded.has(group.groupKey) ? "rotate-90" : ""}`}
                      />
                      <span
                        className={`font-medium transition-colors ${(group.summary.pending ?? 0) > 0 ? "text-primary" : ""}`}
                      >
                        {group.groupKey}
                      </span>
                    </div>
                  </td>
                  {renderSummaryCells(group)}
                  <ValueCells item={group.summary} viewMode={viewMode} isSummary />
                </tr>
                {/* Detail rows */}
                {expanded.has(group.groupKey) &&
                  group.items.map((item) => (
                    <tr
                      key={`detail-${item.key}`}
                      className="group-detail hover:bg-bg-subtle/20 transition-colors"
                    >
                      {renderDetailCells(item)}
                      <ValueCells item={item} viewMode={viewMode} />
                    </tr>
                  ))}
              </Fragment>
            ))}
            {groupedData.length === 0 && (
              <tr>
                <td colSpan={totalColSpan} className="px-6 py-8 text-center text-text-muted">
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

UsageTable.propTypes = {
  title: PropTypes.string.isRequired,
  columns: PropTypes.arrayOf(
    PropTypes.shape({
      field: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired,
      align: PropTypes.string,
    }),
  ).isRequired,
  groupedData: PropTypes.array.isRequired,
  tableType: PropTypes.string.isRequired,
  sortBy: PropTypes.string.isRequired,
  sortOrder: PropTypes.string.isRequired,
  onToggleSort: PropTypes.func.isRequired,
  viewMode: PropTypes.string.isRequired,
  storageKey: PropTypes.string.isRequired,
  renderDetailCells: PropTypes.func.isRequired,
  renderSummaryCells: PropTypes.func.isRequired,
  emptyMessage: PropTypes.string.isRequired,
};

// Re-export utilities for use in UsageStats orchestrator
export { fmt, fmtCost, fmtTime };
