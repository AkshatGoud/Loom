import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Library } from 'lucide-react';
import { useModels } from '../stores/models';
import { useOllama } from '../stores/ollama';
import { cn } from '../lib/utils';

interface ModelPickerProps {
  currentModel: string;
  /** The provider id of the current conversation — we only show switching when it's ollama. */
  provider: string;
  disabled?: boolean;
  onSelect: (modelId: string) => void;
  onOpenLibrary: () => void;
}

/**
 * Compact dropdown for switching the active model inside a conversation.
 * Lists locally installed Ollama models with a "loaded" pill for any that
 * are currently resident in RAM. Bottom of the menu has a "Manage models…"
 * link that opens the full ModelLibrary.
 *
 * Uses a plain button + menu rather than @radix-ui/react-dropdown-menu so
 * we don't have to pull an extra dependency and because the menu has
 * custom structure (grouped items, an action link).
 */
export function ModelPicker({
  currentModel,
  provider,
  disabled,
  onSelect,
  onOpenLibrary
}: ModelPickerProps) {
  const installed = useModels((s) => s.installed);
  const loadedModels = useOllama((s) => s.status.loadedModels);

  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click / escape
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        !triggerRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', handleClick);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('mousedown', handleClick);
      window.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const isLoaded = (name: string) =>
    loadedModels.some((m) => m.name === name);

  // Non-Ollama conversations show a static label (cloud providers don't
  // have a model picker yet — that's Phase 9).
  if (provider !== 'ollama') {
    return (
      <span className="text-xs text-muted-foreground">
        {provider} · {currentModel}
      </span>
    );
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md border border-border bg-background/40 px-2 py-1 text-xs transition hover:bg-accent',
          disabled && 'cursor-not-allowed opacity-60'
        )}
      >
        <span className="text-muted-foreground">ollama ·</span>
        <span className="max-w-[180px] truncate font-medium">
          {currentModel}
        </span>
        <ChevronDown
          className={cn(
            'h-3 w-3 text-muted-foreground transition-transform',
            open && 'rotate-180'
          )}
        />
      </button>

      {open && (
        <div
          ref={menuRef}
          className="absolute right-0 top-[calc(100%+4px)] z-20 w-72 overflow-hidden rounded-lg border border-border bg-card shadow-xl"
        >
          <div className="border-b border-border px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Installed models
          </div>
          <div className="max-h-[320px] overflow-y-auto py-1">
            {installed.length === 0 ? (
              <div className="px-3 py-4 text-xs text-muted-foreground">
                No models installed yet. Open the Model Library to pull one.
              </div>
            ) : (
              installed.map((m) => (
                <button
                  key={m.id}
                  onClick={() => {
                    onSelect(m.id);
                    setOpen(false);
                  }}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs transition hover:bg-accent',
                    m.id === currentModel && 'bg-accent/50'
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{m.id}</span>
                      {isLoaded(m.id) && (
                        <span
                          title="Currently resident in Ollama's RAM"
                          className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary"
                        >
                          <span className="h-1 w-1 animate-pulse rounded-full bg-primary" />
                          loaded
                        </span>
                      )}
                    </div>
                    {m.parameterSize && (
                      <div className="mt-0.5 text-[10px] text-muted-foreground">
                        {m.parameterSize}
                        {m.quantLevel && ` · ${m.quantLevel}`}
                      </div>
                    )}
                  </div>
                  {m.id === currentModel && (
                    <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  )}
                </button>
              ))
            )}
          </div>
          <div className="border-t border-border">
            <button
              onClick={() => {
                setOpen(false);
                onOpenLibrary();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground"
            >
              <Library className="h-3.5 w-3.5" />
              Manage models…
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
