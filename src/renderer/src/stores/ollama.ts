import { create } from 'zustand';
import type { OllamaStatus } from '../../../shared/types';

interface OllamaState {
  status: OllamaStatus;
  /** Subscribe once at app startup — handles initial fetch and live updates. */
  init: () => Promise<void>;
  /** User clicked "Start Ollama". */
  tryStart: () => Promise<void>;
  /** Force a re-probe (used by the "Check again" button). */
  refresh: () => Promise<void>;
  /** Unload a specific model from Ollama's resident memory. */
  unloadModel: (model: string) => Promise<void>;
  /** Unload everything currently in memory. */
  unloadAll: () => Promise<void>;
}

const INITIAL_STATUS: OllamaStatus = {
  state: 'checking',
  version: null,
  message: 'Checking Ollama…',
  hasModels: false,
  firstModel: null,
  loadedModels: []
};

let unsubscribeFn: (() => void) | null = null;

export const useOllama = create<OllamaState>((set) => ({
  status: INITIAL_STATUS,

  async init() {
    if (unsubscribeFn) return; // already initialised
    const initial = await window.api.ollama.getStatus();
    set({ status: initial });
    unsubscribeFn = window.api.ollama.onStatusChange((status) => {
      set({ status });
    });
  },

  async tryStart() {
    set((s) => ({ status: { ...s.status, state: 'checking', message: 'Starting Ollama…' } }));
    const next = await window.api.ollama.tryStart();
    set({ status: next });
  },

  async refresh() {
    const next = await window.api.ollama.getStatus();
    set({ status: next });
  },

  async unloadModel(model: string) {
    const next = await window.api.ollama.unloadModel(model);
    set({ status: next });
  },

  async unloadAll() {
    const next = await window.api.ollama.unloadAll();
    set({ status: next });
  }
}));
