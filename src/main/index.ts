import { app, BrowserWindow, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initDb } from './db';
import { registerIpcHandlers } from './ipc';
import { registerProvider } from './inference/provider';
import { openAiProvider } from './inference/openai';
import { ollamaProvider } from './inference/ollama';
import { startHealthWatcher } from './ollama/daemon';

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
    mainWindow.webContents.openDevTools({ mode: 'right' });
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  initDb();
  registerProvider(ollamaProvider);
  registerProvider(openAiProvider);
  registerIpcHandlers();
  startHealthWatcher();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
