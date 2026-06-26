import type { ComponentType } from "react";

declare const Button: ComponentType<{
  children?: any;
  variant?: string;
  size?: string;
  icon?: any;
  iconRight?: any;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  className?: any;
  onClick?: any;
  type?: any;
  [key: string]: any;
}>;

export default Button;
