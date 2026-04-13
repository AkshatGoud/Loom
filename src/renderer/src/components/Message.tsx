import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Bot, Terminal, User } from 'lucide-react';
import type { Message as MessageType } from '../../../shared/types';
import { cn } from '../lib/utils';
import {
  AssistantToolCallsBadge,
  ToolResultBadge
} from './mcp/ToolBadge';

interface MessageProps {
  message: MessageType;
  isStreaming?: boolean;
}

export function Message({ message, isStreaming }: MessageProps) {
  if (message.role === 'system') return null;

  // Tool-result messages get their own compact lane with a dedicated
  // icon and the ToolResultBadge rendering the payload.
  if (message.role === 'tool') {
    return (
      <div className="flex gap-3 px-6 py-3 bg-secondary/10">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-secondary/60">
          <Terminal className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Tool result
          </div>
          <ToolResultBadge message={message} />
        </div>
      </div>
    );
  }

  const isUser = message.role === 'user';
  const hasToolCalls = message.toolCalls && message.toolCalls.length > 0;

  return (
    <div
      className={cn(
        'flex gap-3 px-6 py-4',
        isUser ? 'bg-background' : 'bg-card/40'
      )}
    >
      <div
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border',
          isUser ? 'bg-secondary text-secondary-foreground' : 'bg-primary text-primary-foreground'
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <div className="min-w-0 flex-1 pt-1">
        <div className="mb-1 text-xs font-medium text-muted-foreground">
          {isUser ? 'You' : 'Assistant'}
          {isStreaming && (
            <span className="ml-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-primary">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
              streaming
            </span>
          )}
        </div>
        {message.content && (
          <div className="prose prose-sm prose-invert max-w-none [&_pre]:bg-secondary/60 [&_pre]:p-3 [&_pre]:rounded-md [&_code]:text-[0.85em] [&_p]:leading-relaxed">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        )}
        {!message.content && !hasToolCalls && isStreaming && (
          <span className="text-muted-foreground">…</span>
        )}
        {!message.content && !hasToolCalls && !isStreaming && (
          <span className="italic text-muted-foreground">(empty)</span>
        )}
        {hasToolCalls && (
          <div className={cn('space-y-1.5', message.content && 'mt-2')}>
            <AssistantToolCallsBadge toolCalls={message.toolCalls!} />
          </div>
        )}
        {message.tokensPrompt != null && message.tokensCompletion != null && (
          <div className="mt-2 text-[10px] text-muted-foreground">
            {message.tokensPrompt} prompt · {message.tokensCompletion} completion
          </div>
        )}
      </div>
    </div>
  );
}
