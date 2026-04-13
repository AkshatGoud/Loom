import { spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type {
  LoadedOllamaModel,
  OllamaStatus,
  OllamaDaemonState
} from '../../shared/types';

// Ollama's default loopback address. We don't let users override this yet —
// the one place that would matter is the OLLAMA_HOST env var, which we
// deliberately respect if set (falling back to localhost).
export const OLLAMA_BASE_URL =
  process.env.OLLAMA_HOST && process.env.OLLAMA_HOST.startsWith('http')
    ? process.env.OLLAMA_HOST.replace(/\/$/, '')
    : 'http://127.0.0.1:11434';

interface VersionResponse {
  version: string;
}

interface TagsResponse {
  models: Array<{ name: string; size: number; digest: string }>;
}

interface PsResponse {
  models: Array<{ name: string; model: string; size: number; size_vram: number }>;
}

async function fetchJson<T>(path: string, timeoutMs = 1500): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}${path}`, {
      signal: controller.signal
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Returns true if the Ollama daemon is reachable at /api/version.
 */
async function probeDaemon(): Promise<string | null> {
  const res = await fetchJson<VersionResponse>('/api/version');
  return res?.version ?? null;
}

/**
 * Best-effort detection for whether the `ollama` binary is installed,
 * even if the daemon isn't currently running. Covers the common macOS and
 * Windows install locations. On macOS it also checks the app bundle path
 * used by Ollama's native menu-bar app.
 */
function isOllamaInstalled(): boolean {
  const candidates: string[] = [];
  if (process.platform === 'darwin') {
    candidates.push(
      '/opt/homebrew/bin/ollama',
      '/usr/local/bin/ollama',
      '/Applications/Ollama.app/Contents/Resources/ollama',
      join(homedir(), '.ollama/bin/ollama')
    );
  } else if (process.platform === 'win32') {
    candidates.push(
      join(
        process.env['LOCALAPPDATA'] ?? '',
        'Programs',
        'Ollama',
        'ollama.exe'
      ),
      join(process.env['ProgramFiles'] ?? '', 'Ollama', 'ollama.exe')
    );
  } else {
    candidates.push('/usr/local/bin/ollama', '/usr/bin/ollama');
  }

  for (const p of candidates) {
    if (!p) continue;
    try {
      accessSync(p, constants.X_OK);
      return true;
    } catch {
      /* not at this path */
    }
  }
  return false;
}

async function buildStatus(): Promise<OllamaStatus> {
  const version = await probeDaemon();

  if (version) {
    // Tags and ps are independent — fetch in parallel.
    const [tags, ps] = await Promise.all([
      fetchJson<TagsResponse>('/api/tags'),
      fetchJson<PsResponse>('/api/ps')
    ]);
    const hasModels = (tags?.models?.length ?? 0) > 0;
    const loadedModels: LoadedOllamaModel[] = (ps?.models ?? []).map((m) => ({
      name: m.name,
      sizeVram: m.size_vram
    }));
    return {
      state: 'running',
      version,
      message: hasModels
        ? `Ollama ${version} ready.`
        : `Ollama ${version} is running but no models are pulled yet.`,
      hasModels,
      firstModel: tags?.models?.[0]?.name ?? null,
      loadedModels
    };
  }

  const installed = isOllamaInstalled();
  const state: OllamaDaemonState = installed
    ? 'installed_not_running'
    : 'not_installed';

  return {
    state,
    version: null,
    message: installed
      ? 'Ollama is installed but not currently running.'
      : 'Ollama was not detected on this machine.',
    hasModels: false,
    firstModel: null,
    loadedModels: []
  };
}

// ----- Public API -----

let lastStatus: OllamaStatus | null = null;
const listeners = new Set<(status: OllamaStatus) => void>();

function loadedNames(s: OllamaStatus): string {
  return s.loadedModels.map((m) => m.name).sort().join(',');
}

export async function getOllamaStatus(): Promise<OllamaStatus> {
  const status = await buildStatus();
  const changed =
    !lastStatus ||
    lastStatus.state !== status.state ||
    lastStatus.version !== status.version ||
    lastStatus.hasModels !== status.hasModels ||
    loadedNames(lastStatus) !== loadedNames(status);
  lastStatus = status;
  if (changed) {
    for (const l of listeners) l(status);
  }
  return status;
}

export function subscribeOllamaStatus(
  handler: (status: OllamaStatus) => void
): () => void {
  listeners.add(handler);
  return () => listeners.delete(handler);
}

/**
 * Try to start Ollama as a detached background process. Only does anything
 * in the 'installed_not_running' state — otherwise returns the current
 * status unchanged. Because the child is detached, quitting Loom will
 * leave Ollama running, which is the desired behaviour.
 */
export async function tryStartOllama(): Promise<OllamaStatus> {
  const current = await getOllamaStatus();
  if (current.state !== 'installed_not_running') return current;

  try {
    const child = spawn('ollama', ['serve'], {
      detached: true,
      stdio: 'ignore',
      shell: process.platform === 'win32'
    });
    child.unref();
  } catch {
    return current; // permission denied, PATH issue, etc.
  }

  // Poll the daemon for up to 5s while it boots.
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const status = await getOllamaStatus();
    if (status.state === 'running') return status;
  }
  return getOllamaStatus();
}

/**
 * Start a periodic background probe so the renderer can react to
 * out-of-band daemon state changes (e.g. user quits Ollama from the menu
 * bar). Runs forever; call at app startup.
 */
export function startHealthWatcher(intervalMs = 15_000): void {
  void getOllamaStatus(); // initial
  setInterval(() => {
    void getOllamaStatus();
  }, intervalMs);
}

/**
 * Evict a single model from Ollama's resident memory. Equivalent to
 * `ollama stop <model>` on the CLI. Ollama's documented mechanism for this
 * is to POST /api/generate with an empty prompt and keep_alive: 0 — that
 * signals "forget this model's weights now, don't keep them warm".
 *
 * Returns the refreshed status so callers can update the UI atomically.
 */
export async function unloadOllamaModel(model: string): Promise<OllamaStatus> {
  try {
    await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, keep_alive: 0 })
    });
  } catch {
    /* daemon unreachable — the refresh below will reflect reality */
  }
  return getOllamaStatus();
}

/**
 * Evict every model currently in memory. Iterates whatever /api/ps
 * reports and sends keep_alive: 0 for each. Safe to call when nothing is
 * loaded (no-op).
 */
export async function unloadAllOllamaModels(): Promise<OllamaStatus> {
  const current = lastStatus ?? (await getOllamaStatus());
  await Promise.all(
    current.loadedModels.map((m) =>
      fetch(`${OLLAMA_BASE_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: m.name, keep_alive: 0 })
      }).catch(() => undefined)
    )
  );
  return getOllamaStatus();
}
