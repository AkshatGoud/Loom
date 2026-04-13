import { app, BrowserWindow, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { initDb } from './db';
import { registerIpcHandlers } from './ipc';
import { loadPersistedMcpServers } from './ipc/mcp';
import { registerProvider } from './inference/provider';
import { openAiProvider } from './inference/openai';
import { ollamaProvider } from './inference/ollama';
import { startHealthWatcher } from './ollama/daemon';
import {
  registerServer as registerMcpServer,
  listToolsForServer,
  callTool as callMcpTool,
  disconnectAll as disconnectAllMcp
} from './mcp/registry';
import { rejectAllPending as rejectAllPendingApprovals } from './mcp/approval';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let mainWindow: BrowserWindow | null = null;

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 600,
    show: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0b0b0f',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Forward renderer console to the main process log during dev so errors are
  // visible without opening DevTools every time.
  mainWindow.webContents.on('console-message', (_event, level, message, line, source) => {
    const levels = ['verbose', 'info', 'warning', 'error'] as const;
    const label = levels[level] ?? 'info';
    console.log(`[renderer:${label}] ${source}:${line} ${message}`);
  });

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer crashed]', details);
  });

  mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDescription, url) => {
    console.error(`[renderer failed to load] ${url} code=${errorCode} desc=${errorDescription}`);
  });

  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
    // DevTools is opt-in now. Set LOOM_DEVTOOLS=1 to auto-open it when
    // actively debugging; otherwise press Cmd+Option+I (macOS) or
    // Ctrl+Shift+I (Windows/Linux) any time to open it on demand.
    if (process.env.LOOM_DEVTOOLS === '1') {
      mainWindow.webContents.openDevTools({ mode: 'right' });
    }
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

/**
 * Dev-mode MCP smoke test (Phase 5). Flipped to opt-in in Phase 7 —
 * set `LOOM_MCP_SMOKE=1` to enable. Phase 7 replaces the smoke test
 * as the primary way to verify MCP end-to-end (users configure real
 * servers via the Server Library), but the smoke test still has
 * value as a boot-time connectivity probe during development.
 *
 * The smoke-test server is registered with id `smoke:filesystem` so
 * it NEVER collides with user-configured servers and is never
 * auto-attached to any conversation — Phase 7's
 * `conversation_servers` gating takes care of that.
 *
 * Silent in production builds so packaged users never see these logs.
 */
async function runMcpSmokeTest(): Promise<void> {
  if (!process.env.ELECTRON_RENDERER_URL) return; // prod build → skip
  if (process.env.LOOM_MCP_SMOKE !== '1') return; // opt-in as of Phase 7

  const testId = 'smoke:filesystem';
  try {
    await registerMcpServer({
      id: testId,
      name: 'Filesystem (smoke test)',
      enabled: true,
      source: 'bundled',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', homedir()]
    });

    console.log('[mcp-smoke] connecting to filesystem server…');
    const tools = await listToolsForServer(testId);
    console.log(
      `[mcp-smoke] ${tools.length} tools discovered:`,
      tools.map((t) => t.name).join(', ')
    );

    // Pick a known filesystem tool to invoke. The server exposes
    // `list_directory` in every version we care about.
    const listDir = tools.find((t) => t.name === 'list_directory');
    if (listDir) {
      const result = await callMcpTool(testId, 'list_directory', {
        path: homedir()
      });
      const firstTextBlock = result.content.find((c) => c.type === 'text');
      const preview =
        firstTextBlock && firstTextBlock.type === 'text'
          ? firstTextBlock.text.split('\n').slice(0, 3).join(' | ')
          : '(no text content)';
      console.log(
        `[mcp-smoke] callTool(list_directory) done in ${result.durationMs}ms — preview: ${preview}`
      );
    } else {
      console.log(
        '[mcp-smoke] list_directory not exposed by this server version — skipping invoke'
      );
    }
  } catch (err) {
    console.error(
      '[mcp-smoke] failed:',
      err instanceof Error ? err.message : err
    );
  }
}

app.whenReady().then(() => {
  initDb();
  registerProvider(ollamaProvider);
  registerProvider(openAiProvider);
  registerIpcHandlers();
  startHealthWatcher();
  createMainWindow();

  // Phase 7: reload every MCP server the user has configured into the
  // live registry. Lazy-connect — the child processes aren't spawned
  // until the user actually sends a chat that uses an attached server.
  void loadPersistedMcpServers();

  // Opt-in smoke test (set LOOM_MCP_SMOKE=1). Off by default as of
  // Phase 7 since users configure real servers via the Server Library.
  void runMcpSmokeTest();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('before-quit', () => {
  // Unblock any chat turns that are still awaiting user approval so
  // the app can quit cleanly.
  rejectAllPendingApprovals();
  // Cleanly tear down any MCP stdio subprocesses so they don't orphan
  // on SIGTERM. The promise is deliberately not awaited — Electron's
  // before-quit event is synchronous and we can't block it, but we at
  // least give every client a chance to start closing.
  void disconnectAllMcp();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
