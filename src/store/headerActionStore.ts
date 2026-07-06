/**
 * Header Action Store — Zustand-based reusable action slot in Header.
 * Pages register a button config on mount, unregister on unmount.
 */

import { create } from "zustand";

export interface HeaderAction {
  label?: string;
  icon?: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  title?: string;
}

export interface HeaderActionState {
  action: HeaderAction | null;
  register: (action: HeaderAction) => void;
  unregister: () => void;
}

export const useHeaderActionStore = create<HeaderActionState>((set) => ({
  action: null,

  register: (action) => set({ action }),
  unregister: () => set({ action: null }),
}));
