import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Download,
  Eye,
  HardDrive,
  Package,
  Search,
  Trash2,
  X,
  XCircle
} from 'lucide-react';
import { useModels, formatBytes, isInstalled } from '../stores/models';
import type { CuratedModel, ModelCategory } from '../../../shared/types';
import { cn } from '../lib/utils';

interface ModelLibraryProps {
  open: boolean;
  onClose: () => void;
}

const CATEGORY_LABELS: Record<ModelCategory, string> = {
  multimodal: 'Multimodal assistants',
  text: 'Text assistants',
  coding: 'Coding',
  reasoning: 'Reasoning',
  vision: 'Vision'
};

const CATEGORY_ORDER: ModelCategory[] = [
  'multimodal',
  'text',
  'coding',
  'reasoning',
  'vision'
];

function curatedMatches(model: CuratedModel, query: string): boolean {
  if (!query.trim()) return true;
  const q = query.toLowerCase();
  return (
    model.id.toLowerCase().includes(q) ||
    model.displayName.toLowerCase().includes(q) ||
    model.description.toLowerCase().includes(q) ||
    model.family.toLowerCase().includes(q) ||
    model.tags.some((t) => t.toLowerCase().includes(q))
  );
}

function looksLikeTag(query: string): boolean {
  // Heuristic: Ollama tags are alphanumeric + `:`, `-`, `_`, `.`, `/`
  // and usually contain either a `:` or a known family name.
  const trimmed = query.trim();
  if (!trimmed) return false;
  return /^[a-z0-9][a-z0-9:\-_.\/]*$/i.test(trimmed);
}

