import { useState } from 'react';
import { Plus, Terminal, Trash2, X } from 'lucide-react';
import { nanoid } from 'nanoid';
import { useMcp } from '../../stores/mcp';
import type { MCPServerConfig } from '../../../../shared/types';

interface ServerEditorProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Custom stdio MCP server editor. Stripped-down vs Phase 8's BYO
 * flow — HTTP transport + clipboard config import come later. This
 * is the "I know my MCP server and want to add it by hand" form
 * for cases the preset library doesn't cover.
 */
export function ServerEditor({ open, onClose }: ServerEditorProps) {
  const saveServer = useMcp((s) => s.saveServer);

  const [name, setName] = useState('');
  const [command, setCommand] = useState('npx');
  const [argsText, setArgsText] = useState('');
  const [envPairs, setEnvPairs] = useState<Array<{ key: string; value: string }>>([
    { key: '', value: '' }
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleSave = async () => {
    setError(null);
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    if (!command.trim()) {
      setError('Command is required');
      return;
    }

    const args = argsText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const env: Record<string, string> = {};
    for (const { key, value } of envPairs) {
      if (key.trim()) env[key.trim()] = value;
    }

    const config: MCPServerConfig = {
      id: `user:${nanoid(10)}`,
      name: name.trim(),
      enabled: true,
      source: 'user',
      transport: 'stdio',
      command: command.trim(),
      args: args.length > 0 ? args : undefined,
      env: Object.keys(env).length > 0 ? env : undefined
    };

    setSaving(true);
    try {
      await saveServer(config);
      // Reset the form before closing so the next open is fresh.
      setName('');
      setCommand('npx');
      setArgsText('');
      setEnvPairs([{ key: '', value: '' }]);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-background/90 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">Add custom MCP server</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <Field label="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My local tool server"
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:ring-1 focus:ring-ring"
            />
          </Field>

          <Field label="Command">
            <input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="npx"
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
            />
          </Field>

          <Field label="Arguments (one per line)">
            <textarea
              value={argsText}
              onChange={(e) => setArgsText(e.target.value)}
              rows={4}
              placeholder={'-y\n@some/mcp-server\n/allowed/path'}
              className="w-full resize-none rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
            />
          </Field>

          <Field label="Environment variables">
            <div className="space-y-1.5">
              {envPairs.map((pair, idx) => (
                <div key={idx} className="flex items-center gap-1.5">
                  <input
                    value={pair.key}
                    onChange={(e) => {
                      const next = envPairs.slice();
                      next[idx] = { ...next[idx], key: e.target.value };
                      setEnvPairs(next);
                    }}
                    placeholder="KEY"
                    className="flex-1 rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] outline-none focus:ring-1 focus:ring-ring"
                  />
                  <input
                    value={pair.value}
                    onChange={(e) => {
                      const next = envPairs.slice();
                      next[idx] = { ...next[idx], value: e.target.value };
                      setEnvPairs(next);
                    }}
                    placeholder="value"
                    type="password"
                    className="flex-[2] rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] outline-none focus:ring-1 focus:ring-ring"
                  />
                  <button
                    onClick={() => {
                      const next = envPairs.filter((_, i) => i !== idx);
                      setEnvPairs(next.length > 0 ? next : [{ key: '', value: '' }]);
                    }}
                    aria-label="Remove env var"
                    className="rounded p-1 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <button
                onClick={() => setEnvPairs([...envPairs, { key: '', value: '' }])}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Plus className="h-3 w-3" />
                Add env var
              </button>
            </div>
          </Field>

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
              {error}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-border px-5 py-3">
          <span className="text-[10px] text-muted-foreground">
            Secrets in env vars are stored in SQLite for now; Phase 9 moves
            them to the OS keychain.
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-md border border-border px-3 py-1.5 text-xs"
            >
              Cancel
            </button>
            <button
              onClick={() => void handleSave()}
              disabled={saving}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Field({
  label,
  children
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-[11px]">
      <span className="mb-1 block font-medium text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
