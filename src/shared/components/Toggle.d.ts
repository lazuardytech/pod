import type { ComponentType } from "react";

declare const Toggle: ComponentType<{
  checked?: boolean;
  onChange?: any;
  label?: any;
  description?: any;
  disabled?: boolean;
  size?: string;
  className?: any;
  [key: string]: any;
}>;

export default Toggle;
