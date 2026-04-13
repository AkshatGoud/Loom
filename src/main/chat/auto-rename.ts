import OpenAI from 'openai';
import { conversationsDb } from '../db';
import { getOllamaStatus, OLLAMA_BASE_URL } from '../ollama/daemon';
import type { Conversation } from '../../shared/types';

/**
 * Phase 7 — automatic chat title derivation.
 *
 * Two-stage:
 *
 *   1. `deriveImmediateTitle(userMessage)` — deterministic, no LLM.
 *      Strip leading/trailing whitespace + punctuation, take up to
 *      MAX_CHARS, truncate at the last word boundary, drop trailing
 *      punctuation. Fires inside `chat:send` BEFORE the provider is
 *      invoked so the sidebar title updates instantly.
 *
 *   2. `refineTitleWithLLM(conversationId, userMessage, model)` —
 *      fires in the background AFTER the first assistant turn
 *      completes cleanly. Makes a short non-streaming
 *      /v1/chat/completions call against the same Ollama model and
 *      updates the title a second time if the response is usable.
 *      Non-blocking; any failure is silently logged and swallowed.
 *
 * Both stages respect `conversations.title_manually_set`: if the user
 * has ever edited the title themselves, auto-rename is locked out
 * permanently for that conversation.
 *
 * Auto-rename ONLY triggers when the current title matches the
 * default literal "New conversation" — it never overwrites a title
 * the user picked or a previously-generated title, and it's an
 * absolute no-op on pre-existing chats from before Phase 7.
 */

const AUTO_RENAME_DEFAULT_TITLE = 'New conversation';
const MAX_IMMEDIATE_CHARS = 60;

// ----- Stage 1: deterministic -----

export function deriveImmediateTitle(userMessage: string): string {
  const trimmed = userMessage
    .replace(/^[\s\p{P}]+/u, '')
    .replace(/[\s\p{P}]+$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!trimmed) return AUTO_RENAME_DEFAULT_TITLE;
  if (trimmed.length <= MAX_IMMEDIATE_CHARS) return trimmed;

  // Cut at the last word boundary before MAX_IMMEDIATE_CHARS to avoid
  // mid-word clipping, then strip the inevitable trailing punctuation.
  const window = trimmed.slice(0, MAX_IMMEDIATE_CHARS);
  const lastSpace = window.lastIndexOf(' ');
  const boundary = lastSpace > 20 ? lastSpace : window.length;
  return window.slice(0, boundary).replace(/[\s\p{P}]+$/u, '');
}

/**
 * Runs stage 1 synchronously. Returns the new title if one was
 * applied, or null if auto-rename was not eligible (flag set,
 * conversation missing, or current title isn't the default).
 */
export function applyImmediateAutoRename(
  conversationId: string,
  userMessage: string
): string | null {
  const convo = conversationsDb.get(conversationId);
  if (!convo) return null;
  if (convo.title !== AUTO_RENAME_DEFAULT_TITLE) return null;
  if (!conversationsDb.canAutoRename(conversationId)) return null;

  const title = deriveImmediateTitle(userMessage);
  if (!title || title === AUTO_RENAME_DEFAULT_TITLE) return null;

  const ok = conversationsDb.setAutoTitle(conversationId, title);
  return ok ? title : null;
}

// ----- Stage 2: async LLM refinement -----

const REFINE_PROMPT = (userMessage: string) =>
  `Summarise the following user request as a short chat title. ` +
  `Reply with ONLY the title, 3 to 6 words, no quotes, no trailing period, no markdown.\n\n` +
  `Request: ${userMessage}`;

function cleanTitle(raw: string): string {
  return raw
    .split('\n')[0]
    .replace(/^["'`\s]+|["'`\s.]+$/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 80)
    .trim();
}

/**
 * Fire-and-forget LLM refinement. Only runs for Ollama conversations
 * (no token cost) — cloud BYOK providers skip this step until a
 * user-facing toggle exists in Phase 10's polish pass.
 *
 * Swallows every error: a failed refinement just leaves the stage-1
 * deterministic title in place, which is always a sensible fallback.
 */
export async function refineTitleWithLLM(
  conversation: Conversation,
  userMessage: string
): Promise<string | null> {
  if (conversation.provider !== 'ollama') return null;
  if (!conversationsDb.canAutoRename(conversation.id)) return null;

  const status = await getOllamaStatus();
  if (status.state !== 'running') return null;

  try {
    const client = new OpenAI({
      baseURL: `${OLLAMA_BASE_URL}/v1`,
      apiKey: 'ollama'
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);

    const response = await client.chat.completions.create(
      {
        model: conversation.modelId,
        messages: [{ role: 'user', content: REFINE_PROMPT(userMessage) }],
        temperature: 0.3,
        max_tokens: 24,
        stream: false
      },
      { signal: controller.signal }
    );
    clearTimeout(timer);

    const rawTitle = response.choices[0]?.message?.content ?? '';
    const title = cleanTitle(rawTitle);
    if (!title || title.length < 3) return null;

    // Apply only if the user hasn't edited since we kicked off —
    // setAutoTitle already enforces this but the early return keeps
    // us from broadcasting a stale event.
    if (!conversationsDb.canAutoRename(conversation.id)) return null;

    const ok = conversationsDb.setAutoTitle(conversation.id, title);
    return ok ? title : null;
  } catch (err) {
    console.log(
      '[auto-rename] refinement skipped:',
      err instanceof Error ? err.message : err
    );
    return null;
  }
}
