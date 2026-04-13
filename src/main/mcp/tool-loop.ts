import {
  listServers,
  listToolsForServer,
  callTool as callMcpTool
} from './registry';
import { requestApproval } from './approval';
import { conversationServersDb } from '../db';
import type { ProviderTool } from '../inference/provider';
import type { MCPToolContent } from '../../shared/types';

/**
 * Phase 6 tool-call machinery. The actual iteration loop lives in
 * the `chat:send` IPC handler (src/main/ipc/index.ts) so it has direct
 * access to the SQLite persistence layer and the per-conversation
 * streaming channel. This module only provides the stateless helpers.
 */

/**
 * Max number of provider.stream() turns the chat handler will run per
 * user message. Each turn can invoke tools, feed results back, and
 * ask the model to think again. Caps at 12 to prevent runaway loops
 * if a model keeps calling tools without converging.
 */
export const MAX_TOOL_ITERATIONS = 12;

/**
 * OpenAI-style tool names must match `^[a-zA-Z0-9_-]{1,64}$`. Our MCP
 * server ids contain characters outside that set (e.g. `smoke:fs`), so
 * we sanitise. The sanitised name is NOT reversible — we rely on the
 * lookup map returned alongside the tools to route calls back.
 */
function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);
}

/** Resolved mapping from sanitised tool name → real MCP tool location. */
export interface ToolRouteEntry {
  serverId: string;
  toolName: string;
}

export interface ActiveTools {
  /** Translated for the provider's `tools` request parameter. */
  tools: ProviderTool[];
  /** Lookup table for `routeToolCall()` to reverse the sanitisation. */
  routes: Map<string, ToolRouteEntry>;
}

/**
 * Collect the MCP tool catalog attached to a specific conversation.
 *
 * Phase 6 exposed every registered server to every chat as a
 * workaround — Phase 7 replaces that with real per-conversation
 * attachment driven by the `conversation_servers` join table. The
 * conversationId must be passed; a conversation with no attached
 * servers gets an empty tool list.
 */
export async function collectActiveTools(
  conversationId: string
): Promise<ActiveTools> {
  const tools: ProviderTool[] = [];
  const routes = new Map<string, ToolRouteEntry>();
  const seen = new Set<string>();

  // Load the attachment set once — conversations with zero attached
  // servers short-circuit and hand back an empty catalog.
  const attachedIds = new Set(conversationServersDb.list(conversationId));
  if (attachedIds.size === 0) {
    return { tools, routes };
  }

  const servers = listServers();
  for (const server of servers) {
    if (!server.config.enabled) continue;
    if (!attachedIds.has(server.config.id)) continue;
    let serverTools = server.tools;
    // Registry caches tools on connect — lazily populate if needed.
    if (serverTools.length === 0) {
      try {
        serverTools = await listToolsForServer(server.config.id);
      } catch (err) {
        console.warn(
          `[tool-loop] failed to list tools for ${server.config.id}:`,
          err instanceof Error ? err.message : err
        );
        continue;
      }
    }

    for (const t of serverTools) {
      let candidate = `${sanitize(server.config.id)}__${sanitize(t.name)}`;
      // Extremely unlikely but possible: two servers collide after
      // sanitisation. Add a numeric suffix until unique.
      let suffix = 1;
      while (seen.has(candidate)) {
        candidate = `${sanitize(server.config.id)}__${sanitize(t.name)}_${suffix}`;
        suffix++;
      }
      seen.add(candidate);
      tools.push({
        name: candidate,
        description: t.description ?? '',
        inputSchema: t.inputSchema
      });
      routes.set(candidate, { serverId: server.config.id, toolName: t.name });
    }
  }

  return { tools, routes };
}

export interface RouteToolCallContext {
  conversationId: string;
  messageId: string;
  signal?: AbortSignal;
}

/**
 * Resolve a provider-emitted tool call back to the real MCP server and
 * tool name, run it through the approval system, and invoke it.
 * Returns a plain-text flattening of the result suitable to hand back
 * to the model as a `role: 'tool'` message.
 *
 * Errors are NOT thrown — they're returned as text so the model can
 * see them in context and recover (e.g. retry with different args).
 * A user-denied call returns a clean "denied by user" string so the
 * model can reason about it rather than crashing the turn.
 */
export async function routeToolCall(
  routes: Map<string, ToolRouteEntry>,
  call: { id: string; name: string; arguments: unknown },
  ctx: RouteToolCallContext
): Promise<{ serverId: string; resultText: string; isError: boolean; durationMs: number | undefined }> {
  const route = routes.get(call.name);
  if (!route) {
    return {
      serverId: '',
      resultText: `Tool \`${call.name}\` is not available to this conversation.`,
      isError: true,
      durationMs: undefined
    };
  }

  const args =
    call.arguments && typeof call.arguments === 'object'
      ? (call.arguments as Record<string, unknown>)
      : {};

  // Gate the call through the approval subsystem. For conversations
  // with no stored policy and no global auto-approve flag, this
  // blocks on the user clicking one of the three buttons in the
  // inline approval card.
  let outcome;
  try {
    outcome = await requestApproval({
      conversationId: ctx.conversationId,
      messageId: ctx.messageId,
      serverId: route.serverId,
      toolName: route.toolName,
      args,
      signal: ctx.signal
    });
  } catch (err) {
    return {
      serverId: route.serverId,
      resultText: `Approval interrupted: ${err instanceof Error ? err.message : 'unknown error'}`,
      isError: true,
      durationMs: undefined
    };
  }

  if (outcome.kind === 'deny') {
    return {
      serverId: route.serverId,
      resultText: `The user denied permission to call ${route.toolName} on ${route.serverId}. Do not retry this specific call; ask the user for clarification or try a different approach.`,
      isError: true,
      durationMs: undefined
    };
  }

  try {
    const result = await callMcpTool(route.serverId, route.toolName, args);
    return {
      serverId: route.serverId,
      resultText: flattenContent(result.content),
      isError: result.isError === true,
      durationMs: result.durationMs
    };
  } catch (err) {
    return {
      serverId: route.serverId,
      resultText: `Error calling ${route.toolName}: ${err instanceof Error ? err.message : 'unknown error'}`,
      isError: true,
      durationMs: undefined
    };
  }
}

/**
 * Flatten MCP content blocks into a single string. Text blocks become
 * their text; image/audio/resource blocks become descriptive placeholders
 * because the current providers don't accept inline binary content in
 * tool-result messages. Phase 7+ may lift this for vision-capable models.
 */
export function flattenContent(content: MCPToolContent[]): string {
  if (!content || content.length === 0) return '(no content)';
  return content
    .map((c) => {
      switch (c.type) {
        case 'text':
          return c.text;
        case 'image':
          return `[image: ${c.mimeType}]`;
        case 'audio':
          return `[audio: ${c.mimeType}]`;
        case 'resource':
          return c.resource.text ?? `[resource: ${c.resource.uri}]`;
        default:
          return '';
      }
    })
    .filter((x) => x.length > 0)
    .join('\n');
}
