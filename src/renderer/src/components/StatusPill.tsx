import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { ChatStatusInfo } from '../../../shared/types';
import { cn } from '../lib/utils';

interface StatusPillProps {
  status: ChatStatusInfo;
}

/**
 * Inline progress indicator for an in-flight assistant turn.
 *
 * Renders a single pulsing dot + phase label + live elapsed-time
 * counter. The counter ticks at 250 ms without touching the store or
 * triggering parent re-renders — it's driven by local state with a
 * setInterval scoped to this component's lifetime.
 *
 * The parent (ChatView) renders StatusPill only when there IS a
 * status for the active message; the pill unmounts automatically
 * when the status clears, so there's no "stale state" concern.
 */
export function StatusPill({ status }: StatusPillProps) {
  const [elapsedMs, setElapsedMs] = useState<number>(
    Date.now() - status.startedAt
  );

  useEffect(() => {
    // Reset the counter whenever the phase or startedAt changes —
    // e.g. moving from 'thinking' → 'running_tool' resets the timer.
    setElapsedMs(Date.now() - status.startedAt);
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - status.startedAt);
    }, 250);
    return () => clearInterval(interval);
  }, [status.startedAt, status.phase, status.detail]);

  const label = buildLabel(status);

  return (
    <div
      className={cn(
        'mx-6 mb-1 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-[11px] text-primary'
      )}
    >
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
      </span>
      <span className="font-medium">{label}</span>
      <span className="font-mono tabular-nums text-primary/70">
        {formatElapsed(elapsedMs)}
      </span>
      {status.phase === 'loading_model' && (
        <Loader2 className="h-3 w-3 animate-spin" />
      )}
    </div>
  );
}

function buildLabel(status: ChatStatusInfo): string {
  switch (status.phase) {
    case 'waiting':
      return 'Waiting…';
    case 'loading_model':
      return status.detail
        ? `Loading ${status.detail} into memory…`
        : 'Loading model into memory…';
    case 'thinking':
      return 'Thinking…';
    case 'running_tool':
      return status.detail ? `Running ${status.detail}…` : 'Running tool…';
  }
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.max(0, ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remSeconds = Math.floor(seconds % 60);
  return `${minutes}m ${remSeconds}s`;
}
