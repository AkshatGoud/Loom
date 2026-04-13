import OpenAI from 'openai';
import type {
  ListedModel,
  Provider,
  ProviderChatMessage,
  ProviderChatRequest,
  ProviderStreamEvent
} from './provider';
import { settingsDb } from '../db';

// A curated fallback list used before `listModels()` fetches the live catalog.
// Keeps the UI usable if the key is missing or the network call fails.
const FALLBACK_MODELS: ListedModel[] = [
  { id: 'gpt-4o', displayName: 'GPT-4o' },
  { id: 'gpt-4o-mini', displayName: 'GPT-4o mini' },
  { id: 'gpt-4.1', displayName: 'GPT-4.1' },
  { id: 'gpt-4.1-mini', displayName: 'GPT-4.1 mini' },
  { id: 'o3-mini', displayName: 'o3-mini' }
];

function getApiKey(): string | null {
  return settingsDb.get<string>('openai.apiKey');
}

function buildClient(): OpenAI | null {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

function toOpenAiMessages(
  messages: ProviderChatMessage[]
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  return messages.map((m) => {
    switch (m.role) {
      case 'system':
      case 'user':
        return { role: m.role, content: m.content };
      case 'assistant':
        return { role: 'assistant', content: m.content };
      case 'tool':
        // Tool messages become OpenAI's `tool` role in Phase 7; for now the
        // tool-call loop is inactive and this branch is unreachable.
        return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
    }
  });
}

export const openAiProvider: Provider = {
  id: 'openai',
  supportsTools: true,

  async listModels(): Promise<ListedModel[]> {
    const client = buildClient();
    if (!client) return FALLBACK_MODELS;
    try {
      const resp = await client.models.list();
      const chat = resp.data
        .filter(
          (m) =>
            m.id.startsWith('gpt-') ||
            m.id.startsWith('o1') ||
            m.id.startsWith('o3') ||
            m.id.startsWith('o4')
        )
        .map((m) => ({ id: m.id, displayName: m.id }))
        .sort((a, b) => a.id.localeCompare(b.id));
      return chat.length > 0 ? chat : FALLBACK_MODELS;
    } catch {
      return FALLBACK_MODELS;
    }
  },

  async *stream(req: ProviderChatRequest): AsyncIterable<ProviderStreamEvent> {
    const client = buildClient();
    if (!client) {
      yield {
        type: 'error',
        error: 'OpenAI API key is not configured. Open Settings to add it.'
      };
      return;
    }

    try {
      const stream = await client.chat.completions.create(
        {
          model: req.model,
          messages: toOpenAiMessages(req.messages),
          temperature: req.temperature,
          max_tokens: req.maxTokens,
          stream: true,
          stream_options: { include_usage: true }
        },
        { signal: req.signal }
      );

      let promptTokens = 0;
      let completionTokens = 0;

      for await (const chunk of stream) {
        if (req.signal.aborted) break;
        const choice = chunk.choices[0];
        if (choice?.delta?.content) {
          yield { type: 'delta', delta: choice.delta.content };
        }
        if (chunk.usage) {
          promptTokens = chunk.usage.prompt_tokens;
          completionTokens = chunk.usage.completion_tokens;
        }
      }

      yield {
        type: 'done',
        usage: { promptTokens, completionTokens }
      };
    } catch (err) {
      if (req.signal.aborted) {
        yield { type: 'done' };
        return;
      }
      yield {
        type: 'error',
        error: err instanceof Error ? err.message : 'Unknown OpenAI error'
      };
    }
  }
};
