import type { ComponentType } from "react";

declare const Textarea: ComponentType<{
  label?: any;
  placeholder?: any;
  value?: any;
  onChange?: any;
  error?: any;
  hint?: any;
  disabled?: boolean;
  required?: boolean;
  rows?: number;
  className?: any;
  [key: string]: any;
}>;

export default Textarea;
