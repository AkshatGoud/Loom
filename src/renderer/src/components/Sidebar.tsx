import { useMemo, useState } from 'react';
import {
  MessageSquarePlus,
  Package,
  Search,
  Server,
  Settings,
  Trash2
} from 'lucide-react';
import {
  DEFAULT_MODEL,
  DEFAULT_PROVIDER,
  useConversations
} from '../stores/conversations';
import { useOllama } from '../stores/ollama';
import { cn, formatTimestamp } from '../lib/utils';

interface SidebarProps {
  onOpenSettings: () => void;
  onOpenLibrary: () => void;
  onOpenServers: () => void;
}

export function Sidebar({
  onOpenSettings,
  onOpenLibrary,
  onOpenServers
}: SidebarProps) {
  const conversations = useConversations((s) => s.conversations);
  const activeId = useConversations((s) => s.activeId);
  const selectConversation = useConversations((s) => s.selectConversation);
  const createConversation = useConversations((s) => s.createConversation);
  const removeConversation = useConversations((s) => s.removeConversation);
  const ollamaFirstModel = useOllama((s) => s.status.firstModel);

  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!query.trim()) return conversations;
    const q = query.toLowerCase();
    return conversations.filter((c) => c.title.toLowerCase().includes(q));
  }, [conversations, query]);

  const handleNew = async (): Promise<void> => {
    await createConversation({
      title: 'New conversation',
      systemPrompt: null,
      provider: DEFAULT_PROVIDER,
      // Prefer the user's actually-pulled first model; fall back to Gemma 4.
      modelId: ollamaFirstModel ?? DEFAULT_MODEL
    });
  };

  return (
    <aside className="flex h-full w-72 flex-col border-r border-border bg-card/30">
      <div
        className="titlebar-pad flex h-12 items-center justify-between pr-3"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <span className="text-sm font-semibold tracking-tight">Loom</span>
      </div>

      <div
        className="flex items-center gap-2 px-3 pb-2"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          onClick={handleNew}
          className="flex flex-1 items-center justify-center gap-2 rounded-md border border-border bg-secondary px-3 py-1.5 text-sm font-medium text-secondary-foreground transition hover:bg-secondary/80"
        >
          <MessageSquarePlus className="h-4 w-4" />
          New chat
        </button>
      </div>

      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="w-full rounded-md border border-border bg-background pl-7 pr-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-2">
        {filtered.length === 0 ? (
          <p className="px-2 py-4 text-xs text-muted-foreground">
            No conversations yet. Start a new chat to begin.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {filtered.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => selectConversation(c.id)}
                  className={cn(
                    'group flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition',
                    activeId === c.id
                      ? 'bg-accent text-accent-foreground'
                      : 'text-foreground/90 hover:bg-accent/50'
                  )}
                >
                  <span className="flex-1 truncate">{c.title}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {formatTimestamp(c.updatedAt)}
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label="Delete conversation"
                    onClick={(e) => {
                      e.stopPropagation();
                      void removeConversation(c.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.stopPropagation();
                        void removeConversation(c.id);
                      }
                    }}
                    className="hidden rounded p-0.5 text-muted-foreground transition hover:text-destructive group-hover:inline-flex"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </nav>

      <div className="border-t border-border p-2 space-y-0.5">
        <button
          onClick={onOpenLibrary}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
        >
          <Package className="h-4 w-4" />
          Models
        </button>
        <button
          onClick={onOpenServers}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
        >
          <Server className="h-4 w-4" />
          MCP Servers
        </button>
        <button
          onClick={onOpenSettings}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
        >
          <Settings className="h-4 w-4" />
          Settings
        </button>
      </div>
    </aside>
  );
}
