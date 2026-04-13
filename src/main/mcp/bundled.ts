import { homedir } from 'node:os';
import type { MCPServerConfig, MCPServerPreset } from '../../shared/types';

/**
 * Catalog of Phase 7 bundled MCP server presets.
 *
 * Each preset exposes two things:
 *   - A renderer-visible `MCPServerPreset` with description, family,
 *     and any extra fields the Server Library UI needs to collect
 *     (e.g. an allowed directory path for filesystem, an API key env
 *     var for brave-search).
 *   - A `build(options)` factory that produces a concrete
 *     `MCPServerConfig` ready to persist via `mcpServersDb.upsert`.
 *
 * Every preset is a stdio server spawned via `npx -y <package>`,
 * which requires no extra installation on any machine that has Node
 * on PATH. The HTTP transport path lives in Phase 8's BYO flow.
 */

export interface PresetInstallOptions {
  id: string;
  /** Directory allowed for filesystem preset. */
  allowedPath?: string;
  /** Bearer/API key for presets that need one (Brave, GitHub). */
  apiKey?: string;
}

export interface PresetEntry {
  meta: MCPServerPreset;
  build: (options: PresetInstallOptions) => MCPServerConfig;
}

export const BUNDLED_PRESETS: PresetEntry[] = [
  {
    meta: {
      id: 'filesystem',
      name: 'Filesystem',
      description:
        'Read and write files in a directory you choose. The most-requested MCP tool — essential for local-agent workflows.',
      family: 'filesystem',
      requiresPath: true
    },
    build: ({ id, allowedPath }) => ({
      id,
      name: 'Filesystem',
      enabled: true,
      source: 'bundled',
      transport: 'stdio',
      command: 'npx',
      args: [
        '-y',
        '@modelcontextprotocol/server-filesystem',
        allowedPath || homedir()
      ]
    })
  },
  {
    meta: {
      id: 'memory',
      name: 'Memory',
      description:
        'Persistent knowledge graph that survives across conversations. Tell the model facts once and it remembers them next time.',
      family: 'memory'
    },
    build: ({ id }) => ({
      id,
      name: 'Memory',
      enabled: true,
      source: 'bundled',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory']
    })
  },
  {
    meta: {
      id: 'github',
      name: 'GitHub (legacy)',
      description:
        'Repo search, issue/PR browsing, commit history. The npm package is deprecated upstream but still functional; use the Go-based github-mcp-server via BYO for new setups (Phase 8).',
      family: 'github',
      legacy: true,
      requiresApiKey: {
        envVar: 'GITHUB_PERSONAL_ACCESS_TOKEN',
        label: 'GitHub Personal Access Token'
      }
    },
    build: ({ id, apiKey }) => ({
      id,
      name: 'GitHub',
      enabled: true,
      source: 'bundled',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: apiKey
        ? { GITHUB_PERSONAL_ACCESS_TOKEN: apiKey }
        : undefined
    })
  },
  {
    meta: {
      id: 'brave-search',
      name: 'Brave Search (legacy)',
      description:
        'Web search powered by Brave. The npm package is deprecated upstream; included as a working starting point until you swap to a modern search MCP via BYO.',
      family: 'brave-search',
      legacy: true,
      requiresApiKey: {
        envVar: 'BRAVE_API_KEY',
        label: 'Brave Search API Key'
      }
    },
    build: ({ id, apiKey }) => ({
      id,
      name: 'Brave Search',
      enabled: true,
      source: 'bundled',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-brave-search'],
      env: apiKey ? { BRAVE_API_KEY: apiKey } : undefined
    })
  }
];

export function listPresetMetadata(): MCPServerPreset[] {
  return BUNDLED_PRESETS.map((p) => p.meta);
}

export function findPreset(presetId: string): PresetEntry | undefined {
  return BUNDLED_PRESETS.find((p) => p.meta.id === presetId);
}
