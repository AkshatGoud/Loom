import type { ProviderId, ChatStreamEvent } from '../../shared/types';

// Canonical chat message as it moves between the tool-call loop, DB, and
// provider adapters. `tool` messages carry MCP tool results back to the model.
export type ProviderChatMessage =
  | { role: 'system' | 'user'; content: string }
  | {
      role: 'assistant';
      content: string;
      toolCalls?: { id: string; name: string; arguments: unknown }[];
    }
  | { role: 'tool'; toolCallId: string; content: string };

// Provider-native tool descriptor (translated from MCP Tool). Phase 7 will
// populate this with real definitions; Phase 2 just needs the interface.
export interface ProviderTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ProviderChatRequest {
  conversationId: string;
  messages: ProviderChatMessage[];
  model: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ProviderTool[];
  signal: AbortSignal;
}

// What the provider yields as it streams. Same shape as the renderer-facing
// ChatStreamEvent but without conversationId (the tool-call loop attaches it).
export type ProviderStreamEvent = Omit<ChatStreamEvent, 'conversationId'>;

export interface ListedModel {
  id: string;
  displayName: string;
}

export interface Provider {
  readonly id: ProviderId;
  readonly supportsTools: boolean;
  listModels(): Promise<ListedModel[]>;
  stream(req: ProviderChatRequest): AsyncIterable<ProviderStreamEvent>;
}

// ----- Registry -----
//
// Providers register themselves with this map at startup. The chat IPC handler
// looks up the right provider by id, threads the abort signal through, and
// forwards stream events to the renderer.

const providers = new Map<ProviderId, Provider>();

export function registerProvider(provider: Provider): void {
  providers.set(provider.id, provider);
}

export function getProvider(id: ProviderId): Provider {
  const p = providers.get(id);
  if (!p) throw new Error(`Provider '${id}' is not registered`);
  return p;
}

export function listProviders(): Provider[] {
  return Array.from(providers.values());
}
