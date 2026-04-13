import { create } from 'zustand';
import type {
  CuratedModel,
  InstalledModel,
  ModelPullProgress
} from '../../../shared/types';

interface ModelsState {
  installed: InstalledModel[];
  curated: CuratedModel[];
  /** In-flight pulls keyed by tag. */
  pulls: Record<string, ModelPullProgress>;
  loading: boolean;

  init: () => Promise<void>;
  refreshInstalled: () => Promise<void>;
  pull: (name: string) => Promise<void>;
  cancelPull: (name: string) => Promise<void>;
  deleteModel: (name: string) => Promise<void>;
}

let unsubscribeProgress: (() => void) | null = null;

export const useModels = create<ModelsState>((set, get) => ({
  installed: [],
  curated: [],
  pulls: {},
  loading: false,

  async init() {
    if (unsubscribeProgress) return; // already initialised
    set({ loading: true });
    const [installed, curated] = await Promise.all([
      window.api.models.listInstalled(),
      window.api.models.listCurated()
    ]);
    set({ installed, curated, loading: false });

    unsubscribeProgress = window.api.models.onPullProgress((progress) => {
      set((state) => {
        const nextPulls = { ...state.pulls, [progress.name]: progress };

        // On success or cancel, clear the pull entry after a short delay so
        // the card briefly shows "Done" before resetting.
        if (
          progress.status === 'success' ||
          progress.status === 'cancelled' ||
          progress.status === 'error'
        ) {
          setTimeout(() => {
            set((s) => {
              const { [progress.name]: _removed, ...rest } = s.pulls;
              return { pulls: rest };
            });
            // Pull succeeded → refresh installed list.
            if (progress.status === 'success') {
              void get().refreshInstalled();
            }
          }, 1500);
        }

        return { pulls: nextPulls };
      });
    });
  },

  async refreshInstalled() {
    const installed = await window.api.models.listInstalled();
    set({ installed });
  },

  async pull(name: string) {
    // Seed an immediate "queued" state so the UI reacts instantly.
    set((state) => ({
      pulls: {
        ...state.pulls,
        [name]: { name, status: 'downloading', total: 0, completed: 0 }
      }
    }));
    await window.api.models.pull(name);
  },

  async cancelPull(name: string) {
    await window.api.models.cancelPull(name);
  },

  async deleteModel(name: string) {
    const ok = await window.api.models.delete(name);
    if (ok) {
      await get().refreshInstalled();
    }
  }
}));

// ----- Selectors -----

export function isInstalled(installed: InstalledModel[], tag: string): boolean {
  return installed.some((m) => m.id === tag);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_024 ** 2) return `${(bytes / 1_024).toFixed(1)} KB`;
  if (bytes < 1_024 ** 3) return `${(bytes / 1_024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1_024 ** 3).toFixed(1)} GB`;
}
