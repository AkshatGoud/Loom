import { create } from 'zustand';
import type {
  MCPApprovalDecision,
  MCPApprovalRequest,
  MCPServerConfig,
  MCPServerPreset,
  MCPServerState
} from '../../../shared/types';

/**
 * Phase 7 MCP store. Tracks the registry-side server list, the
 * curated bundled preset catalog, and any in-flight tool-call
 * approval requests. Subscribes once to the main process push
 * channels so the UI reflects state without having to poll.
 */

interface McpState {
  servers: MCPServerState[];
  presets: MCPServerPreset[];
  /** Active approval requests waiting on user input, keyed by id. */
  pendingApprovals: Record<string, MCPApprovalRequest>;
  initialised: boolean;

  init: () => Promise<void>;
  refreshServers: () => Promise<void>;
  saveServer: (config: MCPServerConfig) => Promise<void>;
  removeServer: (id: string) => Promise<void>;
  resolveApproval: (
    approvalId: string,
    decision: MCPApprovalDecision
  ) => Promise<void>;
}

// Module-local subscription handles serve as init guards: if either
// is non-null, the store has already wired its IPC listeners and we
// skip re-subscribing on subsequent init() calls (e.g. React 19
// strict-mode double-mounts).
let unsubscribeServers: (() => void) | null = null;
let unsubscribeApprovals: (() => void) | null = null;

export const useMcp = create<McpState>((set, get) => ({
  servers: [],
  presets: [],
  pendingApprovals: {},
  initialised: false,

  async init() {
    if (unsubscribeServers || unsubscribeApprovals) return;
    if (get().initialised) return;
    const [servers, presets] = await Promise.all([
      window.api.mcp.listServers(),
      window.api.mcp.listPresets()
    ]);
    set({ servers, presets, initialised: true });

    unsubscribeServers = window.api.mcp.onServersChanged((next) => {
      set({ servers: next });
    });
    unsubscribeApprovals = window.api.mcp.onApprovalRequest((request) => {
      set((state) => ({
        pendingApprovals: {
          ...state.pendingApprovals,
          [request.id]: request
        }
      }));
    });
  },

  async refreshServers() {
    const servers = await window.api.mcp.listServers();
    set({ servers });
  },

  async saveServer(config) {
    await window.api.mcp.saveServer(config);
    await get().refreshServers();
  },

  async removeServer(id) {
    await window.api.mcp.removeServer(id);
    await get().refreshServers();
  },

  async resolveApproval(approvalId, decision) {
    await window.api.mcp.resolveApproval(approvalId, decision);
    set((state) => {
      const { [approvalId]: _removed, ...rest } = state.pendingApprovals;
      return { pendingApprovals: rest };
    });
  }
}));

// Hook-style selectors --------------------------------------------------

export function usePendingApprovalsForMessage(
  messageId: string | null
): MCPApprovalRequest[] {
  return useMcp((s) => {
    if (!messageId) return EMPTY_APPROVALS;
    return Object.values(s.pendingApprovals).filter(
      (r) => r.messageId === messageId
    );
  });
}

const EMPTY_APPROVALS: MCPApprovalRequest[] = [];
