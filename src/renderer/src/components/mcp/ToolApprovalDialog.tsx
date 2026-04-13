import { Check, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import { useMcp } from '../../stores/mcp';
import type {
  MCPApprovalDecision,
  MCPApprovalRequest
} from '../../../../shared/types';

interface ToolApprovalDialogProps {
  request: MCPApprovalRequest;
}

/**
 * Inline approval card rendered in the chat stream when an MCP tool
 * call is pending user consent. Three actions:
 *
 *   - Allow once: run this single call, leave the policy unchanged
 *   - Allow for this chat: write an 'always' row to tool_approvals
 *     so the same (conversation, server, tool) never asks again
 *   - Deny: return a clean "denied" string to the model, which can
 *     then reason about it and try a different approach
 *
 * The main-process tool loop is blocked on a promise tied to
 * `request.id`; clicking any button calls
 * `window.api.mcp.resolveApproval` which unblocks the promise
 * inside src/main/mcp/approval.ts.
 */
export function ToolApprovalDialog({ request }: ToolApprovalDialogProps) {
  const resolveApproval = useMcp((s) => s.resolveApproval);

  const handleDecision = (decision: MCPApprovalDecision) => {
    void resolveApproval(request.id, decision);
  };

  const serverShort =
    request.serverId.split(':').pop() ?? request.serverId;

  return (
    <div className="mx-6 mb-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
      <div className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-amber-300">
            Tool call awaiting approval
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            The model wants to call{' '}
            <code className="text-foreground">{request.toolName}</code> on{' '}
            <code className="text-foreground">{serverShort}</code>.
          </div>

          <details className="mt-2">
            <summary className="cursor-pointer text-[10px] text-muted-foreground hover:text-foreground">
              Arguments
            </summary>
            <pre className="mt-1 max-h-48 overflow-auto rounded bg-background/60 p-2 font-mono text-[10px]">
              {formatJson(request.arguments)}
            </pre>
          </details>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        <button
          onClick={() => handleDecision('deny')}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[11px] hover:bg-destructive/10 hover:text-destructive"
        >
          <X className="h-3 w-3" />
          Deny
        </button>
        <button
          onClick={() => handleDecision('allow_once')}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[11px] hover:bg-accent"
        >
          <Check className="h-3 w-3" />
          Allow once
        </button>
        <button
          onClick={() => handleDecision('allow_always')}
          className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:opacity-90"
        >
          <ShieldCheck className="h-3 w-3" />
          Allow for this chat
        </button>
      </div>
    </div>
  );
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
