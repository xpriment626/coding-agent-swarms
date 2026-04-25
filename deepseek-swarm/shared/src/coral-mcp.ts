import { createMCPClient } from '@ai-sdk/mcp';
import { Client as McpSdkClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export type AiSdkMcpClient = Awaited<ReturnType<typeof createMCPClient>>;

/**
 * AI SDK MCP client over streamable HTTP. Used for Coral (no headers needed)
 * and Exa (`x-api-key`). The AI SDK client gives us `.tools()` returning a
 * dict of pre-typed tools we can merge straight into generateText.
 */
export async function createMcpClientHttp(
  url: string,
  headers: Record<string, string> = {},
): Promise<AiSdkMcpClient> {
  return createMCPClient({
    transport: {
      type: 'http',
      url,
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    },
  });
}

/**
 * Direct MCP SDK client (not wrapped through AI SDK). We need this for
 * `readResource` calls — Coral exposes `coral://instruction` and
 * `coral://state` as resources, not tools. AI SDK's MCP wrapper only
 * surfaces tools, so resource access goes through the official SDK.
 */
export async function createCoralResourceClient(url: string): Promise<{
  client: McpSdkClient;
  close: () => Promise<void>;
}> {
  const transport = new StreamableHTTPClientTransport(new URL(url));
  const client = new McpSdkClient(
    { name: 'swarm-coral-resource-client', version: '0.1.0' },
    { capabilities: {} },
  );
  await client.connect(transport);
  return {
    client,
    close: async () => {
      await client.close().catch(() => {});
    },
  };
}

/**
 * Replaces `<resource>coral://...</resource>` placeholders in `original`
 * with the live resource contents fetched from the MCP server. This is how
 * the agent's system prompt sees current Coral session state (mentions,
 * unread messages, peer agents) on every iteration without us hand-rolling
 * a poll-and-format step.
 */
export async function injectMcpResources(
  client: McpSdkClient,
  original: string,
): Promise<string> {
  const re = /<resource>(.*?)<\/resource>/g;
  const matches = [...original.matchAll(re)];
  if (matches.length === 0) return original;

  let out = original;
  for (const m of matches) {
    const uri = m[1];
    if (!uri) continue;
    try {
      const result = await client.readResource({ uri });
      const body = result.contents
        .map((c: any) => (typeof c.text === 'string' ? c.text : ''))
        .join('\n');
      out = out.replace(m[0], `<resource uri="${uri}">\n${body}\n</resource>`);
    } catch (e) {
      out = out.replace(
        m[0],
        `<resource uri="${uri}">\n[ERROR reading resource: ${(e as Error).message}]\n</resource>`,
      );
    }
  }
  return out;
}
