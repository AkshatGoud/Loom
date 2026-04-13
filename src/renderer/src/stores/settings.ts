import { create } from 'zustand';

interface SettingsState {
  hasOpenAiKey: boolean;
  refreshing: boolean;
  refresh: () => Promise<void>;
  setOpenAiKey: (key: string) => Promise<void>;
}

export const useSettings = create<SettingsState>((set) => ({
  hasOpenAiKey: false,
  refreshing: false,

  async refresh() {
    set({ refreshing: true });
    const hasOpenAiKey = await window.api.settings.hasOpenAiKey();
    set({ hasOpenAiKey, refreshing: false });
  },

  async setOpenAiKey(key: string) {
    await window.api.settings.set('openai.apiKey', key);
    set({ hasOpenAiKey: key.length > 0 });
  }
}));
