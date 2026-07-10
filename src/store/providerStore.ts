"use client";

import { create } from "zustand";

export interface Provider {
  _id: string;
  [key: string]: unknown;
}

export interface ProviderState {
  providers: Provider[];
  loading: boolean;
  error: string | null;
  setProviders: (providers: Provider[]) => void;
  addProvider: (provider: Provider) => void;
  updateProvider: (id: string, updates: Partial<Provider>) => void;
  removeProvider: (id: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  fetchProviders: () => Promise<void>;
}

const useProviderStore = create<ProviderState>((set, _get) => ({
  providers: [],
  loading: false,
  error: null,

  setProviders: (providers) => set({ providers }),

  addProvider: (provider) => set((state) => ({ providers: [provider, ...state.providers] })),

  updateProvider: (id, updates) =>
    set((state) => ({
      providers: state.providers.map((p) => (p._id === id ? { ...p, ...updates } : p)),
    })),

  removeProvider: (id) =>
    set((state) => ({
      providers: state.providers.filter((p) => p._id !== id),
    })),

  setLoading: (loading) => set({ loading }),

  setError: (error) => set({ error }),

  fetchProviders: async () => {
    set({ loading: true, error: null });
    try {
      const response = await fetch("/api/providers");
      const data = await response.json();
      if (response.ok) {
        set({ providers: data.providers as Provider[], loading: false });
      } else {
        set({ error: data.error as string, loading: false });
      }
    } catch (_error) {
      set({ error: "Failed to fetch providers", loading: false });
    }
  },
}));

export default useProviderStore;
