#!/usr/bin/env node
import { generateKeyPairSync, randomUUID } from 'node:crypto';

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
process.stdout.write(JSON.stringify({ ...privateKey.export({ format: 'jwk' }), kid: randomUUID(), alg: 'ES256', use: 'sig' }) + '\n');
