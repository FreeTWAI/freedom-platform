import { z } from 'zod';
import { githubCoordinate, publicRepositoryJson, concealedRepository } from '../../opensource-marketing/github.js';
import { requireCondition } from '../../../packages/shared/problem.js';
import type { AdapterContext, RepositoryFacts, ShareAdapter } from '../types.js';
const counter=z.number().int().nonnegative().safe();
const metricShape=z.object({stargazers_count:counter,forks_count:counter,open_issues_count:counter,subscribers_count:counter,pushed_at:z.iso.datetime().nullable(),language:z.string().max(100).nullable(),archived:z.literal(false)});
const repo = z.object({id:z.number().int().positive().safe(),full_name:z.string().max(140),private:z.literal(false),visibility:z.literal('public'),archived:z.literal(false),fork:z.boolean(),owner:z.object({id:z.number().int().positive().safe(),login:z.string().max(100)}),default_branch:z.string().min(1).max(255),description:z.string().max(10000).nullable().optional(),stargazers_count:z.number().int().nonnegative().safe(),topics:z.array(z.string().max(100)).max(100).default([]),homepage:z.string().nullable().optional(),license:z.object({spdx_id:z.string()}).nullable().optional(),source:z.object({full_name:z.string()}).optional(),parent:z.object({full_name:z.string()}).optional()});
export async function repositoryFacts(url:string,context:AdapterContext={}):Promise<RepositoryFacts> {
  let name=githubCoordinate(url);
  const seen=new Set<string>(),signal=AbortSignal.timeout(8000);
  for(let depth=0;depth<5;depth++) {
    requireCondition(!seen.has(name.toLowerCase()),422,'repository_cycle','無法確認原作。');seen.add(name.toLowerCase());
    const raw=await publicRepositoryJson(`/repos/${name}`,signal,context.fetcher??fetch,false,196608,context.token);
    requireCondition(!concealedRepository(raw),422,'github_repository_unavailable','原作已不公開。');
    const parsed=repo.safeParse(raw);
    requireCondition(parsed.success,422,'github_repository_unavailable','請分享公開且未封存的原作。');
    const r=parsed.data; const full=githubCoordinate(`https://github.com/${r.full_name}`);
    if(r.fork) {
      const source=r.source?.full_name??r.parent?.full_name;
      requireCondition(source,422,'original_repository_missing','無法確認原作。');
      name=githubCoordinate(`https://github.com/${source}`);continue;
    }
    const metrics=metricShape.safeParse(raw);
    return {...(metrics.success?{metrics:{...metrics.data,repository_identity:{id:String(r.id),full_name:full,owner_id:String(r.owner.id)}}}:{}),id:String(r.id),full_name:full,url:`https://github.com/${full}`,description:r.description??'',archived:false,fork:false,owner_id:String(r.owner.id),owner_login:r.owner.login,default_branch:r.default_branch,stars:r.stargazers_count,topics:r.topics,homepage:r.homepage??null,license_spdx:r.license?.spdx_id??null};
  }
  throw new Error('repository_resolution_limit');
}
export const repositoryAdapter:ShareAdapter={kind:'repository',async prepare(input,context){
  const repository=await repositoryFacts(input.url??'',context);
  return {kind:'repository',canonical_key:`github:${repository.id}`,canonical_url:repository.url,title:repository.full_name,repository};
}};
