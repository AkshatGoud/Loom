import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Download,
  ExternalLink,
  Loader2,
  Play,
  RefreshCw,
  Sparkles,
  Terminal
} from 'lucide-react';
import { useOllama } from '../stores/ollama';
import { cn } from '../lib/utils';

interface OllamaOnboardingProps {
  onDismiss: () => void;
}

/**
 * Full-screen first-run flow that walks the user from "never heard of
 * Ollama" → "Ollama is running with a model pulled". Stays visible until
 * state === 'running' && hasModels, or until the user closes it manually
 * (we still gate the composer on ollama availability separately).
 */
export function OllamaOnboarding({ onDismiss }: OllamaOnboardingProps) {
  const status = useOllama((s) => s.status);
  const tryStart = useOllama((s) => s.tryStart);
  const refresh = useOllama((s) => s.refresh);

  const [copied, setCopied] = useState(false);
  const [starting, setStarting] = useState(false);

  // Auto-dismiss once Ollama is ready with at least one model — the user
  // doesn't need to see this screen again.
  useEffect(() => {
    if (status.state === 'running' && status.hasModels) {
      onDismiss();
    }
  }, [status.state, status.hasModels, onDismiss]);

  const handleCopy = (text: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleStart = async () => {
    setStarting(true);
    try {
      await tryStart();
    } finally {
      setStarting(false);
    }
  };

  const platform =
    typeof navigator !== 'undefined' && navigator.userAgent.includes('Win')
      ? 'win'
      : 'mac';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 p-6 backdrop-blur-sm">
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <header className="flex items-center gap-3 border-b border-border px-6 py-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1">
            <h2 className="text-base font-semibold">Set up local models</h2>
            <p className="text-xs text-muted-foreground">
              Loom uses Ollama to run models like Gemma 4 locally on your machine.
            </p>
          </div>
        </header>

        <div className="space-y-5 p-6">
          <StepIndicator status={status} />

          {status.state === 'checking' && (
            <div className="flex items-center gap-3 rounded-lg border border-border bg-secondary/40 p-4 text-sm">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span>Checking for Ollama…</span>
            </div>
          )}

          {status.state === 'not_installed' && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                We couldn&apos;t find Ollama on your {platform === 'win' ? 'Windows PC' : 'Mac'}. Install it first — it runs as a tiny background service and handles downloading + serving local LLMs.
              </p>

              {platform === 'mac' ? (
                <div className="space-y-3">
                  <div className="rounded-lg border border-border bg-secondary/30 p-3">
                    <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      <Terminal className="h-3 w-3" />
                      Terminal
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <code className="text-sm">brew install ollama</code>
                      <button
                        onClick={() => handleCopy('brew install ollama')}
                        className="rounded-md border border-border px-2 py-1 text-[11px] font-medium hover:bg-accent"
                      >
                        {copied ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Or{' '}
                    <a
                      href="https://ollama.com/download/mac"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      download the macOS installer
                      <ExternalLink className="h-3 w-3" />
                    </a>
                    .
                  </p>
                </div>
              ) : (
                <a
                  href="https://ollama.com/download/windows"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
                >
                  <Download className="h-4 w-4" />
                  Download Ollama for Windows
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}

              <button
                onClick={() => void refresh()}
                className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm transition hover:bg-accent"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Check again
              </button>
            </div>
          )}

          {status.state === 'installed_not_running' && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Ollama is installed but isn&apos;t running. Start it now and Loom will connect automatically.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => void handleStart()}
                  disabled={starting}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
                >
                  {starting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  {starting ? 'Starting…' : 'Start Ollama'}
                </button>
                <button
                  onClick={() => void refresh()}
                  className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm transition hover:bg-accent"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Check again
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Alternatively, open a terminal and run <code className="rounded bg-secondary/40 px-1 py-0.5">ollama serve</code>.
              </p>
            </div>
          )}

          {status.state === 'running' && !status.hasModels && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div className="text-sm">
                  <div className="font-medium">
                    Ollama {status.version} is running.
                  </div>
                  <div className="text-muted-foreground">
                    No models are installed yet. Pull one to start chatting.
                  </div>
                </div>
              </div>
              <div className="space-y-3">
                <div className="text-xs font-medium text-muted-foreground">
                  Recommended first pull:
                </div>
                <div className="rounded-lg border border-border bg-secondary/30 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-sm font-semibold">Gemma 4 E4B</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Google&apos;s newest frontier open model at a laptop-friendly size. 4-bit quantized, ~2.5 GB, multimodal, 256K context.
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 rounded-md bg-background/60 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <code className="text-xs">ollama pull gemma4:e4b</code>
                      <button
                        onClick={() => handleCopy('ollama pull gemma4:e4b')}
                        className="rounded-md border border-border px-2 py-1 text-[11px] font-medium hover:bg-accent"
                      >
                        {copied ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Phase 4 will add a built-in model library with a click-to-pull UI. For now, run the command above and come back.
                  </p>
                </div>
                <button
                  onClick={() => void refresh()}
                  className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm transition hover:bg-accent"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  I&apos;ve pulled a model
                </button>
              </div>
            </div>
          )}

          {status.state === 'running' && status.hasModels && (
            <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              <span className="flex-1">
                Ollama {status.version} is ready. Closing onboarding…
              </span>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end border-t border-border px-6 py-3">
          <button
            onClick={onDismiss}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Skip for now
          </button>
        </footer>
      </div>
    </div>
  );
}

function StepIndicator({ status }: { status: ReturnType<typeof useOllama.getState>['status'] }) {
  const steps: Array<{ label: string; active: boolean; done: boolean }> = [
    {
      label: 'Install',
      done:
        status.state === 'installed_not_running' || status.state === 'running',
      active: status.state === 'not_installed'
    },
    {
      label: 'Start',
      done: status.state === 'running',
      active: status.state === 'installed_not_running'
    },
    {
      label: 'Pull a model',
      done: status.state === 'running' && status.hasModels,
      active: status.state === 'running' && !status.hasModels
    }
  ];

  return (
    <ol className="flex items-center gap-2 text-[11px]">
      {steps.map((step, i) => (
        <li key={step.label} className="flex items-center gap-2">
          <span
            className={cn(
              'flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-semibold',
              step.done &&
                'border-primary bg-primary text-primary-foreground',
              step.active && !step.done && 'border-primary text-primary',
              !step.done && !step.active && 'border-border text-muted-foreground'
            )}
          >
            {step.done ? '✓' : i + 1}
          </span>
          <span
            className={cn(
              step.active || step.done
                ? 'text-foreground'
                : 'text-muted-foreground'
            )}
          >
            {step.label}
          </span>
          {i < steps.length - 1 && (
            <span className="mx-1 h-px w-4 bg-border" />
          )}
        </li>
      ))}
    </ol>
  );
}
