import { useEffect, useRef, useState } from 'react';
import { Loader2, PowerOff } from 'lucide-react';
import { Composer } from './Composer';
import { Message } from './Message';
import { ModelPicker } from './ModelPicker';
import {
  useActiveConversation,
  useActiveMessages,
  useConversations
} from '../stores/conversations';
import { useSettings } from '../stores/settings';
import { useOllama } from '../stores/ollama';

interface ChatViewProps {
  streamingMessageId: string | null;
  onOpenLibrary: () => void;
}

export function ChatView({
  streamingMessageId,
  onOpenLibrary
}: ChatViewProps) {
  const conversation = useActiveConversation();
  const messages = useActiveMessages();
  const hasOpenAiKey = useSettings((s) => s.hasOpenAiKey);
  const ollamaStatus = useOllama((s) => s.status);
  const unloadModel = useOllama((s) => s.unloadModel);
  const updateConversation = useConversations((s) => s.updateConversation);
  const upsertMessage = useConversations((s) => s.upsertMessage);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [unloading, setUnloading] = useState(false);
  const [switchToast, setSwitchToast] = useState<{
    target: string;
    unloadedPrevious: string | null;
  } | null>(null);

  // Composer is enabled if the current conversation's provider is reachable.
  const providerReady = conversation
    ? conversation.provider === 'ollama'
      ? ollamaStatus.state === 'running'
      : conversation.provider === 'openai'
        ? hasOpenAiKey
        : false
    : false;

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth'
    });
  }, [messages.length, streamingMessageId]);

  // Auto-dismiss the "switched model" toast after 6 seconds.
  useEffect(() => {
    if (!switchToast) return;
    const t = setTimeout(() => setSwitchToast(null), 6000);
    return () => clearTimeout(t);
  }, [switchToast]);

  const handleModelSwitch = async (newModelId: string): Promise<void> => {
    if (!conversation || newModelId === conversation.modelId) return;
    await updateConversation(conversation.id, { modelId: newModelId });
    setSwitchToast({ target: newModelId, unloadedPrevious: null });
  };

  /**
   * Switch to a new model AND unload the previous one from Ollama memory
   * in parallel. Used when the user wants to reclaim RAM as part of the
   * switch (common on 16 GB Macs with big models).
   */
  const handleModelSwitchAndUnload = async (
    newModelId: string
  ): Promise<void> => {
    if (!conversation || newModelId === conversation.modelId) return;
    const previous = conversation.modelId;
    await Promise.all([
      updateConversation(conversation.id, { modelId: newModelId }),
      unloadModel(previous)
    ]);
    setSwitchToast({ target: newModelId, unloadedPrevious: previous });
  };

  const handleSend = async (content: string): Promise<void> => {
    if (!conversation) return;
    // Optimistic insert: give the user instant feedback while the main process
    // creates the real rows in SQLite. The streaming hook will reconcile.
    const optimisticId = `opt-${Date.now()}`;
    upsertMessage({
      id: optimisticId,
      conversationId: conversation.id,
      role: 'user',
      content,
      tokensPrompt: null,
      tokensCompletion: null,
      createdAt: Date.now()
    });

    await window.api.chat.send({
      conversationId: conversation.id,
      content
    });

    // Pull canonical state so optimistic id is replaced by real id.
    const serverMessages = await window.api.conversations.listMessages(
      conversation.id
    );
    useConversations.getState().setMessages(conversation.id, serverMessages);
  };

  const handleStop = (): void => {
    if (!conversation) return;
    void window.api.chat.abort(conversation.id);
  };

  if (!conversation) {
    return (
      <div className="flex h-full flex-1 items-center justify-center">
        <div className="max-w-md text-center">
          <h2 className="text-lg font-semibold">No conversation selected</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Create a new chat from the sidebar to get started.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <ChatHeader
        title={conversation.title}
        provider={conversation.provider}
        modelId={conversation.modelId}
        isOllama={conversation.provider === 'ollama'}
        loadedInRam={ollamaStatus.loadedModels.some(
          (m) => m.name === conversation.modelId
        )}
        unloading={unloading}
        streaming={streamingMessageId != null}
        onUnload={async () => {
          setUnloading(true);
          try {
            await unloadModel(conversation.modelId);
          } finally {
            setUnloading(false);
          }
        }}
        onSwitchModel={handleModelSwitch}
        onSwitchModelAndUnload={handleModelSwitchAndUnload}
        onOpenLibrary={onOpenLibrary}
      />

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">
              Say hello to {conversation.modelId}.
            </p>
          </div>
        ) : (
          messages.map((m) => (
            <Message
              key={m.id}
              message={m}
              isStreaming={m.id === streamingMessageId}
            />
          ))
        )}
      </div>

      {switchToast && (
        <div className="border-t border-primary/20 bg-primary/5 px-6 py-2 text-xs text-primary">
          Switched to <code className="font-semibold">{switchToast.target}</code>.{' '}
          {switchToast.unloadedPrevious ? (
            <>
              Unloaded{' '}
              <code className="font-semibold">
                {switchToast.unloadedPrevious}
              </code>{' '}
              from RAM. Next response will cold-load{' '}
              <code className="font-semibold">{switchToast.target}</code>.
            </>
          ) : (
            <>
              Next response may take a moment while the new model processes
              the conversation history.
            </>
          )}
        </div>
      )}

      <Composer
        disabled={!providerReady}
        streaming={streamingMessageId != null}
        onSend={(content) => {
          void handleSend(content);
        }}
        onStop={handleStop}
      />
    </div>
  );
}

// ----- Header subcomponent -----

interface ChatHeaderProps {
  title: string;
  provider: string;
  modelId: string;
  isOllama: boolean;
  loadedInRam: boolean;
  unloading: boolean;
  streaming: boolean;
  onUnload: () => void;
  onSwitchModel: (modelId: string) => void;
  onSwitchModelAndUnload: (modelId: string) => void;
  onOpenLibrary: () => void;
}

function ChatHeader({
  title,
  provider,
  modelId,
  isOllama,
  loadedInRam,
  unloading,
  streaming,
  onUnload,
  onSwitchModel,
  onSwitchModelAndUnload,
  onOpenLibrary
}: ChatHeaderProps) {
  return (
    <header
      className="titlebar-pad flex h-12 items-center justify-between gap-3 border-b border-border bg-card/40 pr-3"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div className="min-w-0 flex-1 truncate text-sm font-medium">{title}</div>

      <div
        className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {isOllama && loadedInRam && (
          <span
            title="This model is currently resident in Ollama's RAM"
            className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary"
          >
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
            loaded
          </span>
        )}
        <ModelPicker
          currentModel={modelId}
          provider={provider}
          onSelect={onSwitchModel}
          onSelectAndUnload={onSwitchModelAndUnload}
          onOpenLibrary={onOpenLibrary}
        />
        {isOllama && loadedInRam && (
          <button
            onClick={onUnload}
            disabled={unloading || streaming}
            title={
              streaming
                ? 'Cannot unload while streaming'
                : 'Unload this model from Ollama to free RAM'
            }
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            {unloading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <PowerOff className="h-3 w-3" />
            )}
            {unloading ? 'Unloading…' : 'Unload'}
          </button>
        )}
      </div>
    </header>
  );
}
