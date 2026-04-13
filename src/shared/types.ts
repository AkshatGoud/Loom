// Shared type definitions used across main, preload, and renderer.
// Keep this file free of runtime imports so it can be consumed everywhere.

export type ProviderId = 'ollama' | 'openai' | 'anthropic' | 'google';

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface Conversation {
  id: string;
  title: string;
  systemPrompt: string | null;
  provider: ProviderId;
  modelId: string;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  tokensPrompt: number | null;
  tokensCompletion: number | null;
  createdAt: number;
}

export interface ListedModel {
  id: string;
  displayName: string;
}

// ----- Ollama model management (Phase 4) -----

/** A model that has been pulled via `ollama pull` and is stored locally. */
export interface InstalledModel {
  /** Ollama tag, e.g. 'gemma4:e4b'. */
  id: string;
  displayName: string;
  sizeBytes: number;
  digest: string;
  family: string | null;
  parameterSize: string | null;
  quantLevel: string | null;
  /** ms since epoch, from `/api/tags` `modified_at`. */
  modifiedAt: number;
}

export type ModelCategory =
  | 'multimodal'
  | 'text'
  | 'coding'
  | 'reasoning'
  | 'vision';

/** Entry in the hand-curated "recommended models" catalog. */
export interface CuratedModel {
  id: string;
  displayName: string;
  description: string;
  category: ModelCategory;
  approxSizeBytes: number;
  minRamBytes: number;
  family: string;
  parameterSize: string;
  supportsTools: boolean;
  supportsVision: boolean;
  tags: string[];
}

export type PullStatus =
  | 'downloading'
  | 'success'
  | 'error'
  | 'cancelled'
  | string; // Ollama emits free-form status strings like 'verifying sha256'

/** Streamed progress event forwarded from /api/pull to the renderer. */
export interface ModelPullProgress {
  name: string;
  status: PullStatus;
  digest?: string;
  total?: number;
  completed?: number;
  error?: string;
}

/** Response shape for /api/show (model metadata). */
export interface ModelShowDetails {
  name: string;
  family: string | null;
  parameterSize: string | null;
  quantLevel: string | null;
  format: string | null;
  capabilities: string[];
  parameters: string | null;
  template: string | null;
}

export interface ToolCall {
  id: string;
  serverId: string;
  name: string;
  arguments: unknown;
}

export interface ChatSendInput {
  conversationId: string;
  content: string;
}

export interface ChatSendResult {
  userMessageId: string;
  assistantMessageId: string;
}

export interface ChatStreamEvent {
  type: 'delta' | 'tool_call' | 'tool_result' | 'done' | 'error';
  conversationId: string;
  messageId?: string;
  delta?: string;
  toolCall?: ToolCall;
  toolCallId?: string;
  toolResult?: string;
  usage?: { promptTokens: number; completionTokens: number };
  error?: string;
}

export interface ConversationCreateInput {
  title: string;
  systemPrompt: string | null;
  provider: ProviderId;
  modelId: string;
}

// Ollama daemon is not managed by Loom — we only detect it and guide the
// user. `state` drives the OllamaOnboarding component.
export type OllamaDaemonState =
  | 'checking'
  | 'not_installed'
  | 'installed_not_running'
  | 'running';

export interface LoadedOllamaModel {
  name: string;
  /** Bytes resident in Ollama's memory for this model. */
  sizeVram: number;
}

export interface OllamaStatus {
  state: OllamaDaemonState;
  version: string | null;
  /** Human-readable hint for the onboarding UI. */
  message: string;
  /** true if at least one model is pulled. */
  hasModels: boolean;
  /** The tag of the first available model, if any — used as a default. */
  firstModel: string | null;
  /** Models currently resident in RAM per /api/ps. Empty when idle. */
  loadedModels: LoadedOllamaModel[];
}

// Typed IPC surface exposed via contextBridge. Keep it narrow and stable —
// every entry here is a contract with the renderer.
export interface IpcApi {
  app: {
    getVersion: () => Promise<string>;
  };
  settings: {
    get: <T = unknown>(key: string) => Promise<T | null>;
    set: (key: string, value: unknown) => Promise<void>;
    hasOpenAiKey: () => Promise<boolean>;
  };
  providers: {
    listModels: (providerId: ProviderId) => Promise<ListedModel[]>;
  };
  models: {
    listInstalled: () => Promise<InstalledModel[]>;
    listCurated: () => Promise<CuratedModel[]>;
    pull: (name: string) => Promise<void>;
    cancelPull: (name: string) => Promise<void>;
    delete: (name: string) => Promise<boolean>;
    show: (name: string) => Promise<ModelShowDetails | null>;
    onPullProgress: (
      handler: (progress: ModelPullProgress) => void
    ) => () => void;
  };
  ollama: {
    getStatus: () => Promise<OllamaStatus>;
    tryStart: () => Promise<OllamaStatus>;
    unloadModel: (model: string) => Promise<OllamaStatus>;
    unloadAll: () => Promise<OllamaStatus>;
    onStatusChange: (handler: (status: OllamaStatus) => void) => () => void;
  };
  conversations: {
    list: () => Promise<Conversation[]>;
    get: (id: string) => Promise<Conversation | null>;
    create: (input: ConversationCreateInput) => Promise<Conversation>;
    update: (id: string, patch: Partial<Conversation>) => Promise<Conversation | null>;
    remove: (id: string) => Promise<void>;
    listMessages: (id: string) => Promise<Message[]>;
  };
  chat: {
    send: (input: ChatSendInput) => Promise<ChatSendResult>;
    abort: (conversationId: string) => Promise<void>;
    onStream: (handler: (event: ChatStreamEvent) => void) => () => void;
  };
}
