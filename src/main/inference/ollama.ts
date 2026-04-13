import OpenAI from 'openai';
import type {
  ListedModel,
  Provider,
  ProviderChatRequest,
  ProviderStreamEvent
} from './provider';
import { streamOpenAICompatible } from './openai-compatible';
import { OLLAMA_BASE_URL, getOllamaStatus } from '../ollama/daemon';

/**
 * Ollama provider. Runs local LLMs through the user-installed Ollama
 * daemon. Uses Ollama's OpenAI-compatible `/v1/chat/completions`
 * endpoint so we can share every byte of streaming + tool-calling code
 * with the real OpenAI provider (see ./openai-compatible.ts).
 *
 * Model management (pull, delete, show, ps) lives in ../ollama/models.ts
 * and hits Ollama's native `/api/*` endpoints because the OpenAI-compat
 * surface doesn't expose them.
 */

function buildClient(): OpenAI {
  return new OpenAI({
    baseURL: `${OLLAMA_BASE_URL}/v1`,
    apiKey: 'ollama' // Ollama requires a non-empty key but ignores the value
  });
}

interface TagsResponse {
  models: Array<{
    name: string;
    size: number;
    digest: string;
    details?: {
      family?: string;
      parameter_size?: string;
      quantization_level?: string;
    };
  }>;
}

export const ollamaProvider: Provider = {
  id: 'ollama',
  supportsTools: true,

  async listModels(): Promise<ListedModel[]> {
    // Hit /api/tags directly — it's the authoritative source for pulled models.
    const status = await getOllamaStatus();
    if (status.state !== 'running') return [];

    try {
      const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
      if (!res.ok) return [];
      const data = (await res.json()) as TagsResponse;
      return (data.models ?? [])
        .map((m) => {
          const label = m.details?.parameter_size
            ? `${m.name} (${m.details.parameter_size})`
            : m.name;
          return { id: m.name, displayName: label };
        })
        .sort((a, b) => a.id.localeCompare(b.id));
    } catch {
      return [];
    }
  },

  async *stream(req: ProviderChatRequest): AsyncIterable<ProviderStreamEvent> {
    const status = await getOllamaStatus();
    if (status.state !== 'running') {
      yield {
        type: 'error',
        error:
          status.state === 'not_installed'
            ? 'Ollama is not installed. Open onboarding to install it.'
            : 'Ollama is not running. Start it from the onboarding screen.'
      };
      return;
    }

    const client = buildClient();
    yield* streamOpenAICompatible(client, req);
  }
};
