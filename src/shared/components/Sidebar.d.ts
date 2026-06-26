import type { ComponentType } from "react";

declare const Sidebar: ComponentType<{
  onClose?: any;
  collapsed?: boolean;
  onToggleCollapse?: any;
  [key: string]: any;
}>;

export default Sidebar;
