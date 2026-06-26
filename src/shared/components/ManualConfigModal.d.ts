import type { ComponentType } from "react";

declare const ManualConfigModal: ComponentType<{
  isOpen?: any;
  onClose?: any;
  title?: string;
  configs?: any[];
  [key: string]: any;
}>;

export default ManualConfigModal;
