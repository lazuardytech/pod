import type { ComponentType } from "react";

declare const Pagination: ComponentType<{
  currentPage?: any;
  pageSize?: any;
  totalItems?: any;
  onPageChange?: any;
  onPageSizeChange?: any;
  className?: any;
  [key: string]: any;
}>;

export default Pagination;
