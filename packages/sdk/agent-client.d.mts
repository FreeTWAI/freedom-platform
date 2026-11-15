export interface AgentOperation {
  readonly id: string;
  readonly method: string;
  readonly path: string;
  readonly scope: string;
  readonly if_match: boolean;
}

export type AgentFetcher = (input: string | URL | Request, init?: RequestInit) => Response | Promise<Response>;

export interface AgentClientOptions {
  baseUrl: string;
  token: string;
  fetcher?: AgentFetcher;
  timeoutMs?: number;
}

export interface AgentCallOptions {
  params?: Record<string, string>;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  ifMatch?: string;
  idempotencyKey?: string;
}

/** The change feed takes only a cursor; the server rejects any other query field. */
export interface AgentEventsOptions {
  after?: string;
}

export class AgentError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message?: string);
}

export interface AgentClient {
  readonly operations: readonly AgentOperation[];
  call<T = unknown>(operationId: string, options?: AgentCallOptions): Promise<T>;
  events<T = unknown>(options?: AgentEventsOptions): Promise<T>;
}

export function createAgentClient(options: AgentClientOptions): AgentClient;
