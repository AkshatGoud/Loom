import { BrowserWindow } from 'electron';
import { OLLAMA_BASE_URL, getOllamaStatus } from './daemon';
import type {
  InstalledModel,
  ModelPullProgress,
  ModelShowDetails
} from '../../shared/types';

// ----- Typed response shapes -----

interface TagsResponse {
  models: Array<{
    name: string;
    modified_at: string;
    size: number;
    digest: string;
    details?: {
      family?: string;
      parameter_size?: string;
      quantization_level?: string;
    };
  }>;
}

interface ShowResponse {
  modelfile?: string;
  parameters?: string;
  template?: string;
  details?: {
    parent_model?: string;
    format?: string;
    family?: string;
    families?: string[];
    parameter_size?: string;
    quantization_level?: string;
  };
  model_info?: Record<string, unknown>;
  capabilities?: string[];
}

// ----- /api/tags → InstalledModel[] -----

export async function listInstalledModels(): Promise<InstalledModel[]> {
  const status = await getOllamaStatus();
  if (status.state !== 'running') return [];

  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
    if (!res.ok) return [];
    const data = (await res.json()) as TagsResponse;
    return (data.models ?? []).map((m) => ({
      id: m.name,
      displayName: m.details?.parameter_size
        ? `${m.name} (${m.details.parameter_size})`
        : m.name,
      sizeBytes: m.size,
      digest: m.digest,
      family: m.details?.family ?? null,
      parameterSize: m.details?.parameter_size ?? null,
      quantLevel: m.details?.quantization_level ?? null,
      modifiedAt: Date.parse(m.modified_at) || Date.now()
    }));
  } catch {
    return [];
  }
}

// ----- /api/show → ModelShowDetails -----

export async function showModel(
  name: string
): Promise<ModelShowDetails | null> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    if (!res.ok) return null;
    const data = (await res.json()) as ShowResponse;
    return {
      name,
      family: data.details?.family ?? null,
      parameterSize: data.details?.parameter_size ?? null,
      quantLevel: data.details?.quantization_level ?? null,
      format: data.details?.format ?? null,
      capabilities: data.capabilities ?? [],
      parameters: data.parameters ?? null,
      template: data.template ?? null
    };
  } catch {
    return null;
  }
}

// ----- /api/delete -----

export async function deleteModel(name: string): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/delete`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ----- /api/pull (streaming NDJSON) -----

// Per-pull AbortController so the renderer can cancel in-flight downloads.
const pullControllers = new Map<string, AbortController>();

function sendProgress(progress: ModelPullProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('ollama:pullProgress', progress);
  }
}

/**
 * Stream an Ollama model pull and forward every progress tick to the
 * renderer as an `ollama:pullProgress` IPC event. Resolves when the pull
 * completes (success or error). Multiple pulls can run concurrently —
 * each is keyed by tag in `pullControllers`.
 */
export async function pullModel(name: string): Promise<void> {
  if (pullControllers.has(name)) {
    // Already pulling — no-op rather than double-stream.
    return;
  }

  const controller = new AbortController();
  pullControllers.set(name, controller);

  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, stream: true }),
      signal: controller.signal
    });

    if (!res.ok || !res.body) {
      sendProgress({
        name,
        status: 'error',
        error: `Pull failed with HTTP ${res.status}`
      });
      return;
    }

    // NDJSON: one JSON object per newline.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);
        if (!line) continue;
        try {
          const chunk = JSON.parse(line) as {
            status?: string;
            digest?: string;
            total?: number;
            completed?: number;
            error?: string;
          };
          if (chunk.error) {
            sendProgress({ name, status: 'error', error: chunk.error });
            continue;
          }
          sendProgress({
            name,
            status: chunk.status ?? 'downloading',
            digest: chunk.digest,
            total: chunk.total,
            completed: chunk.completed
          });
        } catch {
          // Ignore malformed chunks — Ollama occasionally emits partial lines.
        }
      }
    }

    sendProgress({ name, status: 'success' });
    // Pulling changed /api/tags — refresh the daemon status so the renderer
    // picks up the new model.
    await getOllamaStatus();
  } catch (err) {
    if (controller.signal.aborted) {
      sendProgress({ name, status: 'cancelled' });
      return;
    }
    sendProgress({
      name,
      status: 'error',
      error: err instanceof Error ? err.message : 'Unknown error'
    });
  } finally {
    pullControllers.delete(name);
  }
}

export function cancelPull(name: string): void {
  pullControllers.get(name)?.abort();
}
