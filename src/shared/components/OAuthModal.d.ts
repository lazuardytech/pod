import type { ComponentType } from "react";

declare const OAuthModal: ComponentType<{
  isOpen?: any;
  provider?: any;
  providerInfo?: any;
  onSuccess?: any;
  onClose?: any;
  oauthMeta?: any;
  idcConfig?: any;
  [key: string]: any;
}>;

export default OAuthModal;
