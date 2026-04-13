import type OpenAI from 'openai';
import type {
  ProviderChatMessage,
  ProviderChatRequest,
  ProviderStreamEvent,
  ProviderTool
} from './provider';

/**
 * Shared streaming implementation for any provider that speaks the
 * OpenAI `/v1/chat/completions` shape — real OpenAI, Ollama (via its
 * OpenAI-compatible endpoint), and future local adapters.
 *
 * Handles:
 *   - Text deltas (→ `delta` events)
 *   - Tool schema translation from our internal ProviderTool to OpenAI's
 *     `{type: 'function', function: {...}}` wire shape
 *   - Streaming tool-call assembly: OpenAI breaks each tool call across
 *     many chunks (id in one, name in another, arguments in pieces).
 *     We accumulate by `index` and emit a single `tool_call` event per
 *     completed call when the stream finishes.
 *   - Passing prior `role: 'tool'` history back to the model so the
 *     multi-turn tool loop works across iterations.
 *   - Graceful abort via `req.signal`.
 *
 * This helper is deliberately decoupled from which client instance it
 * talks to — the caller passes a constructed `OpenAI` client with the
 * right `baseURL` and key already set. That's how one implementation
 * serves both the real OpenAI provider and the Ollama provider.
 */

function toOpenAiMessages(
  messages: ProviderChatMessage[]
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  return messages.map((m) => {
    switch (m.role) {
      case 'system':
      case 'user':
        return { role: m.role, content: m.content };
      case 'assistant': {
        // Assistant messages that triggered tool calls must include
        // the `tool_calls` array back in their history so OpenAI's
        // template renders them correctly — otherwise the model sees
        // a tool-result with no prior tool-call and refuses to engage.
        if (m.toolCalls && m.toolCalls.length > 0) {
          return {
            role: 'assistant',
            content: m.content || null,
            tool_calls: m.toolCalls.map((tc) => ({
              id: tc.id,
              type: 'function' as const,
              function: {
                name: tc.name,
                arguments: JSON.stringify(tc.arguments)
              }
            }))
          };
        }
        return { role: 'assistant', content: m.content };
      }
      case 'tool':
        return {
          role: 'tool',
          tool_call_id: m.toolCallId,
          content: m.content
        };
    }
  });
}

function toOpenAiTools(
  tools: ProviderTool[] | undefined
): OpenAI.Chat.Completions.ChatCompletionTool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema as Record<string, unknown>
    }
  }));
}

interface PendingToolCall {
  id: string;
  name: string;
  argumentsJson: string;
}

export async function* streamOpenAICompatible(
  client: OpenAI,
  req: ProviderChatRequest
): AsyncIterable<ProviderStreamEvent> {
  try {
    const stream = await client.chat.completions.create(
      {
        model: req.model,
        messages: toOpenAiMessages(req.messages),
        temperature: req.temperature,
        max_tokens: req.maxTokens,
        tools: toOpenAiTools(req.tools),
        stream: true,
        stream_options: { include_usage: true }
      },
      { signal: req.signal }
    );

    // Tool calls stream in as partial deltas keyed by index. We
    // reassemble them here so we can emit one clean event per call
    // when the stream finishes.
    const pending = new Map<number, PendingToolCall>();
    let promptTokens = 0;
    let completionTokens = 0;

    for await (const chunk of stream) {
      if (req.signal.aborted) break;

      const choice = chunk.choices[0];
      const delta = choice?.delta;

      if (delta?.content) {
        yield { type: 'delta', delta: delta.content };
      }

      const toolDeltas = delta?.tool_calls;
      if (toolDeltas) {
        for (const td of toolDeltas) {
          const idx = td.index;
          let entry = pending.get(idx);
          if (!entry) {
            entry = { id: '', name: '', argumentsJson: '' };
            pending.set(idx, entry);
          }
          if (td.id) entry.id = td.id;
          if (td.function?.name) entry.name += td.function.name;
          if (td.function?.arguments) {
            entry.argumentsJson += td.function.arguments;
          }
        }
      }

      if (chunk.usage) {
        promptTokens = chunk.usage.prompt_tokens;
        completionTokens = chunk.usage.completion_tokens;
      }
    }

    // Emit one tool_call event per completed call. The namespaced
    // name survives round-trip verbatim — the tool loop parses
    // serverId back out of it using the lookup map it built when
    // constructing the tools[] input.
    for (const call of pending.values()) {
      let parsedArgs: unknown = {};
      try {
        parsedArgs = call.argumentsJson ? JSON.parse(call.argumentsJson) : {};
      } catch {
        // Model produced malformed JSON — forward as a string so the
        // caller can surface a meaningful error instead of crashing.
        parsedArgs = { _raw: call.argumentsJson };
      }
      yield {
        type: 'tool_call',
        toolCall: {
          id: call.id,
          serverId: '', // filled in by the tool loop via lookup table
          name: call.name,
          arguments: parsedArgs
        }
      };
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
      error: err instanceof Error ? err.message : 'Unknown streaming error'
    };
  }
}
