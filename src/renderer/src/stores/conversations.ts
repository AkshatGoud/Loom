import { create } from 'zustand';
import type {
  ChatStatusInfo,
  Conversation,
  ConversationCreateInput,
  Message,
  ProviderId
} from '../../../shared/types';

interface ConversationsState {
  conversations: Conversation[];
  activeId: string | null;
  messagesByConv: Record<string, Message[]>;
  /**
   * In-flight turn status, keyed by the assistant message id the
   * status belongs to. Populated by the streaming hook when the main
   * process emits `status` events, cleared when the turn completes.
   */
  messageStatus: Record<string, ChatStatusInfo>;
  loading: boolean;

  refresh: () => Promise<void>;
  selectConversation: (id: string) => Promise<void>;
  createConversation: (input: ConversationCreateInput) => Promise<Conversation>;
  updateConversation: (id: string, patch: Partial<Conversation>) => Promise<void>;
  /** Merge an updated Conversation (e.g. from an auto-rename broadcast) without round-tripping IPC. */
  mergeConversation: (conversation: Conversation) => void;
  removeConversation: (id: string) => Promise<void>;

  // Streaming helpers called by useStreamingChat
  upsertMessage: (message: Message) => void;
  appendDelta: (conversationId: string, messageId: string, delta: string) => void;
  setMessages: (conversationId: string, messages: Message[]) => void;
  setMessageStatus: (messageId: string, status: ChatStatusInfo | null) => void;
}

export const useConversations = create<ConversationsState>((set, get) => ({
  conversations: [],
  activeId: null,
  messagesByConv: {},
  messageStatus: {},
  loading: false,

  async refresh() {
    set({ loading: true });
    const conversations = await window.api.conversations.list();
    set({ conversations, loading: false });
    const { activeId } = get();
    if (activeId && !conversations.find((c) => c.id === activeId)) {
      set({ activeId: conversations[0]?.id ?? null });
    }
  },

  async selectConversation(id: string) {
    set({ activeId: id });
    const messages = await window.api.conversations.listMessages(id);
    set((state) => ({
      messagesByConv: { ...state.messagesByConv, [id]: messages }
    }));
  },

  async createConversation(input) {
    const conversation = await window.api.conversations.create(input);
    set((state) => ({
      conversations: [conversation, ...state.conversations],
      activeId: conversation.id,
      messagesByConv: { ...state.messagesByConv, [conversation.id]: [] }
    }));
    return conversation;
  },

  async updateConversation(id, patch) {
    const updated = await window.api.conversations.update(id, patch);
    if (!updated) return;
    set((state) => ({
      conversations: state.conversations.map((c) => (c.id === id ? updated : c))
    }));
  },

  mergeConversation(conversation) {
    set((state) => {
      const exists = state.conversations.some((c) => c.id === conversation.id);
      return {
        conversations: exists
          ? state.conversations.map((c) =>
              c.id === conversation.id ? conversation : c
            )
          : [conversation, ...state.conversations]
      };
    });
  },

  async removeConversation(id) {
    await window.api.conversations.remove(id);
    set((state) => {
      const conversations = state.conversations.filter((c) => c.id !== id);
      const { [id]: _removed, ...rest } = state.messagesByConv;
      return {
        conversations,
        messagesByConv: rest,
        activeId:
          state.activeId === id ? conversations[0]?.id ?? null : state.activeId
      };
    });
  },

  upsertMessage(message) {
    set((state) => {
      const existing = state.messagesByConv[message.conversationId] ?? [];
      const idx = existing.findIndex((m) => m.id === message.id);
      const next =
        idx >= 0
          ? existing.map((m) => (m.id === message.id ? message : m))
          : [...existing, message];
      return {
        messagesByConv: {
          ...state.messagesByConv,
          [message.conversationId]: next
        }
      };
    });
  },

  appendDelta(conversationId, messageId, delta) {
    set((state) => {
      const existing = state.messagesByConv[conversationId] ?? [];
      const next = existing.map((m) =>
        m.id === messageId ? { ...m, content: m.content + delta } : m
      );
      return {
        messagesByConv: { ...state.messagesByConv, [conversationId]: next }
      };
    });
  },

  setMessages(conversationId, messages) {
    set((state) => ({
      messagesByConv: { ...state.messagesByConv, [conversationId]: messages }
    }));
  },

  setMessageStatus(messageId, status) {
    set((state) => {
      if (status === null) {
        if (!(messageId in state.messageStatus)) return {};
        const { [messageId]: _removed, ...rest } = state.messageStatus;
        return { messageStatus: rest };
      }
      return {
        messageStatus: { ...state.messageStatus, [messageId]: status }
      };
    });
  }
}));

// A stable empty array reference — important for React 19 / Zustand so a
// selector that defaults to `[]` doesn't return a fresh array every render
// and trip the "getSnapshot should be cached" check.
const EMPTY_MESSAGES: Message[] = [];

export function useActiveConversation(): Conversation | null {
  return useConversations((s) => {
    if (!s.activeId) return null;
    return s.conversations.find((c) => c.id === s.activeId) ?? null;
  });
}

export function useActiveMessages(): Message[] {
  return useConversations((s) => {
    if (!s.activeId) return EMPTY_MESSAGES;
    return s.messagesByConv[s.activeId] ?? EMPTY_MESSAGES;
  });
}

export const DEFAULT_PROVIDER: ProviderId = 'ollama';
export const DEFAULT_MODEL = 'gemma4:e4b';
