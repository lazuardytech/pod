import type { ComponentType } from "react";

declare const ModelSelectModal: ComponentType<{
  isOpen?: any;
  onClose?: any;
  onSelect?: any;
  onDeselect?: any;
  selectedModel?: any;
  activeProviders?: any[];
  title?: string;
  modelAliases?: {};
  kindFilter?: any;
  addedModelValues?: any[];
  closeOnSelect?: boolean;
  [key: string]: any;
}>;

export default ModelSelectModal;
