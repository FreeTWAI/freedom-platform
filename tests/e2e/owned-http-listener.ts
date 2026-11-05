import {Server} from 'node:http';

/** Retire each owned fixture connection without changing request deadlines or replaying writes. */
export function useSingleRequestConnections(server: unknown): void {
  if (!(server instanceof Server)) throw new Error('Owned fixture requires an HTTP/1 server.');
  server.maxRequestsPerSocket = 1;
}
