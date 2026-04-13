import { BrowserWindow } from 'electron';
import { nanoid } from 'nanoid';
import { toolApprovalsDb, settingsDb } from '../db';
import type {
  MCPApprovalDecision,
  MCPApprovalRequest
} from '../../shared/types';

/**
 * Phase 7 approval subsystem.
 *
 * Every MCP tool call routes through here before the tool-loop
 * actually hits the MCP server. The flow is:
 *
 *   1. Check `tool_approvals` table for a persisted `(conversation,
 *      server, tool)` decision — if `always`, auto-allow; if `never`,
 *      auto-deny.
 *   2. Check the global `mcp.autoApproveAll` setting — if true, skip
 *      prompting entirely. Default is false.
 *   3. Otherwise, broadcast an `MCPApprovalRequest` to every window,
 *      store the pending promise in `pending`, and block until the
 *      renderer calls `resolve()` via IPC.
 *
 * The request/response pairing is by `approvalId` (nanoid) so
 * multiple approvals can be in flight at once without confusion. If
 * the chat turn is aborted while an approval is pending, the
 * promise rejects with a signal error so the tool-loop can bail
 * cleanly.
 */

interface PendingEntry {
  resolve: (decision: MCPApprovalDecision) => void;
  reject: (err: Error) => void;
}

const pending = new Map<string, PendingEntry>();

export interface ApprovalContext {
  conversationId: string;
  messageId: string;
  serverId: string;
  toolName: string;
  args: unknown;
  signal?: AbortSignal;
}

export type ApprovalOutcome =
  | { kind: 'allow'; source: 'policy' | 'user' | 'auto_all' }
  | { kind: 'deny'; source: 'policy' | 'user' };

function broadcast(request: MCPApprovalRequest): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('mcp:approvalRequest', request);
  }
}

export async function requestApproval(
  ctx: ApprovalContext
): Promise<ApprovalOutcome> {
  // Stage 1: persisted per-conversation policy wins.
  const persisted = toolApprovalsDb.get(
    ctx.conversationId,
    ctx.serverId,
    ctx.toolName
  );
  if (persisted === 'always') return { kind: 'allow', source: 'policy' };
  if (persisted === 'never') return { kind: 'deny', source: 'policy' };

  // Stage 2: global auto-approve escape hatch.
  const autoAll = settingsDb.get<boolean>('mcp.autoApproveAll') ?? false;
  if (autoAll === true) return { kind: 'allow', source: 'auto_all' };

  // Stage 3: ask the user.
  const approvalId = nanoid();
  const promise = new Promise<MCPApprovalDecision>((resolve, reject) => {
    pending.set(approvalId, { resolve, reject });
    if (ctx.signal) {
      const onAbort = () => {
        const entry = pending.get(approvalId);
        if (entry) {
          pending.delete(approvalId);
          entry.reject(new Error('Chat turn aborted while approval pending'));
        }
      };
      ctx.signal.addEventListener('abort', onAbort, { once: true });
    }
  });

  broadcast({
    id: approvalId,
    conversationId: ctx.conversationId,
    messageId: ctx.messageId,
    serverId: ctx.serverId,
    toolName: ctx.toolName,
    arguments: ctx.args,
    createdAt: Date.now()
  });

  const decision = await promise;

  if (decision === 'allow_always') {
    toolApprovalsDb.set(
      ctx.conversationId,
      ctx.serverId,
      ctx.toolName,
      'always'
    );
    return { kind: 'allow', source: 'user' };
  }
  if (decision === 'allow_once') return { kind: 'allow', source: 'user' };
  return { kind: 'deny', source: 'user' };
}

/** Called by the IPC handler when the renderer responds. */
export function resolveApproval(
  approvalId: string,
  decision: MCPApprovalDecision
): void {
  const entry = pending.get(approvalId);
  if (!entry) return;
  pending.delete(approvalId);
  entry.resolve(decision);
}

/** Called on app quit to unblock any still-pending approvals. */
export function rejectAllPending(): void {
  for (const entry of pending.values()) {
    entry.reject(new Error('App quitting'));
  }
  pending.clear();
}
