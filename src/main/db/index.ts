import Database from 'better-sqlite3';
import { app } from 'electron';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import type {
  Conversation,
  Message,
  MessageRole,
  ProviderId
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
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  tokens_prompt: number | null;
  tokens_completion: number | null;
  created_at: number;
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

  return db;
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
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role as MessageRole,
    content: row.content,
    tokensPrompt: row.tokens_prompt,
    tokensCompletion: row.tokens_completion,
    createdAt: row.created_at
  };
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

  update(
    id: string,
    patch: Partial<Pick<Conversation, 'title' | 'systemPrompt' | 'pinned' | 'provider' | 'modelId'>>
  ): void {
    const current = this.get(id);
    if (!current) throw new Error(`Conversation ${id} not found`);
    const next = { ...current, ...patch, updatedAt: Date.now() };
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
  }): Message {
    const id = nanoid();
    const now = Date.now();
    requireDb()
      .prepare(
        `INSERT INTO messages (id, conversation_id, role, content, tokens_prompt, tokens_completion, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.conversationId,
        input.role,
        input.content,
        input.tokensPrompt ?? null,
        input.tokensCompletion ?? null,
        now
      );
    conversationsDb.touch(input.conversationId);
    return {
      id,
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      tokensPrompt: input.tokensPrompt ?? null,
      tokensCompletion: input.tokensCompletion ?? null,
      createdAt: now
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
