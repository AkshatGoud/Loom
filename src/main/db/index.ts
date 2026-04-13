import Database from 'better-sqlite3';
import { app } from 'electron';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import type {
  Conversation,
  Message,
  MessageRole,
  ProviderId,
  ToolCall
} from '../../shared/types';
// Vite inlines the SQL file at build time via ?raw — no runtime fs access needed.
import schema from './schema.sql?raw';

// ----- Raw row shapes (snake_case, integers for booleans) -----

interface ConversationRow {
  id: string;
  title: string;
  system_prompt: string | null;
  provider: string;
  model_id: string;
  pinned: number;
  created_at: number;
  updated_at: number;
  title_manually_set: number;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  tokens_prompt: number | null;
  tokens_completion: number | null;
  created_at: number;
  tool_calls_json: string | null;
  tool_call_id: string | null;
}

// ----- DB singleton -----

let db: Database.Database | null = null;

export function initDb(): Database.Database {
  if (db) return db;

  const dbPath = join(app.getPath('userData'), 'loom.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(schema);
  runMigrations(db);

  return db;
}

/**
 * Idempotent schema upgrade pass. SQLite's `ALTER TABLE ADD COLUMN`
 * errors if the column already exists, so we check `PRAGMA table_info`
 * first. New installs get the columns via schema.sql; this only runs
 * against databases created on an earlier Loom build.
 */
function runMigrations(database: Database.Database): void {
  // messages table (Phase 6)
  const msgCols = database
    .prepare("PRAGMA table_info(messages)")
    .all() as { name: string }[];
  const msgNames = new Set(msgCols.map((c) => c.name));
  if (!msgNames.has('tool_calls_json')) {
    database.exec('ALTER TABLE messages ADD COLUMN tool_calls_json TEXT');
  }
  if (!msgNames.has('tool_call_id')) {
    database.exec('ALTER TABLE messages ADD COLUMN tool_call_id TEXT');
  }

  // conversations table (Phase 7 — auto-rename gate)
  const convoCols = database
    .prepare("PRAGMA table_info(conversations)")
    .all() as { name: string }[];
  const convoNames = new Set(convoCols.map((c) => c.name));
  if (!convoNames.has('title_manually_set')) {
    database.exec(
      'ALTER TABLE conversations ADD COLUMN title_manually_set INTEGER DEFAULT 0'
    );
  }
}

function requireDb(): Database.Database {
  if (!db) throw new Error('Database not initialised. Call initDb() first.');
  return db;
}

// ----- Row → domain mappers -----

function conversationFromRow(row: ConversationRow): Conversation {
  return {
    id: row.id,
    title: row.title,
    systemPrompt: row.system_prompt,
    provider: row.provider as ProviderId,
    modelId: row.model_id,
    pinned: row.pinned === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function messageFromRow(row: MessageRow): Message {
  const message: Message = {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role as MessageRole,
    content: row.content,
    tokensPrompt: row.tokens_prompt,
    tokensCompletion: row.tokens_completion,
    createdAt: row.created_at
  };
  if (row.tool_calls_json) {
    try {
      message.toolCalls = JSON.parse(row.tool_calls_json) as ToolCall[];
    } catch {
      /* corrupted blob — ignore */
    }
  }
  if (row.tool_call_id) {
    message.toolCallId = row.tool_call_id;
  }
  return message;
}

// ----- Conversation queries -----

export const conversationsDb = {
  list(): Conversation[] {
    const rows = requireDb()
      .prepare<[], ConversationRow>(
        'SELECT * FROM conversations ORDER BY pinned DESC, updated_at DESC'
      )
      .all();
    return rows.map(conversationFromRow);
  },

  get(id: string): Conversation | null {
    const row = requireDb()
      .prepare<[string], ConversationRow>(
        'SELECT * FROM conversations WHERE id = ?'
      )
      .get(id);
    return row ? conversationFromRow(row) : null;
  },

  create(input: {
    title: string;
    systemPrompt: string | null;
    provider: ProviderId;
    modelId: string;
  }): Conversation {
    const now = Date.now();
    const id = nanoid();
    requireDb()
      .prepare(
        `INSERT INTO conversations (id, title, system_prompt, provider, model_id, pinned, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
      )
      .run(
        id,
        input.title,
        input.systemPrompt,
        input.provider,
        input.modelId,
        now,
        now
      );
    return this.get(id)!;
  },

  /**
   * User-facing update. Setting `title` here flips `title_manually_set`
   * to 1, which permanently locks out auto-rename for this conversation.
   * Called from the renderer via `conversations:update` IPC.
   */
  update(
    id: string,
    patch: Partial<Pick<Conversation, 'title' | 'systemPrompt' | 'pinned' | 'provider' | 'modelId'>>
  ): void {
    const current = this.get(id);
    if (!current) throw new Error(`Conversation ${id} not found`);
    const next = { ...current, ...patch, updatedAt: Date.now() };
    const manuallySet = patch.title !== undefined ? 1 : undefined;
    if (manuallySet === 1) {
      requireDb()
        .prepare(
          `UPDATE conversations
           SET title = ?, system_prompt = ?, provider = ?, model_id = ?, pinned = ?, updated_at = ?, title_manually_set = 1
           WHERE id = ?`
        )
        .run(
          next.title,
          next.systemPrompt,
          next.provider,
          next.modelId,
          next.pinned ? 1 : 0,
          next.updatedAt,
          id
        );
    } else {
      requireDb()
        .prepare(
          `UPDATE conversations
           SET title = ?, system_prompt = ?, provider = ?, model_id = ?, pinned = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          next.title,
          next.systemPrompt,
          next.provider,
          next.modelId,
          next.pinned ? 1 : 0,
          next.updatedAt,
          id
        );
    }
  },

  /**
   * Internal-only title update used by the Phase 7 auto-rename path.
   * Does NOT set `title_manually_set`, and is a no-op if the flag has
   * already been flipped — so user edits always win.
   */
  setAutoTitle(id: string, title: string): boolean {
    const row = requireDb()
      .prepare<[string], { title_manually_set: number }>(
        'SELECT title_manually_set FROM conversations WHERE id = ?'
      )
      .get(id);
    if (!row || row.title_manually_set === 1) return false;
    requireDb()
      .prepare(
        `UPDATE conversations SET title = ?, updated_at = ? WHERE id = ? AND title_manually_set = 0`
      )
      .run(title, Date.now(), id);
    return true;
  },

  /** True iff auto-rename is still allowed for this conversation. */
  canAutoRename(id: string): boolean {
    const row = requireDb()
      .prepare<[string], { title_manually_set: number; title: string }>(
        'SELECT title_manually_set, title FROM conversations WHERE id = ?'
      )
      .get(id);
    return row != null && row.title_manually_set === 0;
  },

  touch(id: string): void {
    requireDb()
      .prepare('UPDATE conversations SET updated_at = ? WHERE id = ?')
      .run(Date.now(), id);
  },

  remove(id: string): void {
    requireDb().prepare('DELETE FROM conversations WHERE id = ?').run(id);
  }
};

// ----- Message queries -----

export const messagesDb = {
  listForConversation(conversationId: string): Message[] {
    const rows = requireDb()
      .prepare<[string], MessageRow>(
        'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
      )
      .all(conversationId);
    return rows.map(messageFromRow);
  },

  insert(input: {
    conversationId: string;
    role: MessageRole;
    content: string;
    tokensPrompt?: number | null;
    tokensCompletion?: number | null;
    toolCalls?: ToolCall[];
    toolCallId?: string;
  }): Message {
    const id = nanoid();
    const now = Date.now();
    const toolCallsJson =
      input.toolCalls && input.toolCalls.length > 0
        ? JSON.stringify(input.toolCalls)
        : null;
    requireDb()
      .prepare(
        `INSERT INTO messages
         (id, conversation_id, role, content, tokens_prompt, tokens_completion, created_at, tool_calls_json, tool_call_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.conversationId,
        input.role,
        input.content,
        input.tokensPrompt ?? null,
        input.tokensCompletion ?? null,
        now,
        toolCallsJson,
        input.toolCallId ?? null
      );
    conversationsDb.touch(input.conversationId);
    return {
      id,
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      tokensPrompt: input.tokensPrompt ?? null,
      tokensCompletion: input.tokensCompletion ?? null,
      createdAt: now,
      ...(input.toolCalls && input.toolCalls.length > 0
        ? { toolCalls: input.toolCalls }
        : {}),
      ...(input.toolCallId ? { toolCallId: input.toolCallId } : {})
    };
  },

  updateContent(id: string, content: string, usage?: { promptTokens: number; completionTokens: number }): void {
    if (usage) {
      requireDb()
        .prepare(
          'UPDATE messages SET content = ?, tokens_prompt = ?, tokens_completion = ? WHERE id = ?'
        )
        .run(content, usage.promptTokens, usage.completionTokens, id);
    } else {
      requireDb().prepare('UPDATE messages SET content = ? WHERE id = ?').run(content, id);
    }
  },

  /**
   * Finalise an assistant message at the end of a streaming turn: set
   * the accumulated content, the tool_calls blob (if any), and the
   * usage stats. Used by the Phase 6 tool-call loop in chat:send.
   */
  finaliseAssistant(
    id: string,
    content: string,
    toolCalls: ToolCall[] | undefined,
    usage?: { promptTokens: number; completionTokens: number }
  ): void {
    const toolCallsJson =
      toolCalls && toolCalls.length > 0 ? JSON.stringify(toolCalls) : null;
    if (usage) {
      requireDb()
        .prepare(
          `UPDATE messages
           SET content = ?, tool_calls_json = ?, tokens_prompt = ?, tokens_completion = ?
           WHERE id = ?`
        )
        .run(
          content,
          toolCallsJson,
          usage.promptTokens,
          usage.completionTokens,
          id
        );
    } else {
      requireDb()
        .prepare(
          'UPDATE messages SET content = ?, tool_calls_json = ? WHERE id = ?'
        )
        .run(content, toolCallsJson, id);
    }
  },

  remove(id: string): void {
    requireDb().prepare('DELETE FROM messages WHERE id = ?').run(id);
  }
};

// ----- Settings (generic JSON KV, v1) -----
//
// API keys live here in v1 for development ergonomics; Phase 3 migrates
// provider secrets to the OS keychain via keytar and leaves only non-sensitive
// preferences in this table.

export const settingsDb = {
  get<T = unknown>(key: string): T | null {
    const row = requireDb()
      .prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?')
      .get(key);
    if (!row) return null;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return null;
    }
  },

  set(key: string, value: unknown): void {
    const json = JSON.stringify(value);
    requireDb()
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(key, json);
  },

  remove(key: string): void {
    requireDb().prepare('DELETE FROM settings WHERE key = ?').run(key);
  }
};
