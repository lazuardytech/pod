import type { ComponentType } from "react";

declare const Card: ComponentType<{
  children?: any;
  title?: any;
  subtitle?: any;
  icon?: any;
  action?: any;
  padding?: string;
  hover?: boolean;
  elev?: boolean;
  nested?: boolean;
  className?: any;
  onClick?: any;
  [key: string]: any;
}>;

export default Card;
