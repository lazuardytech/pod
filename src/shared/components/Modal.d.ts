import type { ComponentType } from "react";

declare const Modal: ComponentType<{
  isOpen?: any;
  onClose?: any;
  title?: any;
  children?: any;
  footer?: any;
  size?: string;
  closeOnOverlay?: boolean;
  showCloseButton?: boolean;
  className?: any;
  [key: string]: any;
}>;

export default Modal;

export declare const ConfirmModal: ComponentType<{
  isOpen?: any;
  onClose?: any;
  onConfirm?: any;
  title?: any;
  message?: any;
  confirmText?: string;
  cancelText?: string;
  variant?: string;
  loading?: boolean;
  [key: string]: any;
}>;
