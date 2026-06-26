import type { ComponentType } from "react";

declare const Select: ComponentType<{
  label?: any;
  options?: any[];
  value?: any;
  onChange?: any;
  placeholder?: string;
  error?: any;
  hint?: any;
  disabled?: boolean;
  required?: boolean;
  className?: any;
  selectClassName?: any;
  id?: any;
  name?: any;
  [key: string]: any;
}>;

export default Select;
