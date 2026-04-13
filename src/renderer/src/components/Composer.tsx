import { useRef, useState, type KeyboardEvent } from 'react';
import { Send, Square } from 'lucide-react';
import { cn } from '../lib/utils';

interface ComposerProps {
  disabled?: boolean;
  streaming: boolean;
  onSend: (content: string) => void;
  onStop: () => void;
}

export function Composer({
  disabled,
  streaming,
  onSend,
  onStop
}: ComposerProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const submit = (): void => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="border-t border-border bg-card/40 px-6 py-4">
      <div className="relative mx-auto max-w-3xl">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            e.target.style.height = 'auto';
            e.target.style.height = `${Math.min(e.target.scrollHeight, 240)}px`;
          }}
          onKeyDown={handleKeyDown}
          placeholder={
            disabled
              ? 'Model is not reachable — check the onboarding screen…'
              : 'Message the model…  (Enter to send, Shift+Enter for newline)'
          }
          disabled={disabled}
          rows={1}
          className={cn(
            'w-full resize-none rounded-xl border border-border bg-background px-4 py-3 pr-14 text-sm outline-none transition focus:ring-1 focus:ring-ring',
            'disabled:cursor-not-allowed disabled:opacity-60'
          )}
        />
        {streaming ? (
          <button
            onClick={onStop}
            aria-label="Stop generating"
            className="absolute bottom-3 right-3 flex h-8 w-8 items-center justify-center rounded-md bg-destructive text-destructive-foreground transition hover:opacity-90"
          >
            <Square className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={disabled || value.trim().length === 0}
            aria-label="Send message"
            className="absolute bottom-3 right-3 flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
