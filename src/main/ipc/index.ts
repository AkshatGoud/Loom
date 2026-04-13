import { ipcMain, BrowserWindow, app } from 'electron';
import { conversationsDb, messagesDb, settingsDb } from '../db';
import { getProvider } from '../inference/provider';
import type { ProviderChatMessage } from '../inference/provider';
import {
  getOllamaStatus,
  subscribeOllamaStatus,
  tryStartOllama,
  unloadOllamaModel,
  unloadAllOllamaModels
} from '../ollama/daemon';
import {
  listInstalledModels,
  showModel,
  deleteModel,
  pullModel,
  cancelPull
} from '../ollama/models';
import { CURATED_MODELS } from '../ollama/curated';
import type {
  ChatSendInput,
  ChatStreamEvent,
  Conversation,
  Message,
  OllamaStatus,
  ProviderId
} from '../../shared/types';

// One AbortController per in-flight chat request, keyed by conversationId.
// The stop button in the composer calls `chat:abort` which signals the
// matching controller; the provider adapter respects req.signal.
const inflight = new Map<string, AbortController>();

function send(event: ChatStreamEvent): void {
  const win = BrowserWindow.getAllWindows()[0];
  win?.webContents.send('chat:stream', event);
}

function broadcastOllamaStatus(status: OllamaStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('ollama:status', status);
  }
}

export function registerIpcHandlers(): void {
  // ----- App metadata -----
  ipcMain.handle('app:getVersion', () => app.getVersion());

  // ----- Settings -----
  ipcMain.handle('settings:get', (_e, key: string) => settingsDb.get(key));
  ipcMain.handle('settings:set', (_e, key: string, value: unknown) => {
    settingsDb.set(key, value);
  });
  ipcMain.handle('settings:hasOpenAiKey', () => {
    const key = settingsDb.get<string>('openai.apiKey');
    return typeof key === 'string' && key.length > 0;
  });

  // ----- Provider catalog -----
  ipcMain.handle('providers:listModels', async (_e, providerId: ProviderId) => {
    return getProvider(providerId).listModels();
  });

  // ----- Ollama daemon -----
  ipcMain.handle('ollama:getStatus', () => getOllamaStatus());
  ipcMain.handle('ollama:tryStart', () => tryStartOllama());
  ipcMain.handle('ollama:unloadModel', (_e, model: string) =>
    unloadOllamaModel(model)
  );
  ipcMain.handle('ollama:unloadAll', () => unloadAllOllamaModels());
  subscribeOllamaStatus(broadcastOllamaStatus);

  // ----- Ollama model management (Phase 4) -----
  ipcMain.handle('models:listInstalled', () => listInstalledModels());
  ipcMain.handle('models:listCurated', () => CURATED_MODELS);
  ipcMain.handle('models:pull', (_e, name: string) => pullModel(name));
  ipcMain.handle('models:cancelPull', (_e, name: string) => cancelPull(name));
  ipcMain.handle('models:delete', (_e, name: string) => deleteModel(name));
  ipcMain.handle('models:show', (_e, name: string) => showModel(name));

  // ----- Conversations -----
  ipcMain.handle('conversations:list', (): Conversation[] => conversationsDb.list());
  ipcMain.handle('conversations:get', (_e, id: string) => conversationsDb.get(id));
  ipcMain.handle(
    'conversations:create',
    (
      _e,
      input: {
        title: string;
        systemPrompt: string | null;
        provider: ProviderId;
        modelId: string;
      }
    ) => conversationsDb.create(input)
  );
  ipcMain.handle(
    'conversations:update',
    (_e, id: string, patch: Partial<Conversation>) => {
      conversationsDb.update(id, patch);
      return conversationsDb.get(id);
    }
  );
  ipcMain.handle('conversations:remove', (_e, id: string) => {
    conversationsDb.remove(id);
  });
  ipcMain.handle('conversations:listMessages', (_e, id: string): Message[] =>
    messagesDb.listForConversation(id)
  );

  // ----- Chat -----
  ipcMain.handle('chat:send', async (_e, input: ChatSendInput) => {
    const conversation = conversationsDb.get(input.conversationId);
    if (!conversation) throw new Error('Conversation not found');

    // 1. Persist the user's message.
    const userMsg = messagesDb.insert({
      conversationId: conversation.id,
      role: 'user',
      content: input.content
    });

    // 2. Seed an empty assistant placeholder so the renderer has an id to
    //    attach streaming deltas to. The tool-call loop (Phase 7) will later
    //    append tool_call entries to this same message id.
    const assistantMsg = messagesDb.insert({
      conversationId: conversation.id,
      role: 'assistant',
      content: ''
    });

    send({ type: 'delta', conversationId: conversation.id, messageId: userMsg.id, delta: '' });

    // 3. Build the provider prompt from the full persisted history so context
    //    survives app restarts automatically.
    const history = messagesDb
      .listForConversation(conversation.id)
      .filter((m) => m.id !== assistantMsg.id)
      .map<ProviderChatMessage>((m) => {
        if (m.role === 'user' || m.role === 'system') {
          return { role: m.role, content: m.content };
        }
        if (m.role === 'assistant') {
          return { role: 'assistant', content: m.content };
        }
        // Phase 7 adds tool-result handling; for now treat as plain content.
        return { role: 'assistant', content: m.content };
      });

    const messages: ProviderChatMessage[] = [];
    if (conversation.systemPrompt) {
      messages.push({ role: 'system', content: conversation.systemPrompt });
    }
    messages.push(...history);

    const controller = new AbortController();
    inflight.set(conversation.id, controller);

    let accumulated = '';
    try {
      const provider = getProvider(conversation.provider);
      for await (const event of provider.stream({
        conversationId: conversation.id,
        messages,
        model: conversation.modelId,
        signal: controller.signal
      })) {
        if (event.type === 'delta' && event.delta) {
          accumulated += event.delta;
          send({
            type: 'delta',
            conversationId: conversation.id,
            messageId: assistantMsg.id,
            delta: event.delta
          });
        } else if (event.type === 'done') {
          messagesDb.updateContent(
            assistantMsg.id,
            accumulated,
            event.usage
          );
          send({
            type: 'done',
            conversationId: conversation.id,
            messageId: assistantMsg.id,
            usage: event.usage
          });
        } else if (event.type === 'error') {
          messagesDb.updateContent(assistantMsg.id, accumulated);
          send({
            type: 'error',
            conversationId: conversation.id,
            messageId: assistantMsg.id,
            error: event.error
          });
        }
      }
    } catch (err) {
      messagesDb.updateContent(assistantMsg.id, accumulated);
      send({
        type: 'error',
        conversationId: conversation.id,
        messageId: assistantMsg.id,
        error: err instanceof Error ? err.message : 'Unknown error'
      });
    } finally {
      inflight.delete(conversation.id);
    }

    return { userMessageId: userMsg.id, assistantMessageId: assistantMsg.id };
  });

  ipcMain.handle('chat:abort', (_e, conversationId: string) => {
    const controller = inflight.get(conversationId);
    controller?.abort();
  });
}

