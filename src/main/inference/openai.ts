import OpenAI from 'openai';
import type {
  ListedModel,
  Provider,
  ProviderChatRequest,
  ProviderStreamEvent
} from './provider';
import { streamOpenAICompatible } from './openai-compatible';
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
    yield* streamOpenAICompatible(client, req);
  }
};
