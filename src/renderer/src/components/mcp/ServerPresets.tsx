import { useState } from 'react';
import { Download, FolderOpen, KeyRound } from 'lucide-react';
import { nanoid } from 'nanoid';
import { useMcp } from '../../stores/mcp';
import type { MCPServerPreset } from '../../../../shared/types';
import { cn } from '../../lib/utils';

const FAMILY_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  filesystem: FolderOpen,
  memory: KeyRound,
  github: KeyRound,
  'brave-search': KeyRound,
  other: KeyRound
};

/**
 * Grid of one-click install cards for the bundled MCP server
 * presets. Lives as a section inside ServerList.tsx.
 *
 * Presets that need extra input (filesystem directory, API keys)
 * open an inline collapsible form on the card before installing.
 * The main-process preset factories live in
 * `src/main/mcp/bundled.ts` — this component only deals with the
 * renderer-visible metadata and invokes the `saveServer` IPC with a
 * fully-built MCPServerConfig.
 */
export function ServerPresets() {
  const presets = useMcp((s) => s.presets);
  const servers = useMcp((s) => s.servers);
  const saveServer = useMcp((s) => s.saveServer);

  const [activePreset, setActivePreset] = useState<string | null>(null);

  if (presets.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-secondary/20 p-4 text-xs text-muted-foreground">
        Loading presets…
      </div>
    );
  }

  const isPresetInstalled = (preset: MCPServerPreset): boolean => {
    // Presets stay installable even after use — a user might want a
    // second filesystem server for a different directory. We only
    // mark a preset as "installed" if there's at least one saved
    // server whose id starts with the preset id.
    return servers.some((s) => s.config.id.startsWith(`preset:${preset.id}`));
  };

  return (
    <div className="space-y-2">
      {presets.map((preset) => {
        const Icon = FAMILY_ICON[preset.family] ?? FolderOpen;
        const isActive = activePreset === preset.id;
        const installed = isPresetInstalled(preset);

        return (
          <div
            key={preset.id}
            className="rounded-lg border border-border bg-secondary/10 p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-background/60">
                  <Icon className="h-3.5 w-3.5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {preset.name}
                    </span>
                    {preset.legacy && (
                      <span className="inline-flex items-center rounded-full border border-border px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
                        legacy
                      </span>
                    )}
                    {installed && (
                      <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-emerald-400">
                        installed
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    {preset.description}
                  </p>
                </div>
              </div>
              <button
                onClick={() =>
                  setActivePreset(isActive ? null : preset.id)
                }
                className={cn(
                  'inline-flex shrink-0 items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium',
                  isActive
                    ? 'bg-secondary text-secondary-foreground'
                    : 'bg-primary text-primary-foreground hover:opacity-90'
                )}
              >
                <Download className="h-3 w-3" />
                {isActive ? 'Cancel' : installed ? 'Install again' : 'Install'}
              </button>
            </div>

            {isActive && (
              <PresetForm
                preset={preset}
                onCancel={() => setActivePreset(null)}
                onInstall={async (values) => {
                  const id = `preset:${preset.id}:${nanoid(6)}`;
                  // Dynamically import the bundled factory from
                  // main process — but we can't, so we construct
                  // the config inline here. The main process
                  // persists whatever we send.
                  await saveServer(
                    buildPresetConfig(preset, id, values)
                  );
                  setActivePreset(null);
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ----- Inline form -----

interface PresetFormValues {
  allowedPath?: string;
  apiKey?: string;
}

function PresetForm({
  preset,
  onCancel,
  onInstall
}: {
  preset: MCPServerPreset;
  onCancel: () => void;
  onInstall: (values: PresetFormValues) => void | Promise<void>;
}) {
  const [path, setPath] = useState<string>('~');
  const [apiKey, setApiKey] = useState<string>('');
  const [installing, setInstalling] = useState(false);

  const handleInstall = async () => {
    setInstalling(true);
    try {
      await onInstall({
        allowedPath: preset.requiresPath ? path : undefined,
        apiKey: preset.requiresApiKey ? apiKey : undefined
      });
    } finally {
      setInstalling(false);
    }
  };

  const canSubmit =
    (!preset.requiresPath || path.trim().length > 0) &&
    (!preset.requiresApiKey || apiKey.trim().length > 0);

  return (
    <div className="mt-3 space-y-2 rounded-md border border-border bg-background/40 p-3">
      {preset.requiresPath && (
        <label className="block text-[11px]">
          <span className="text-muted-foreground">Allowed directory</span>
          <input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="~/Projects"
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
          />
          <span className="mt-0.5 block text-[10px] text-muted-foreground">
            Use <code>~</code> to expand to your home directory.
          </span>
        </label>
      )}
      {preset.requiresApiKey && (
        <label className="block text-[11px]">
          <span className="text-muted-foreground">
            {preset.requiresApiKey.label}
          </span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Paste secret"
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
          />
          <span className="mt-0.5 block text-[10px] text-muted-foreground">
            Stored in your local SQLite DB. Phase 9 migrates secrets
            to the OS keychain via keytar.
          </span>
        </label>
      )}
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded-md border border-border px-3 py-1 text-[11px]"
        >
          Cancel
        </button>
        <button
          onClick={() => void handleInstall()}
          disabled={!canSubmit || installing}
          className="rounded-md bg-primary px-3 py-1 text-[11px] font-medium text-primary-foreground disabled:opacity-60"
        >
          {installing ? 'Installing…' : 'Install'}
        </button>
      </div>
    </div>
  );
}

// ----- Inline preset factory (duplicate of main-process bundled.ts
//     behaviour so the renderer can build a complete MCPServerConfig
//     without an extra IPC round-trip). -----

function buildPresetConfig(
  preset: MCPServerPreset,
  id: string,
  values: PresetFormValues
): import('../../../../shared/types').MCPServerConfig {
  const expand = (p: string): string =>
    p.startsWith('~') ? p.replace(/^~/, '$HOME') : p;

  switch (preset.family) {
    case 'filesystem':
      return {
        id,
        name: `Filesystem (${values.allowedPath ?? '~'})`,
        enabled: true,
        source: 'bundled',
        transport: 'stdio',
        command: 'npx',
        args: [
          '-y',
          '@modelcontextprotocol/server-filesystem',
          expand(values.allowedPath ?? '~')
        ]
      };
    case 'memory':
      return {
        id,
        name: 'Memory',
        enabled: true,
        source: 'bundled',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-memory']
      };
    case 'github':
      return {
        id,
        name: 'GitHub',
        enabled: true,
        source: 'bundled',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: values.apiKey
          ? { GITHUB_PERSONAL_ACCESS_TOKEN: values.apiKey }
          : undefined
      };
    case 'brave-search':
      return {
        id,
        name: 'Brave Search',
        enabled: true,
        source: 'bundled',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-brave-search'],
        env: values.apiKey ? { BRAVE_API_KEY: values.apiKey } : undefined
      };
    default:
      return {
        id,
        name: preset.name,
        enabled: true,
        source: 'bundled',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', `@modelcontextprotocol/server-${preset.family}`]
      };
  }
}
