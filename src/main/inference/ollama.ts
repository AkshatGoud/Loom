import OpenAI from 'openai';
import type {
  ListedModel,
  Provider,
  ProviderChatMessage,
  ProviderChatRequest,
  ProviderStreamEvent
} from './provider';
import { OLLAMA_BASE_URL, getOllamaStatus } from '../ollama/daemon';

// Ollama exposes two chat surfaces:
//   1. /v1/chat/completions — OpenAI-compatible. We use this for streaming,
//      so we reuse the `openai` SDK with a different baseURL.
//   2. /api/tags — native endpoint that lists *pulled* models with tag,
//      size, and digest. We call this directly (not via SDK) because the
//      OpenAI-compat /v1/models endpoint doesn't give us the same detail
//      and sometimes omits recently-pulled models.

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
    details?: { family?: string; parameter_size?: string; quantization_level?: string };
  }>;
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
        return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
    }
  });
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
      const message =
        err instanceof Error
          ? err.message
          : 'Unknown error talking to Ollama daemon';
      yield { type: 'error', error: message };
    }
  }
};
