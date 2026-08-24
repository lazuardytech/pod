"use client";
import type { ChangeEvent, HTMLAttributes } from "react";
import LucideIcon from "@/shared/components/LucideIcon";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/utils/cn";

type PaginationProps = {
  currentPage?: number;
  pageSize?: number;
  totalItems?: number;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  className?: string;
} & Omit<HTMLAttributes<HTMLDivElement>, "children">;

export default function Pagination({
  currentPage = 1,
  pageSize = 10,
  totalItems = 0,
  onPageChange,
  onPageSizeChange,
  className,
  ...rest
}: PaginationProps) {
  const totalPages = Math.ceil(totalItems / pageSize) || 0;
  const startItem = totalItems > 0 ? (currentPage - 1) * pageSize + 1 : 0;
  const endItem = Math.min(currentPage * pageSize, totalItems);

  const getPageNumbers = () => {
    const pages: number[] = [];
    const showMax = 5;
    let start = Math.max(1, currentPage - 2);
    const end = Math.min(totalPages, start + showMax - 1);
    if (end - start + 1 < showMax) start = Math.max(1, end - showMax + 1);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  };

  const pageNumbers = getPageNumbers();

  return (
    <div
      className={cn(
        "flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3",
        className,
      )}
      {...rest}
    >
      {totalItems > 0 && (
        <p className="text-[12px] text-fog-grey tracking-[-0.1px]">
          <span className="text-storm-cloud">
            {startItem}–{endItem}
          </span>{" "}
          of <span className="text-storm-cloud">{totalItems}</span>
        </p>
      )}

      <div className="flex items-center gap-3">
        {onPageSizeChange && (
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-fog-grey">Rows</span>
            <select
              aria-label="Rows per page"
              value={pageSize}
              onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                onPageSizeChange(Number(e.target.value))
              }
              className="h-7 pl-2 pr-7 rounded-[6px] border border-charcoal-grey bg-gunmetal text-[12px] text-porcelain focus:outline-none focus:border-porcelain/50 cursor-pointer"
              style={{ colorScheme: "dark" }}
              name="page-size"
            >
              {[10, 20, 50].map((s) => (
                <option key={s} value={s} className="bg-graphite">
                  {s}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={currentPage <= 1}
            onClick={() => onPageChange?.(currentPage - 1)}
            aria-label="Previous page"
          >
            <LucideIcon name="chevron_left" className="text-[14px]" />
          </Button>

          {pageNumbers.map((page) => (
            <Button
              key={page}
              variant={page === currentPage ? "secondary" : "ghost"}
              size="sm"
              className="min-w-7 h-7 px-2 text-[12px]"
              onClick={() => onPageChange?.(page)}
            >
              {page}
            </Button>
          ))}

          <Button
            variant="ghost"
            size="icon-sm"
            disabled={currentPage >= totalPages}
            onClick={() => onPageChange?.(currentPage + 1)}
            aria-label="Next page"
          >
            <LucideIcon name="chevron_right" className="text-[14px]" />
          </Button>
        </div>
      </div>
    </div>
  );
}
