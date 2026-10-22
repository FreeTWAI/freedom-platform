import { z } from 'zod';
import type { Command } from '../../../../packages/db/index.js';
import { requireCondition } from '../../../../packages/shared/problem.js';

// Legacy route-based command identity is intentionally unchanged.
export const cmd=async(c:any):Promise<Command>=>{
    const ifMatch=c.req.header('If-Match') as string|undefined;
    if(ifMatch) requireCondition(/^"[1-9][0-9]*"$/.test(ifMatch),400,'invalid_version','If-Match 須為加引號的整數版本。');
    return {actor:c.get('actor'),operation:`${c.req.method} ${c.req.path}`,key:c.req.header('Idempotency-Key')??'',body:await c.req.json(),expected:ifMatch?.slice(1,-1)};
  };
export const routeId=(c:any,name='id')=>z.uuid().parse(c.req.param(name).split(':')[0]);
export const respond=(c:any,value:any,status=200)=>{if(value?.aggregate_version)c.header('ETag',`"${value.aggregate_version}"`);return c.json(value,status);};
