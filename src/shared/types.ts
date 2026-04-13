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
  /**
   * Assistant messages that triggered MCP tool calls carry the list of
   * calls here. The matching tool-result messages (role='tool') come as
   * separate rows with their `toolCallId` populated.
   */
  toolCalls?: ToolCall[];
  /**
   * For role='tool' messages, the id of the tool_call this message is
   * responding to. Matches the `id` on a ToolCall in a prior assistant
   * message within the same conversation.
   */
  toolCallId?: string;
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

// ----- MCP (Phase 5+) -----

/**
 * Persistent configuration for a single MCP server. Stored in the
 * `mcp_servers` SQLite table (Phase 7+) and passed to the client
 * factory whenever a new connection is created.
 *
 * Discriminated by `transport`:
 *  - 'stdio' → spawn a child process and talk JSON-RPC over stdin/stdout
 *  - 'http'  → open a Streamable HTTP connection to a remote server
 */
export type MCPServerConfig =
  | {
      id: string;
      name: string;
      enabled: boolean;
      source: 'bundled' | 'user';
      transport: 'stdio';
      command: string;
      args?: string[];
      env?: Record<string, string>;
    }
  | {
      id: string;
      name: string;
      enabled: boolean;
      source: 'bundled' | 'user';
      transport: 'http';
      url: string;
      headers?: Record<string, string>;
    };

/** Lifecycle state for a single MCP client in the registry. */
export type MCPServerConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'error'
  | 'disconnected';

/**
 * A tool exposed by an MCP server, minimally shaped for the Loom UI and
 * the tool-call loop. Mirrors the subset of the MCP `Tool` type that we
 * actually need — keeps our IPC surface small and decouples us from
 * internal SDK schema changes.
 */
export interface MCPToolSummary {
  name: string;
  description?: string;
  /** JSON Schema object — forwarded verbatim to provider adapters. */
  inputSchema: Record<string, unknown>;
}

/** Aggregate view of a server for the renderer. */
export interface MCPServerState {
  config: MCPServerConfig;
  connection: MCPServerConnectionState;
  lastError?: string;
  tools: MCPToolSummary[];
}

/** Single content block returned by callTool. Matches MCP spec. */
export type MCPToolContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'audio'; data: string; mimeType: string }
  | {
      type: 'resource';
      resource: { uri: string; text?: string; mimeType?: string };
    };

export interface MCPCallToolResult {
  content: MCPToolContent[];
  isError?: boolean;
  /** Provider-agnostic rendering hint for tool-result cards in the chat. */
  durationMs?: number;
}

/** Metadata used by the Server Library UI to render one-click presets. */
export interface MCPServerPreset {
  /** Stable id used to dedupe duplicate installs. */
  id: string;
  name: string;
  description: string;
  family: 'filesystem' | 'memory' | 'github' | 'brave-search' | 'other';
  legacy?: boolean;
  /** Extra config fields the Library UI needs to prompt the user for. */
  requiresPath?: boolean;
  requiresApiKey?: {
    envVar: string;
    label: string;
  };
}

/**
 * A pending tool-call approval request broadcast by the main process
 * while a chat turn is blocked waiting for user consent.
 */
export interface MCPApprovalRequest {
  id: string;
  conversationId: string;
  messageId: string;
  serverId: string;
  /** Unnamespaced, user-friendly tool name (e.g. "list_directory"). */
  toolName: string;
  /** Parsed JSON arguments, safe to render. */
  arguments: unknown;
  createdAt: number;
}

export type MCPApprovalDecision = 'allow_once' | 'allow_always' | 'deny';

/**
 * Saved tool approval policy for a (conversation, server, tool) triple.
 * `never` is reserved for a future "always deny" mode and currently
 * unused — v1 only writes 'always' rows.
 */
export type MCPApprovalPolicy = 'always' | 'never';

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

/**
 * What the model / tool loop is doing right now, surfaced to the
 * renderer so the UI can show a status pill with a live elapsed-time
 * counter between user actions.
 */
export type ChatStatusPhase =
  | 'waiting' // send fired, haven't called provider yet
  | 'loading_model' // Ollama cold-loading weights (5–15s)
  | 'thinking' // provider invoked, no delta yet
  | 'running_tool'; // a tool call is mid-execution

export interface ChatStatusInfo {
  phase: ChatStatusPhase;
  /** Human-readable hint — e.g. "gemma4:e4b" for loading, "filesystem: list_directory" for tool runs. */
  detail?: string;
  /** ms since epoch, used by the renderer to compute elapsed time live. */
  startedAt: number;
}

export interface ChatStreamEvent {
  type:
    | 'delta'
    | 'tool_call'
    | 'tool_result'
    | 'done'
    | 'error'
    | 'status'
    | 'conversation_updated';
  conversationId: string;
  messageId?: string;
  delta?: string;
  toolCall?: ToolCall;
  toolCallId?: string;
  toolResult?: string;
  usage?: { promptTokens: number; completionTokens: number };
  error?: string;
  /** Populated when type === 'status'; `null` phase means "clear status". */
  status?: ChatStatusInfo | null;
  /** Populated when type === 'conversation_updated' (e.g. auto-rename changed title). */
  conversation?: Conversation;
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
  mcp: {
    /** List every persisted server and its live connection/tool state. */
    listServers: () => Promise<MCPServerState[]>;
    /** Bundled preset catalog shown in the Server Library UI. */
    listPresets: () => Promise<MCPServerPreset[]>;
    /** Create or update a server config. */
    saveServer: (config: MCPServerConfig) => Promise<MCPServerState>;
    /** Permanently remove a server config and close any live client. */
    removeServer: (id: string) => Promise<void>;
    /** Return the list of server ids attached to a conversation. */
    getAttachments: (conversationId: string) => Promise<string[]>;
    /** Replace the full set of servers attached to a conversation. */
    setAttachments: (
      conversationId: string,
      serverIds: string[]
    ) => Promise<void>;
    /** Resolve a pending approval request. */
    resolveApproval: (
      approvalId: string,
      decision: MCPApprovalDecision
    ) => Promise<void>;
    /** Subscribe to registry state changes (connection/tool-catalog updates). */
    onServersChanged: (
      handler: (servers: MCPServerState[]) => void
    ) => () => void;
    /** Subscribe to incoming approval requests from the tool loop. */
    onApprovalRequest: (
      handler: (request: MCPApprovalRequest) => void
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
