import { useEffect, useState } from 'react';
import { X, Key, Check } from 'lucide-react';
import { useSettings } from '../stores/settings';
import { cn } from '../lib/utils';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const hasOpenAiKey = useSettings((s) => s.hasOpenAiKey);
  const setOpenAiKey = useSettings((s) => s.setOpenAiKey);
  const refresh = useSettings((s) => s.refresh);

  const [draft, setDraft] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft('');
      setSaved(false);
      void refresh();
    }
  }, [open, refresh]);

  if (!open) return null;

  const handleSave = async (): Promise<void> => {
    if (!draft.trim()) return;
    await setOpenAiKey(draft.trim());
    setSaved(true);
    setDraft('');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={cn(
          'w-full max-w-lg overflow-hidden rounded-xl border border-border bg-card shadow-2xl'
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold">Settings</h2>
          <button
            onClick={onClose}
            aria-label="Close settings"
            className="rounded-md p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 p-5">
          <section>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Key className="h-3.5 w-3.5" />
              Providers
            </div>

            <div className="rounded-lg border border-border p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">OpenAI</div>
                  <div className="text-xs text-muted-foreground">
                    GPT-4o, GPT-4.1, o-series
                  </div>
                </div>
                {hasOpenAiKey && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                    <Check className="h-3 w-3" /> Configured
                  </span>
                )}
              </div>

              <div className="mt-3 flex gap-2">
                <input
                  type="password"
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    setSaved(false);
                  }}
                  placeholder={hasOpenAiKey ? 'sk-… (replace current)' : 'sk-…'}
                  className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
                />
                <button
                  onClick={handleSave}
                  disabled={draft.trim().length === 0}
                  className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Save
                </button>
              </div>
              {saved && (
                <p className="mt-2 text-xs text-primary">Saved to local storage.</p>
              )}
              <p className="mt-2 text-[11px] text-muted-foreground">
                Stored locally in SQLite for now. Phase 3 moves secrets into the
                macOS Keychain via keytar.
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
