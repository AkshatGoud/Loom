import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { createClient } from './client-factory';
import type {
  MCPCallToolResult,
  MCPServerConfig,
  MCPServerConnectionState,
  MCPServerState,
  MCPToolContent,
  MCPToolSummary
} from '../../shared/types';

/**
 * Internal wrapper around a Client + Transport pair that also tracks the
 * cached tool catalog and the lifecycle state. The registry holds one
 * of these per configured server.
 */
interface ConnectedClient {
  config: MCPServerConfig;
  client: Client | null;
  transport: Transport | null;
  state: MCPServerConnectionState;
  tools: MCPToolSummary[];
  lastError?: string;
}

// ----- Module state -----
//
// The registry is a singleton — there's only one MCP client registry
// per Loom process. Callers interact through the exported functions
// below. Keeping this module-local means we don't need DI plumbing for
// Phase 5, and the functions read cleanly in the IPC handlers (Phase 7).

const registry = new Map<string, ConnectedClient>();
const listeners = new Set<(state: MCPServerState[]) => void>();

function snapshot(): MCPServerState[] {
  return Array.from(registry.values()).map((c) => ({
    config: c.config,
    connection: c.state,
    lastError: c.lastError,
    tools: c.tools
  }));
}

function notify(): void {
  const s = snapshot();
  for (const l of listeners) l(s);
}

function setState(
  id: string,
  patch: Partial<Pick<ConnectedClient, 'state' | 'tools' | 'lastError'>>
): void {
  const entry = registry.get(id);
  if (!entry) return;
  Object.assign(entry, patch);
  notify();
}

// ----- Config registration -----

/**
 * Register (or update) an MCP server config in the registry. This does
 * NOT automatically connect — connection happens lazily on the first
 * `listTools` or `callTool` call, so registered-but-disabled servers
 * don't spawn subprocesses unnecessarily.
 *
 * If the server was already connected and the config changed, the
 * existing connection is torn down so the next access re-connects with
 * the new config.
 */
export async function registerServer(config: MCPServerConfig): Promise<void> {
  const existing = registry.get(config.id);
  if (existing && JSON.stringify(existing.config) !== JSON.stringify(config)) {
    await disconnectServer(config.id);
  }
  registry.set(config.id, {
    config,
    client: null,
    transport: null,
    state: 'idle',
    tools: []
  });
  notify();
}

// ----- Connection lifecycle -----

/**
 * Lazily connect to a server and populate its tool catalog. Idempotent:
 * if the server is already connected this is a no-op.
 *
 * Handles the stdio transport's `onclose` callback so that if the child
 * process dies (crash, OOM, user kill) we mark the entry as disconnected
 * and drop the Client — the next access will lazily reconnect.
 */
async function ensureConnected(id: string): Promise<ConnectedClient> {
  const entry = registry.get(id);
  if (!entry) throw new Error(`MCP server '${id}' is not registered`);
  if (entry.state === 'connected') return entry;
  if (!entry.config.enabled) {
    throw new Error(`MCP server '${id}' is disabled`);
  }

  setState(id, { state: 'connecting', lastError: undefined });

  try {
    const { client, transport } = createClient(entry.config);

    // Wire lifecycle hooks BEFORE connecting so nothing is lost.
    transport.onclose = () => {
      const existing = registry.get(id);
      if (!existing) return;
      existing.client = null;
      existing.transport = null;
      existing.tools = [];
      existing.state = 'disconnected';
      notify();
    };
    transport.onerror = (err: Error) => {
      const existing = registry.get(id);
      if (!existing) return;
      existing.lastError = err.message;
      existing.state = 'error';
      notify();
    };

    await client.connect(transport);

    // Populate the cached tool catalog.
    const tools = await fetchAllTools(client);

    entry.client = client;
    entry.transport = transport;
    entry.tools = tools;
    entry.state = 'connected';
    notify();
    return entry;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown MCP error';
    setState(id, { state: 'error', lastError: message });
    throw err;
  }
}

/**
 * Fully pagination-safe listTools. MCP's listTools returns a page plus
 * an opaque `nextCursor`; we loop until there are no more pages.
 */
async function fetchAllTools(client: Client): Promise<MCPToolSummary[]> {
  const out: MCPToolSummary[] = [];
  let cursor: string | undefined = undefined;
  // Cap pagination at 20 round-trips so a broken server can't hang us.
  for (let i = 0; i < 20; i++) {
    const page: { tools: unknown[]; nextCursor?: string } = await client.listTools(
      cursor ? { cursor } : undefined
    );
    for (const raw of page.tools) {
      const t = raw as {
        name: string;
        description?: string;
        inputSchema: Record<string, unknown>;
      };
      out.push({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema
      });
    }
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return out;
}

// ----- Public API -----

/** Return all registered servers with their current live state. */
export function listServers(): MCPServerState[] {
  return snapshot();
}

/** Return the cached tool catalog for a server, connecting if needed. */
export async function listToolsForServer(
  id: string
): Promise<MCPToolSummary[]> {
  const entry = await ensureConnected(id);
  return entry.tools;
}

/**
 * Call a tool on a server. Connects lazily on first use, recovers from
 * a dropped stdio child on subsequent calls. Returns a normalised
 * MCPCallToolResult so callers don't need to know about the SDK's
 * content block shape.
 */
export async function callTool(
  id: string,
  name: string,
  args: Record<string, unknown>
): Promise<MCPCallToolResult> {
  const entry = await ensureConnected(id);
  if (!entry.client) {
    throw new Error(`MCP server '${id}' has no active client`);
  }

  const started = Date.now();
  const raw = await entry.client.callTool({
    name,
    arguments: args
  });

  const content = Array.isArray(raw.content)
    ? (raw.content as MCPToolContent[])
    : [];
  return {
    content,
    isError: raw.isError === true,
    durationMs: Date.now() - started
  };
}

/** Tear down a single server's connection (if any). Idempotent. */
export async function disconnectServer(id: string): Promise<void> {
  const entry = registry.get(id);
  if (!entry || !entry.client) return;
  try {
    await entry.client.close();
  } catch {
    /* swallow — the connection is going away regardless */
  }
  entry.client = null;
  entry.transport = null;
  entry.tools = [];
  entry.state = 'disconnected';
  notify();
}

/** Close every active connection. Called from `app.on('before-quit')`. */
export async function disconnectAll(): Promise<void> {
  await Promise.all(
    Array.from(registry.keys()).map((id) => disconnectServer(id))
  );
}

/** Remove a server config entirely (in addition to disconnecting). */
export async function unregisterServer(id: string): Promise<void> {
  await disconnectServer(id);
  registry.delete(id);
  notify();
}

// ----- Subscription (used by Phase 7 IPC) -----

export function subscribeRegistry(
  handler: (state: MCPServerState[]) => void
): () => void {
  listeners.add(handler);
  // Emit initial snapshot so new subscribers see current state immediately.
  handler(snapshot());
  return () => {
    listeners.delete(handler);
  };
}
