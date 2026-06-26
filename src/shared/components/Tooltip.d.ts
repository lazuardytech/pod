import type { ComponentType } from "react";

declare const Tooltip: ComponentType<{
  text?: any;
  children?: any;
  position?: string;
  [key: string]: any;
}>;

export default Tooltip;
