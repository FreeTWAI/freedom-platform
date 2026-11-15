import { agentOperations } from '../../apps/platform-api/src/agent-allowlist.js';

export interface AgentDiscoveryScope {
  scope: string;
  operations: number;
}

export interface AgentDiscoveryDocument {
  format: 'freedom.agent-discovery/v1';
  name: string;
  api_base: string;
  openapi_url: string;
  guide_url: string;
  mcp_url: string;
  change_feed_url: string;
  change_ping: {
    format: 'freedom.agent-ping/v1';
    signature: 'hmac-sha256';
    key: 'sha256-hex-of-agent-token';
    settings: '#automation/agent';
    guide_url: string;
  };
  authentication: {
    scheme: 'bearer';
    header: 'Authorization';
    token_prefix: 'fw_agent_';
    issue_page: string;
  };
  scopes: AgentDiscoveryScope[];
  operation_count: number;
  guild_tools: {
    guide_url: string;
    jwks_url: string;
    template: string;
  };
  sdk: {
    client_url: string;
    operations_url: string;
    types: string;
  };
  development_map_url: string;
}

/** Build the public discovery document describing the member agent API for an origin. */
export function agentDiscovery(origin: string): AgentDiscoveryDocument {
  const base = origin.replace(/\/+$/, '');
  const counts = new Map<string, number>();
  let operationCount = 0;

  for (const op of agentOperations) {
    if (op.granted === false) continue;
    operationCount += 1;
    counts.set(op.scope, (counts.get(op.scope) ?? 0) + 1);
  }

  const scopes = [...counts.entries()]
    .filter(([, operations]) => operations > 0)
    .map(([scope, operations]) => ({ scope, operations }))
    .sort((a, b) => (a.scope < b.scope ? -1 : a.scope > b.scope ? 1 : 0));

  return {
    format: 'freedom.agent-discovery/v1',
    name: '自由工坊 Freedom Workshop',
    api_base: `${base}/api/v1`,
    openapi_url: `${base}/agent/openapi.json`,
    guide_url: `${base}/agent.md`,
    mcp_url: `${base}/api/v1/mcp`,
    change_feed_url: `${base}/api/v1/agent/events`,
    change_ping: {
      format: 'freedom.agent-ping/v1',
      signature: 'hmac-sha256',
      key: 'sha256-hex-of-agent-token',
      settings: '#automation/agent',
      guide_url: `${base}/agent.md#change-ping`,
    },
    authentication: {
      scheme: 'bearer',
      header: 'Authorization',
      token_prefix: 'fw_agent_',
      issue_page: `${base}/#automation/agent`,
    },
    scopes,
    operation_count: operationCount,
    guild_tools: {
      guide_url: `${base}/guild-tool.md`,
      jwks_url: `${base}/.well-known/guild-tool-jwks.json`,
      template: 'https://github.com/FreeTWAI/freedom-platform/tree/main/templates/guild-tool',
    },
    sdk: {
      client_url: `${base}/agent/sdk/v1/agent-client.mjs`,
      operations_url: `${base}/agent/sdk/v1/agent-operations.mjs`,
      types: 'packages/sdk/agent-client.d.mts',
    },
    development_map_url: `${base}/.well-known/freedom-development.json`,
  };
}
