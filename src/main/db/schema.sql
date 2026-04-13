-- Initial schema for Loom.
-- Ran once on DB creation; future changes go in db/migrations/ as incremental files.

CREATE TABLE IF NOT EXISTS conversations (
  id                  TEXT PRIMARY KEY,
  title               TEXT NOT NULL,
  system_prompt       TEXT,
  provider            TEXT NOT NULL,
  model_id            TEXT NOT NULL,
  pinned              INTEGER DEFAULT 0,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  -- Phase 7: once the user manually renames a chat, auto-rename is
  -- locked out forever. Set to 1 on any update that comes through
  -- conversationsDb.update with a non-null title from the renderer.
  title_manually_set  INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_conversations_updated
  ON conversations(pinned DESC, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id                TEXT PRIMARY KEY,
  conversation_id   TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role              TEXT NOT NULL,
  content           TEXT NOT NULL,
  tokens_prompt     INTEGER,
  tokens_completion INTEGER,
  created_at        INTEGER NOT NULL,
  -- Phase 6: MCP tool calling
  tool_calls_json   TEXT,      -- JSON array of ToolCall, set on assistant messages that triggered MCP tools
  tool_call_id      TEXT       -- set on role='tool' messages, links back to the ToolCall.id in a prior assistant row
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation
  ON messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Local model catalog (populated in Phase 5)
CREATE TABLE IF NOT EXISTS local_models (
  id            TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  local_path    TEXT NOT NULL,
  size_bytes    INTEGER,
  quant         TEXT,
  downloaded_at INTEGER NOT NULL
);

-- MCP tables (populated in Phase 6+)
CREATE TABLE IF NOT EXISTS mcp_servers (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  transport  TEXT NOT NULL,
  config     TEXT NOT NULL,
  enabled    INTEGER DEFAULT 1,
  source     TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS conversation_servers (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  server_id       TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  PRIMARY KEY (conversation_id, server_id)
);

CREATE TABLE IF NOT EXISTS tool_invocations (
  id             TEXT PRIMARY KEY,
  message_id     TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  server_id      TEXT NOT NULL,
  tool_name      TEXT NOT NULL,
  arguments_json TEXT NOT NULL,
  result_json    TEXT,
  status         TEXT NOT NULL,
  duration_ms    INTEGER,
  created_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tool_approvals (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  server_id       TEXT NOT NULL,
  tool_name       TEXT NOT NULL,
  policy          TEXT NOT NULL,
  PRIMARY KEY (conversation_id, server_id, tool_name)
);
