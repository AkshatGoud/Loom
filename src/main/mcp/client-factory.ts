import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { MCPServerConfig } from '../../shared/types';

/**
 * The client advertises itself to every connected MCP server as `loom`
 * with the current app version. Servers can use this in their logs and
 * (eventually) in server-side logic that gates features per-client.
 */
const CLIENT_INFO = {
  name: 'loom',
  version: '0.1.0'
};

/**
 * Build a fresh `Client` + `Transport` pair for a given server config.
 * The caller is responsible for calling `client.connect(transport)`;
 * this factory just assembles them so the registry can wire error /
 * close handlers onto the transport BEFORE starting it.
 *
 * Phase 5 only implements the stdio path. Phase 8 adds the Streamable
 * HTTP path by extending the discriminated-union check below.
 */
export function createClient(config: MCPServerConfig): {
  client: Client;
  transport: Transport;
} {
  const client = new Client(CLIENT_INFO, {
    capabilities: {
      // Loom doesn't currently offer sampling or elicitation to servers.
      // Phase 7+ may extend this.
    }
  });

  let transport: Transport;
  switch (config.transport) {
    case 'stdio':
      transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: config.env,
        // Inherit stderr so Ollama-ish child logs are visible in the main-process console.
        stderr: 'inherit'
      });
      break;
    case 'http':
      // Reserved for Phase 8 (Streamable HTTP + BYO remote servers).
      throw new Error(
        'HTTP transport not implemented yet — added in Phase 8'
      );
    default: {
      const exhaustive: never = config;
      throw new Error(`Unknown MCP transport: ${JSON.stringify(exhaustive)}`);
    }
  }

  return { client, transport };
}
