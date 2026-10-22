import type { Hono } from 'hono';
import type { Pool } from 'pg';
import type { Actor } from '../../../../modules/identity-membership/service.js';
import type { FreedomEnv } from '../env.js';
import type { PlatformRuntime } from '../runtime.js';

/** Host-owned dependencies. A feature registrar never installs authentication or changes flags. */
export type PlatformFeatureApp = Hono<{ Variables: { actor: Actor } }>;
export type PlatformFeatureContext = Readonly<{
  pool: Pool;
  origin: string;
  freedomEnv: FreedomEnv;
  runtime: PlatformRuntime;
  authNetwork: PlatformRuntime['sourceNetwork'];
}>;
