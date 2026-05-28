"use client";

import { cn } from "@/shared/utils/cn";

export default function Pagination({ currentPage, pageSize, totalItems, onPageChange, onPageSizeChange, className }) {
  const totalPages = Math.ceil(totalItems / pageSize);
  const startItem = totalItems > 0 ? (currentPage - 1) * pageSize + 1 : 0;
  const endItem = Math.min(currentPage * pageSize, totalItems);

  const getPageNumbers = () => {
    const pages = [];
    const showMax = 5;
    let start = Math.max(1, currentPage - 2);
    const end = Math.min(totalPages, start + showMax - 1);
    if (end - start + 1 < showMax) start = Math.max(1, end - showMax + 1);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  };

  const pageNumbers = getPageNumbers();

  return (
    <div className={cn("flex flex-col sm:flex-row items-center justify-between gap-3 py-3", className)}>
      {/* Info */}
      {totalItems > 0 && (
        <p className="text-[12px] text-fog-grey tracking-[-0.1px]">
          <span className="text-storm-cloud">
            {startItem}–{endItem}
          </span>{" "}
          of <span className="text-storm-cloud">{totalItems}</span>
        </p>
      )}

      <div className="flex items-center gap-3">
        {/* Page size */}
        {onPageSizeChange && (
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-fog-grey">Rows</span>
            <select
              aria-label="Rows per page"
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="h-7 px-2 rounded-[6px] border border-charcoal-grey bg-gunmetal text-[12px] text-porcelain focus:outline-none focus:border-porcelain/50 cursor-pointer"
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

        {/* Pages */}
        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => onPageChange(currentPage - 1)}
              disabled={currentPage === 1}
              className="flex items-center justify-center size-7 rounded-[6px] border border-charcoal-grey text-storm-cloud hover:bg-deep-slate hover:text-porcelain disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-100"
            >
              <span className="material-symbols-outlined text-[14px]">chevron_left</span>
            </button>

            {pageNumbers[0] > 1 && (
              <>
                <button
                  onClick={() => onPageChange(1)}
                  className="flex items-center justify-center size-7 rounded-[6px] text-[12px] text-storm-cloud hover:bg-deep-slate hover:text-porcelain transition-colors duration-100"
                >
                  1
                </button>
                {pageNumbers[0] > 2 && <span className="text-[12px] text-fog-grey px-0.5">…</span>}
              </>
            )}

            {pageNumbers.map((page) => (
              <button
                key={page}
                onClick={() => onPageChange(page)}
                className={cn(
                  "flex items-center justify-center size-7 rounded-[6px] text-[12px] transition-colors duration-100",
                  currentPage === page
                    ? "bg-porcelain text-pitch-black font-[590]"
                    : "text-storm-cloud hover:bg-deep-slate hover:text-porcelain",
                )}
              >
                {page}
              </button>
            ))}

            {pageNumbers[pageNumbers.length - 1] < totalPages && (
              <>
                {pageNumbers[pageNumbers.length - 1] < totalPages - 1 && (
                  <span className="text-[12px] text-fog-grey px-0.5">…</span>
                )}
                <button
                  onClick={() => onPageChange(totalPages)}
                  className="flex items-center justify-center size-7 rounded-[6px] text-[12px] text-storm-cloud hover:bg-deep-slate hover:text-porcelain transition-colors duration-100"
                >
                  {totalPages}
                </button>
              </>
            )}

            <button
              onClick={() => onPageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="flex items-center justify-center size-7 rounded-[6px] border border-charcoal-grey text-storm-cloud hover:bg-deep-slate hover:text-porcelain disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-100"
            >
              <span className="material-symbols-outlined text-[14px]">chevron_right</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
