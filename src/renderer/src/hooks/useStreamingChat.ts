import { useEffect, useState } from 'react';
import { useConversations } from '../stores/conversations';
import type { ChatStreamEvent } from '../../../shared/types';

/**
 * Subscribes to the main process `chat:stream` channel and folds events into
 * the conversations store. Call once near the app root.
 *
 * Returns the id of the message currently streaming (if any), so the composer
 * can render a Stop button.
 */
export function useStreamingChat(): {
  streamingMessageId: string | null;
} {
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(
    null
  );

  useEffect(() => {
    const unsubscribe = window.api.chat.onStream((event: ChatStreamEvent) => {
      const store = useConversations.getState();

      if (event.type === 'delta' && event.messageId && event.delta) {
        store.appendDelta(event.conversationId, event.messageId, event.delta);
        setStreamingMessageId(event.messageId);
      } else if (event.type === 'status' && event.messageId) {
        store.setMessageStatus(event.messageId, event.status ?? null);
      } else if (event.type === 'conversation_updated' && event.conversation) {
        store.mergeConversation(event.conversation);
      } else if (event.type === 'done') {
        setStreamingMessageId(null);
        if (event.messageId) {
          store.setMessageStatus(event.messageId, null);
        }
        // Refresh the message from the server to pick up usage stats.
        if (event.messageId) {
          void (async () => {
            const msgs = await window.api.conversations.listMessages(
              event.conversationId
            );
            useConversations.getState().setMessages(event.conversationId, msgs);
          })();
        }
      } else if (event.type === 'error') {
        setStreamingMessageId(null);
        if (event.messageId) {
          store.setMessageStatus(event.messageId, null);
        }
        // Re-fetch to capture whatever partial content was persisted.
        void (async () => {
          const msgs = await window.api.conversations.listMessages(
            event.conversationId
          );
          useConversations.getState().setMessages(event.conversationId, msgs);
        })();
      }
    });

    return unsubscribe;
  }, []);

  return { streamingMessageId };
}
