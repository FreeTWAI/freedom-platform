import {Hono} from 'hono';
import {Problem} from '../../../../packages/shared/problem.js';
import {createSkillInstallBundleLoader,type SkillInstallFallbackRecord} from '../../../../modules/skill-install/index.js';
import type {SkillBook} from '../../../../modules/community/catalog.js';

export type SkillInstallRouteOptions={
  onFallback?:(record:SkillInstallFallbackRecord)=>void;
};

export function createSkillInstallRoutes(fetcher:typeof fetch=globalThis.fetch,readToken?:()=>string|null|undefined,books?:readonly SkillBook[],options?:SkillInstallRouteOptions){
  const app=new Hono();
  const load=createSkillInstallBundleLoader(fetcher,readToken,books,options?.onFallback);
  app.get('/api/v1/skills/:id/install-bundle',async c=>{
    try{
      const bundle=await load(c.req.param('id'));
      // The bundle is pinned to an immutable commit; a catalog bump changes the commit, not this response.
      c.header('Cache-Control','public, max-age=3600');
      return c.json(bundle);
    }catch(error){
      if(!(error instanceof Problem))throw error;
      if(error.retryAfterSeconds)c.header('Retry-After',String(error.retryAfterSeconds));
      c.header('Cache-Control','no-store');
      return c.json({error:error.code,message:error.message},error.status as 404|422|502|503);
    }
  });
  return app;
}
