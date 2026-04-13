import { useState } from 'react';
import { ChevronDown, ChevronRight, Terminal, AlertCircle } from 'lucide-react';
import type { Message, ToolCall } from '../../../../shared/types';
import { cn } from '../../lib/utils';

/**
 * Renders an assistant message that triggered one or more tool
 * calls, OR a tool-result message, as a collapsible card showing
 * the tool name, server name, pretty-printed arguments, and result.
 *
 * Two entry points:
 *   - `AssistantToolCallsBadge` for an assistant message with
 *     toolCalls[] (called mid-turn, potentially still awaiting
 *     execution)
 *   - `ToolResultBadge` for a role='tool' message that carries the
 *     result of a prior tool_call
 *
 * Both are compact by default and click-to-expand for full JSON.
 */

export function AssistantToolCallsBadge({
  toolCalls
}: {
  toolCalls: ToolCall[];
}) {
  return (
    <div className="space-y-1.5">
      {toolCalls.map((tc) => (
        <ToolCallCard key={tc.id} call={tc} />
      ))}
    </div>
  );
}

function ToolCallCard({ call }: { call: ToolCall }) {
  const [expanded, setExpanded] = useState(false);
  const short = call.serverId
    ? `${call.serverId.split(':').pop() ?? call.serverId}: ${shortName(call.name)}`
    : shortName(call.name);

  return (
    <div className="rounded-md border border-border bg-secondary/20 text-[11px]">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-accent/40"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        )}
        <Terminal className="h-3 w-3 text-primary" />
        <span className="font-medium text-foreground">Tool call</span>
        <code className="truncate text-muted-foreground">{short}</code>
      </button>
      {expanded && (
        <div className="border-t border-border px-2.5 py-2 text-[10px]">
          <div className="mb-1 font-medium text-muted-foreground">Arguments</div>
          <pre className="max-h-64 overflow-auto rounded bg-background/60 p-2 font-mono text-[10px]">
            {formatJson(call.arguments)}
          </pre>
        </div>
      )}
    </div>
  );
}

export function ToolResultBadge({ message }: { message: Message }) {
  const [expanded, setExpanded] = useState(false);

  // Inspect result for an "isError" hint — we persist the flattened
  // text, not the structured MCPToolContent, so we heuristically
  // detect errors by looking for obvious markers.
  const looksLikeError =
    message.content.startsWith('Error') ||
    message.content.includes('denied permission');

  return (
    <div
      className={cn(
        'rounded-md border text-[11px]',
        looksLikeError
          ? 'border-destructive/40 bg-destructive/5'
          : 'border-border bg-secondary/20'
      )}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-accent/40"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        )}
        {looksLikeError ? (
          <AlertCircle className="h-3 w-3 text-destructive" />
        ) : (
          <Terminal className="h-3 w-3 text-emerald-400" />
        )}
        <span className="font-medium">Tool result</span>
        <code className="truncate text-muted-foreground">
          {oneLinePreview(message.content)}
        </code>
      </button>
      {expanded && (
        <div className="border-t border-border px-2.5 py-2">
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[10px] leading-snug text-foreground">
            {message.content || '(empty)'}
          </pre>
        </div>
      )}
    </div>
  );
}

function shortName(name: string): string {
  // sanitised names look like "smoke_filesystem__list_directory" —
  // strip anything before the last "__" for a cleaner display.
  const idx = name.lastIndexOf('__');
  return idx >= 0 ? name.slice(idx + 2) : name;
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function oneLinePreview(text: string): string {
  const first = text.split('\n', 1)[0] ?? '';
  return first.length > 80 ? `${first.slice(0, 77)}…` : first || '(empty)';
}
