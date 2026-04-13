import { ipcMain, BrowserWindow } from 'electron';
import { nanoid } from 'nanoid';
import {
  mcpServersDb,
  conversationServersDb
} from '../db';
import {
  listServers,
  registerServer,
  unregisterServer,
  subscribeRegistry,
  listToolsForServer
} from '../mcp/registry';
import { resolveApproval } from '../mcp/approval';
import { listPresetMetadata } from '../mcp/bundled';
import type {
  MCPApprovalDecision,
  MCPServerConfig,
  MCPServerState
} from '../../shared/types';

/**
 * Phase 7 IPC surface for MCP server management and approvals.
 *
 * Splits cleanly from ipc/index.ts because it has a lot of
 * handlers and one subscription (registry updates) that needs its
 * own broadcast path. Called once from ipc/index.ts at startup.
 */

function broadcastServers(): void {
  const servers = listServers();
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('mcp:serversChanged', servers);
  }
}

export function registerMcpIpcHandlers(): void {
  // ----- Queries -----

  ipcMain.handle('mcp:listServers', async (): Promise<MCPServerState[]> => {
    return listServers();
  });

  ipcMain.handle('mcp:listPresets', () => listPresetMetadata());

  // ----- Mutations -----

  ipcMain.handle(
    'mcp:saveServer',
    async (_e, config: MCPServerConfig): Promise<MCPServerState> => {
      // Persist first, then sync the live registry.
      mcpServersDb.upsert(config);
      await registerServer(config);

      // Kick a `listTools` so the renderer sees the fresh tool
      // catalog in the next snapshot. Ignore errors — the server
      // still shows up in the list even if it can't spawn.
      try {
        await listToolsForServer(config.id);
      } catch {
        /* registry marks it as 'error'; state broadcast reflects that */
      }

      broadcastServers();
      const servers = listServers();
      const state = servers.find((s) => s.config.id === config.id);
      if (!state) {
        throw new Error(`Server ${config.id} missing from registry after save`);
      }
      return state;
    }
  );

  ipcMain.handle('mcp:removeServer', async (_e, id: string) => {
    mcpServersDb.remove(id);
    await unregisterServer(id);
    broadcastServers();
  });

  // ----- Per-conversation attachment -----

  ipcMain.handle(
    'mcp:getAttachments',
    (_e, conversationId: string): string[] => {
      return conversationServersDb.list(conversationId);
    }
  );

  ipcMain.handle(
    'mcp:setAttachments',
    (_e, conversationId: string, serverIds: string[]) => {
      conversationServersDb.setAll(conversationId, serverIds);
    }
  );

  // ----- Approval round-trip -----

  ipcMain.handle(
    'mcp:resolveApproval',
    (_e, approvalId: string, decision: MCPApprovalDecision) => {
      resolveApproval(approvalId, decision);
    }
  );

  // ----- Registry subscription → broadcast to all windows -----

  subscribeRegistry(() => {
    broadcastServers();
  });
}

/**
 * Load every persisted server from the DB and register each with
 * the live MCP registry. Called once at app boot from main/index.ts
 * after the database is initialised.
 *
 * Connections are lazy — registering does not spawn the child
 * process. It only runs when the user actually sends a chat that
 * needs the server.
 */
export async function loadPersistedMcpServers(): Promise<void> {
  const configs = mcpServersDb.list();
  for (const config of configs) {
    try {
      await registerServer(config);
    } catch (err) {
      console.warn(
        `[mcp] failed to register persisted server ${config.id}:`,
        err instanceof Error ? err.message : err
      );
    }
  }
}

/** Exported for tests / other callers that need a fresh server id. */
export function newServerId(): string {
  return nanoid();
}
