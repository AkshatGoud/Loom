import { useEffect, useState } from 'react';
import {
  Check,
  CircleDot,
  Plus,
  RefreshCw,
  Server,
  Trash2,
  X
} from 'lucide-react';
import { useMcp } from '../../stores/mcp';
import { ServerEditor } from './ServerEditor';
import { ServerPresets } from './ServerPresets';
import type {
  MCPServerConnectionState,
  MCPServerState
} from '../../../../shared/types';
import { cn } from '../../lib/utils';

interface ServerListProps {
  open: boolean;
  onClose: () => void;
}

const STATE_LABELS: Record<MCPServerConnectionState, string> = {
  idle: 'idle',
  connecting: 'connecting…',
  connected: 'connected',
  error: 'error',
  disconnected: 'disconnected'
};

const STATE_COLORS: Record<MCPServerConnectionState, string> = {
  idle: 'text-muted-foreground',
  connecting: 'text-primary',
  connected: 'text-emerald-400',
  error: 'text-destructive',
  disconnected: 'text-muted-foreground'
};

/**
 * Full-screen MCP server management modal. Two columns:
 *
 *   - Left: list of currently-installed servers with connection
 *     state, tool counts, and delete buttons.
 *   - Right: bundled preset library (filesystem, memory, legacy
 *     github, legacy brave-search) for one-click installs, plus a
 *     "+ Add custom" button that opens the ServerEditor for a
 *     hand-built stdio config.
 */
export function ServerList({ open, onClose }: ServerListProps) {
  const init = useMcp((s) => s.init);
  const refreshServers = useMcp((s) => s.refreshServers);
  const servers = useMcp((s) => s.servers);
  const removeServer = useMcp((s) => s.removeServer);

  const [editorOpen, setEditorOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<MCPServerState | null>(
    null
  );

  useEffect(() => {
    if (!open) return;
    void init();
    void refreshServers();
  }, [open, init, refreshServers]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-background/95 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">MCP Servers</h2>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => void refreshServers()}
              aria-label="Refresh"
              className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Refresh"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={onClose}
              aria-label="Close"
              className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="grid flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[1fr_1.2fr]">
          {/* Installed servers */}
          <section className="overflow-y-auto border-b border-border p-5 lg:border-b-0 lg:border-r">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Installed servers ({servers.length})
              </h3>
              <button
                onClick={() => setEditorOpen(true)}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium hover:bg-accent"
              >
                <Plus className="h-3 w-3" />
                Add custom
              </button>
            </div>
            {servers.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-secondary/20 p-6 text-center text-xs text-muted-foreground">
                No MCP servers installed yet. Click a preset on the right
                to install one with one click, or add a custom stdio server.
              </div>
            ) : (
              <ul className="space-y-2">
                {servers.map((s) => (
                  <li
                    key={s.config.id}
                    className="rounded-lg border border-border bg-secondary/20 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">
                            {s.config.name}
                          </span>
                          {s.config.source === 'bundled' && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-primary">
                              preset
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                          <CircleDot
                            className={cn('h-2.5 w-2.5', STATE_COLORS[s.connection])}
                          />
                          <span className={STATE_COLORS[s.connection]}>
                            {STATE_LABELS[s.connection]}
                          </span>
                          <span>·</span>
                          <span>{s.tools.length} tools</span>
                          <span>·</span>
                          <span>{s.config.transport}</span>
                        </div>
                        {s.lastError && (
                          <div className="mt-1 truncate text-[10px] text-destructive">
                            {s.lastError}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => setConfirmDelete(s)}
                        aria-label="Remove server"
                        className="rounded p-1 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {s.tools.length > 0 && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[10px] text-muted-foreground hover:text-foreground">
                          {s.tools.length} tools available
                        </summary>
                        <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px]">
                          {s.tools.map((t) => (
                            <code
                              key={t.name}
                              className="truncate text-muted-foreground"
                              title={t.description}
                            >
                              {t.name}
                            </code>
                          ))}
                        </div>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Preset library */}
          <section className="overflow-y-auto p-5">
            <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Server library
            </h3>
            <ServerPresets />
          </section>
        </div>

        <footer className="border-t border-border px-5 py-3 text-[11px] text-muted-foreground">
          MCP servers run as subprocesses on your machine. Tool calls
          require explicit approval before execution by default.
        </footer>
      </div>

      <ServerEditor open={editorOpen} onClose={() => setEditorOpen(false)} />

      {confirmDelete && (
        <ConfirmRemove
          server={confirmDelete}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            await removeServer(confirmDelete.config.id);
            setConfirmDelete(null);
          }}
        />
      )}
    </div>
  );
}

function ConfirmRemove({
  server,
  onCancel,
  onConfirm
}: {
  server: MCPServerState;
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
        <h3 className="text-sm font-semibold">Remove MCP server?</h3>
        <p className="mt-2 text-xs text-muted-foreground">
          This removes <span className="font-medium text-foreground">{server.config.name}</span>{' '}
          from Loom. Any conversation that was using its tools will lose
          access immediately. You can re-add it later from the preset
          library or as a custom server.
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
            className="inline-flex items-center gap-1 rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:opacity-90"
          >
            <Check className="h-3 w-3" />
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}
