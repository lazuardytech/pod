import type { ComponentType } from "react";

declare const Header: ComponentType<{
  onMenuClick?: any;
  showMenuButton?: boolean;
  sidebarCollapsed?: any;
  onToggleSidebar?: any;
  [key: string]: any;
}>;

export default Header;
