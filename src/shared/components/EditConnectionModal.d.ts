import type { ComponentType } from "react";

declare const EditConnectionModal: ComponentType<{
  isOpen?: any;
  connection?: any;
  provider?: any;
  providerName?: any;
  proxyPools?: any;
  onSave?: any;
  onClose?: any;
  [key: string]: any;
}>;

export default EditConnectionModal;
