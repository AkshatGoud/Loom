import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Wrench } from 'lucide-react';
import { useMcp } from '../../stores/mcp';
import { cn } from '../../lib/utils';

interface ConversationToolsProps {
  conversationId: string;
  /** "ollama" / "openai" / etc. — non-Ollama providers can still attach tools too. */
  provider: string;
  onOpenLibrary: () => void;
}

/**
 * Per-conversation MCP server attachment popover. Lives in the chat
 * header next to ModelPicker. Lists every installed MCP server with
 * a checkbox; saving the selection writes to the
 * `conversation_servers` table via mcp:setAttachments and the next
 * chat:send picks it up via collectActiveTools().
 */
export function ConversationTools({
  conversationId,
  provider,
  onOpenLibrary
}: ConversationToolsProps) {
  const init = useMcp((s) => s.init);
  const servers = useMcp((s) => s.servers);

  const [open, setOpen] = useState(false);
  const [attachedIds, setAttachedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Make sure the store is initialised so we have the server list.
  useEffect(() => {
    void init();
  }, [init]);

  // When the popover opens, load the current attachment set.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void window.api.mcp.getAttachments(conversationId).then((ids) => {
      if (cancelled) return;
      setAttachedIds(new Set(ids));
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, conversationId]);

  // Close on outside click / escape.
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        !triggerRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', handleClick);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('mousedown', handleClick);
      window.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const toggleServer = async (serverId: string) => {
    const next = new Set(attachedIds);
    if (next.has(serverId)) {
      next.delete(serverId);
    } else {
      next.add(serverId);
    }
    setAttachedIds(next);
    setSaving(true);
    try {
      await window.api.mcp.setAttachments(conversationId, Array.from(next));
    } finally {
      setSaving(false);
    }
  };

  // Provider-agnostic: we still show the toggle even on cloud
  // providers since they can use tools too.
  void provider;

  const attachedCount = attachedIds.size;
  const triggerLabel =
    attachedCount === 0
      ? 'No tools'
      : attachedCount === 1
        ? '1 tool server'
        : `${attachedCount} tool servers`;

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        title="Manage MCP tool servers attached to this conversation"
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs transition hover:bg-accent',
          attachedCount > 0 && 'border-primary/40 bg-primary/5 text-primary'
        )}
      >
        <Wrench className="h-3 w-3" />
        <span>{triggerLabel}</span>
        <ChevronDown
          className={cn(
            'h-3 w-3 transition-transform',
            open && 'rotate-180'
          )}
        />
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="absolute right-0 top-[calc(100%+4px)] z-30 w-80 overflow-hidden rounded-lg border border-border bg-card shadow-xl"
        >
          <div className="border-b border-border px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              MCP servers for this chat
            </div>
            <div className="mt-0.5 text-[10px] text-muted-foreground">
              Tick a server to expose its tools to the model. Tool
              calls still require approval before execution.
            </div>
          </div>

          <div className="max-h-[300px] overflow-y-auto py-1">
            {loading && (
              <div className="px-3 py-3 text-xs text-muted-foreground">
                Loading…
              </div>
            )}
            {!loading && servers.length === 0 && (
              <div className="px-3 py-3 text-xs text-muted-foreground">
                No MCP servers installed. Open the Server Library to
                install one.
              </div>
            )}
            {!loading &&
              servers.map((s) => {
                const checked = attachedIds.has(s.config.id);
                return (
                  <button
                    key={s.config.id}
                    onClick={() => void toggleServer(s.config.id)}
                    className="flex w-full items-start gap-2 px-3 py-2 text-left text-xs transition hover:bg-accent"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      readOnly
                      className="mt-0.5 h-3 w-3 shrink-0 accent-primary"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">
                        {s.config.name}
                      </div>
                      <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                        {s.tools.length} tools · {s.connection}
                      </div>
                    </div>
                  </button>
                );
              })}
          </div>

          <div className="border-t border-border">
            <button
              onClick={() => {
                setOpen(false);
                onOpenLibrary();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground"
            >
              <Wrench className="h-3 w-3" />
              Manage MCP servers…
              {saving && (
                <span className="ml-auto text-[10px]">saving…</span>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