export function ModelLibrary({ open, onClose }: ModelLibraryProps) {
  const installed = useModels((s) => s.installed);
  const curated = useModels((s) => s.curated);
  const pulls = useModels((s) => s.pulls);
  const init = useModels((s) => s.init);
  const refreshInstalled = useModels((s) => s.refreshInstalled);
  const pullModel = useModels((s) => s.pull);
  const cancelPull = useModels((s) => s.cancelPull);
  const deleteModel = useModels((s) => s.deleteModel);

  const [query, setQuery] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void init();
    void refreshInstalled();
  }, [open, init, refreshInstalled]);

  // Keyboard: Esc to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const filteredCurated = useMemo(
    () => curated.filter((m) => curatedMatches(m, query)),
    [curated, query]
  );

  const groupedCurated = useMemo(() => {
    const groups: Record<ModelCategory, CuratedModel[]> = {
      multimodal: [],
      text: [],
      coding: [],
      reasoning: [],
      vision: []
    };
    for (const m of filteredCurated) groups[m.category].push(m);
    return groups;
  }, [filteredCurated]);

  // Show the "Pull custom: X" fallback when the query is a valid-looking
  // tag AND it doesn't already match an installed or curated model.
  const showCustomPull =
    query.trim().length > 0 &&
    looksLikeTag(query) &&
    !curated.some((m) => m.id.toLowerCase() === query.trim().toLowerCase()) &&
    !installed.some((m) => m.id.toLowerCase() === query.trim().toLowerCase());

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-background/95 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">Model Library</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Search */}
        <div className="border-b border-border px-5 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search models or paste an Ollama tag (e.g. phi3:mini)…"
              className="w-full rounded-md border border-border bg-background pl-9 pr-9 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Body (scrollable) */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* Installed section */}
          {installed.length > 0 && (
            <section className="mb-6">
              <SectionHeader
                icon={<HardDrive className="h-3.5 w-3.5" />}
                label={`Installed (${installed.length})`}
              />
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {installed.map((model) => (
                  <div
                    key={model.id}
                    className="flex items-start justify-between gap-3 rounded-lg border border-border bg-secondary/20 p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{model.id}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                        <span>{formatBytes(model.sizeBytes)}</span>
                        {model.parameterSize && (
                          <>
                            <span>·</span>
                            <span>{model.parameterSize}</span>
                          </>
                        )}
                        {model.quantLevel && (
                          <>
                            <span>·</span>
                            <span>{model.quantLevel}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        onClick={() => {
                          void window.api.models.show(model.id);
                        }}
                        aria-label="Inspect model"
                        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setDeleting(model.id)}
                        aria-label="Delete model"
                        className="rounded p-1 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Custom-tag fallback */}
          {showCustomPull && (
            <section className="mb-6">
              <SectionHeader
                icon={<Download className="h-3.5 w-3.5" />}
                label="Pull custom tag"
              />
              <CustomPullCard
                tag={query.trim()}
                pull={pulls[query.trim()]}
                onPull={() => pullModel(query.trim())}
                onCancel={() => cancelPull(query.trim())}
              />
            </section>
          )}

          {/* Curated catalog */}
          {CATEGORY_ORDER.map((category) => {
            const models = groupedCurated[category];
            if (models.length === 0) return null;
            return (
              <section key={category} className="mb-6">
                <SectionHeader
                  icon={<Package className="h-3.5 w-3.5" />}
                  label={CATEGORY_LABELS[category]}
                />
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {models.map((model) => (
                    <CuratedCard
                      key={model.id}
                      model={model}
                      installed={isInstalled(installed, model.id)}
                      pull={pulls[model.id]}
                      onPull={() => pullModel(model.id)}
                      onCancel={() => cancelPull(model.id)}
                      onDelete={() => setDeleting(model.id)}
                    />
                  ))}
                </div>
              </section>
            );
          })}

          {filteredCurated.length === 0 &&
            !showCustomPull &&
            query.trim().length > 0 && (
              <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
                No models match &quot;{query}&quot;.
              </div>
            )}
        </div>

        {/* Footer */}
        <footer className="flex items-center justify-between border-t border-border px-5 py-3 text-[11px] text-muted-foreground">
          <span>{curated.length} curated · {installed.length} installed</span>
          <span>Press Esc to close</span>
        </footer>
      </div>

      {/* Delete confirmation */}
      {deleting && (
        <ConfirmDelete
          name={deleting}
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            await deleteModel(deleting);
            setDeleting(null);
          }}
        />
      )}
    </div>
  );
}

// ----- Subcomponents -----

function SectionHeader({
  icon,
  label
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {icon}
      {label}
    </div>
  );
}

interface CuratedCardProps {
  model: CuratedModel;
  installed: boolean;
  pull: ReturnType<typeof useModels.getState>['pulls'][string] | undefined;
  onPull: () => void;
  onCancel: () => void;
  onDelete: () => void;
}

function CuratedCard({
  model,
  installed,
  pull,
  onPull,
  onCancel,
  onDelete
}: CuratedCardProps) {
  const pulling = pull != null && pull.status !== 'success' && pull.status !== 'error' && pull.status !== 'cancelled';
  const progressPct =
    pull && pull.total && pull.completed
      ? Math.min(100, Math.round((pull.completed / pull.total) * 100))
      : 0;

  return (
    <div className="rounded-lg border border-border bg-background/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{model.displayName}</span>
            {installed && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                <Check className="h-3 w-3" /> installed
              </span>
            )}
          </div>
          <code className="mt-0.5 block text-[11px] text-muted-foreground">
            {model.id}
          </code>
          <p className="mt-2 text-xs text-muted-foreground">
            {model.description}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
            <Chip>{formatBytes(model.approxSizeBytes)}</Chip>
            <Chip>{model.parameterSize}</Chip>
            <Chip>{formatBytes(model.minRamBytes)}+ RAM</Chip>
            {model.supportsTools && <Chip>tools</Chip>}
            {model.supportsVision && <Chip>vision</Chip>}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-end gap-2">
        {pulling && (
          <>
            <div className="flex-1 text-[11px] text-muted-foreground">
              <div className="flex justify-between">
                <span className="capitalize">{pull.status}</span>
                {pull.total && <span>{progressPct}%</span>}
              </div>
              <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full bg-primary transition-[width] duration-200"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
            <button
              onClick={onCancel}
              aria-label="Cancel download"
              className="rounded-md border border-border p-1.5 text-muted-foreground hover:bg-accent"
            >
              <XCircle className="h-3.5 w-3.5" />
            </button>
          </>
        )}
        {!pulling && !installed && (
          <button
            onClick={onPull}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
          >
            <Download className="h-3 w-3" />
            Pull
          </button>
        )}
        {!pulling && installed && (
          <button
            onClick={onDelete}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="h-3 w-3" />
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

function CustomPullCard({
  tag,
  pull,
  onPull,
  onCancel
}: {
  tag: string;
  pull: ReturnType<typeof useModels.getState>['pulls'][string] | undefined;
  onPull: () => void;
  onCancel: () => void;
}) {
  const pulling = pull != null && pull.status !== 'success' && pull.status !== 'error' && pull.status !== 'cancelled';
  const progressPct =
    pull && pull.total && pull.completed
      ? Math.min(100, Math.round((pull.completed / pull.total) * 100))
      : 0;

  return (
    <div className="rounded-lg border border-dashed border-border bg-secondary/20 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium text-muted-foreground">
            Not in the curated catalog — pull as a custom tag:
          </div>
          <code className="mt-1 block truncate text-sm font-semibold">
            {tag}
          </code>
        </div>
        {!pulling ? (
          <button
            onClick={onPull}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
          >
            <Download className="h-3 w-3" /> Pull custom
          </button>
        ) : (
          <button
            onClick={onCancel}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs"
          >
            <XCircle className="h-3 w-3" /> Cancel
          </button>
        )}
      </div>
      {pulling && (
        <div className="mt-2 text-[11px] text-muted-foreground">
          <div className="flex justify-between">
            <span className="capitalize">{pull.status}</span>
            {pull.total && <span>{progressPct}%</span>}
          </div>
          <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full bg-primary transition-[width] duration-200"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-border bg-background/40 px-1.5 py-0.5">
      {children}
    </span>
  );
}

function ConfirmDelete({
  name,
  onCancel,
  onConfirm
}: {
  name: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold">Delete model?</h3>
        <p className="mt-2 text-xs text-muted-foreground">
          This removes <code className="text-foreground">{name}</code> from
          Ollama&apos;s storage. You can always re-pull it later.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={cn(
              'rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:opacity-90'
            )}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
