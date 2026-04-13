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
import {
  collectActiveTools,
  routeToolCall,
  MAX_TOOL_ITERATIONS
} from '../mcp/tool-loop';
import type {
  ChatSendInput,
  ChatStreamEvent,
  Conversation,
  Message,
  OllamaStatus,
  ProviderId,
  ToolCall
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

/**
 * Walk the persisted messages for a conversation and project each row
 * into a ProviderChatMessage. Preserves tool_calls on assistant rows
 * and tool_call_id on role='tool' rows so round-trips through SQLite
 * don't lose any structure the provider needs to replay a tool-use
 * turn.
 */
function buildHistory(conversationId: string): ProviderChatMessage[] {
  const rows = messagesDb.listForConversation(conversationId);
  return rows.map<ProviderChatMessage>((m) => {
    if (m.role === 'user' || m.role === 'system') {
      return { role: m.role, content: m.content };
    }
    if (m.role === 'assistant') {
      const msg: ProviderChatMessage = {
        role: 'assistant',
        content: m.content
      };
      if (m.toolCalls && m.toolCalls.length > 0) {
        msg.toolCalls = m.toolCalls.map((tc) => ({
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments
        }));
      }
      return msg;
    }
    // role === 'tool'
    return {
      role: 'tool',
      toolCallId: m.toolCallId ?? '',
      content: m.content
    };
  });
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

  // ----- Chat (Phase 6: multi-turn tool-call loop) -----
  ipcMain.handle('chat:send', async (_e, input: ChatSendInput) => {
    const conversation = conversationsDb.get(input.conversationId);
    if (!conversation) throw new Error('Conversation not found');

    // 1. Persist the user message up front so it survives any error below.
    const userMsg = messagesDb.insert({
      conversationId: conversation.id,
      role: 'user',
      content: input.content
    });
    send({
      type: 'delta',
      conversationId: conversation.id,
      messageId: userMsg.id,
      delta: ''
    });

    // 2. Build the provider's initial message history from everything
    //    already persisted in SQLite. This is what lets a new model see
    //    the entire prior conversation after a mid-chat switch.
    const systemMessages: ProviderChatMessage[] = conversation.systemPrompt
      ? [{ role: 'system', content: conversation.systemPrompt }]
      : [];
    let messages: ProviderChatMessage[] = [
      ...systemMessages,
      ...buildHistory(conversation.id)
    ];

    // 3. Resolve the active MCP tool catalog. Phase 6 exposes EVERY
    //    registered MCP server to EVERY chat — per-conversation
    //    attachment comes in Phase 7.
    const provider = getProvider(conversation.provider);
    const activeTools = provider.supportsTools
      ? await collectActiveTools()
      : { tools: [], routes: new Map() };

    const controller = new AbortController();
    inflight.set(conversation.id, controller);

    let finalAssistantId: string | null = null;

    try {
      // 4. Multi-turn loop. Each iteration:
      //    - Creates a fresh assistant placeholder row
      //    - Streams one turn from the provider
      //    - If the turn ended with tool calls, executes them, persists
      //      each result as its own `role: 'tool'` message, and loops
      //    - If the turn ended with plain text, we're done
      for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
        const assistantMsg = messagesDb.insert({
          conversationId: conversation.id,
          role: 'assistant',
          content: ''
        });
        finalAssistantId = assistantMsg.id;
        send({
          type: 'delta',
          conversationId: conversation.id,
          messageId: assistantMsg.id,
          delta: ''
        });

        let accumulated = '';
        const pendingCalls: ToolCall[] = [];
        let iterDone = false;
        let iterErrored = false;
        let usage: { promptTokens: number; completionTokens: number } | undefined;

        for await (const event of provider.stream({
          conversationId: conversation.id,
          messages,
          model: conversation.modelId,
          tools: activeTools.tools.length > 0 ? activeTools.tools : undefined,
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
          } else if (event.type === 'tool_call' && event.toolCall) {
            // Resolve serverId so downstream consumers (renderer cards,
            // DB persistence, re-routing) have the complete picture.
            const route = activeTools.routes.get(event.toolCall.name);
            const resolved: ToolCall = {
              id: event.toolCall.id,
              serverId: route?.serverId ?? '',
              name: event.toolCall.name,
              arguments: event.toolCall.arguments
            };
            pendingCalls.push(resolved);
            send({
              type: 'tool_call',
              conversationId: conversation.id,
              messageId: assistantMsg.id,
              toolCall: resolved
            });
          } else if (event.type === 'done') {
            usage = event.usage;
            iterDone = true;
            break;
          } else if (event.type === 'error') {
            iterErrored = true;
            send({
              type: 'error',
              conversationId: conversation.id,
              messageId: assistantMsg.id,
              error: event.error
            });
            break;
          }
        }

        // Persist whatever we captured this iteration.
        messagesDb.finaliseAssistant(
          assistantMsg.id,
          accumulated,
          pendingCalls.length > 0 ? pendingCalls : undefined,
          usage
        );

        // Append the assistant turn to the in-flight history so the
        // next iteration (and any tool messages that follow) see it.
        messages = [
          ...messages,
          {
            role: 'assistant',
            content: accumulated,
            toolCalls:
              pendingCalls.length > 0
                ? pendingCalls.map((c) => ({
                    id: c.id,
                    name: c.name,
                    arguments: c.arguments
                  }))
                : undefined
          }
        ];

        if (iterErrored) return;

        if (!iterDone || pendingCalls.length === 0) {
          // Stream ended cleanly with no tool calls → conversation
          // complete. Notify the renderer and stop looping.
          send({
            type: 'done',
            conversationId: conversation.id,
            messageId: assistantMsg.id,
            usage
          });
          return;
        }

        // 5. Execute every pending tool call, persisting each result
        //    as its own `role: 'tool'` message.
        for (const call of pendingCalls) {
          if (controller.signal.aborted) return;
          const { resultText, isError, durationMs } = await routeToolCall(
            activeTools.routes,
            { id: call.id, name: call.name, arguments: call.arguments }
          );

          const toolMsg = messagesDb.insert({
            conversationId: conversation.id,
            role: 'tool',
            content: resultText,
            toolCallId: call.id
          });

          send({
            type: 'tool_result',
            conversationId: conversation.id,
            messageId: toolMsg.id,
            toolCallId: call.id,
            toolResult: resultText
          });

          if (isError) {
            console.warn(
              `[chat] tool '${call.name}' reported error in ${durationMs}ms`
            );
          }

          messages = [
            ...messages,
            { role: 'tool', toolCallId: call.id, content: resultText }
          ];
        }

        // Fall through → the next iteration asks the provider to
        // continue given the tool results.
      }

      // Hit the iteration cap without the model converging.
      send({
        type: 'error',
        conversationId: conversation.id,
        messageId: finalAssistantId ?? undefined,
        error: `Tool-call loop exceeded ${MAX_TOOL_ITERATIONS} iterations without a plain-text response.`
      });
    } catch (err) {
      send({
        type: 'error',
        conversationId: conversation.id,
        messageId: finalAssistantId ?? undefined,
        error: err instanceof Error ? err.message : 'Unknown chat error'
      });
    } finally {
      inflight.delete(conversation.id);
    }

    return {
      userMessageId: userMsg.id,
      assistantMessageId: finalAssistantId ?? userMsg.id
    };
  });

  ipcMain.handle('chat:abort', (_e, conversationId: string) => {
    const controller = inflight.get(conversationId);
    controller?.abort();
  });
}

