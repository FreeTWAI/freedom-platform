import {resolveFreedomEnv,type FreedomEnv} from '../../../apps/platform-api/src/env.js';
import {ReadinessError} from '../../../apps/platform-api/src/readiness.js';

export interface CommerceSettings {checkoutEnabled:boolean;consoleEnabled?:boolean;quarantine:boolean;providerProfiles:readonly string[];emailEnabled?:boolean}
export interface CommerceEnvironment {
  FREEDOM_ENV?:string;
  FREEDOM_COMMERCE_SELF_SHIP_ENABLED?:string;
  FREEDOM_COMMERCE_CHECKOUT_ENABLED?:string;
  FREEDOM_COMMERCE_ORDER_NOTIFICATIONS_ENABLED?:string;
  FREEDOM_COMMERCE_CONSOLE_ENABLED?:string;
  FREEDOM_COMMERCE_EMAIL_ENABLED?:string;
  FREEDOM_COMMERCE_QUARANTINE?:string;
  FREEDOM_GUILD_LAUNCHPAD_ENABLED?:string;
  FREEDOM_SUPPLIER_CONSOLE_ENABLED?:string;
  FREEDOM_COMMERCE_PROVIDER_PROFILES?:string;
}
/** PR-A refuses public startup until contact retention is installed and verified in PR-C. */
export function assertSelfShipReadiness(enabled:boolean,environment:FreedomEnv):void {
  if(enabled&&environment==='public')throw new ReadinessError('self_ship_retention_not_ready');
}
export function readCommerceSelfShipEnabled(env:CommerceEnvironment):boolean {
  const value=env.FREEDOM_COMMERCE_SELF_SHIP_ENABLED;
  if(value!==undefined&&value!=='true'&&value!=='false')throw new ReadinessError('commerce_self_ship_flag_invalid');
  if(value==='true'&&(env.FREEDOM_COMMERCE_CONSOLE_ENABLED!=='true'||env.FREEDOM_GUILD_LAUNCHPAD_ENABLED!=='true'))throw new ReadinessError('commerce_self_ship_console_required');
  if(value==='true'){
    let environment:FreedomEnv;
    try{environment=resolveFreedomEnv(env.FREEDOM_ENV);}catch{throw new ReadinessError('freedom_env_invalid');}
    assertSelfShipReadiness(true,environment);
  }
  return value==='true';
}
export const IMPLEMENTED_PROVIDER_PROFILES=Object.freeze(['ecpay.aio.credit.v1','offline.bank_transfer.v1','offline.cash_on_meetup.v1']);
/** Separate installation flag: keep the existing CommerceSettings wire/default shape unchanged. */
export function readCommerceOrderNotificationsEnabled(env:CommerceEnvironment):boolean {
  const flag=env.FREEDOM_COMMERCE_ORDER_NOTIFICATIONS_ENABLED;
  if(flag!==undefined&&flag!=='true'&&flag!=='false')throw new ReadinessError('commerce_order_notifications_flag_invalid');
  if(flag==='true'&&env.FREEDOM_COMMERCE_CHECKOUT_ENABLED!=='true')throw new ReadinessError('commerce_order_notifications_checkout_required');
  return flag==='true';
}
export function readProviderProfiles(raw:string|undefined):readonly string[]{
  if(raw===undefined||raw==='')return Object.freeze([]);
  if(typeof raw!=='string'||/\s/.test(raw))throw new ReadinessError('commerce_provider_profiles_invalid');
  const profiles=raw.split(',');
  if(new Set(profiles).size!==profiles.length||profiles.some(p=>!IMPLEMENTED_PROVIDER_PROFILES.includes(p)))throw new ReadinessError('commerce_provider_profiles_invalid');
  return Object.freeze(profiles);
}
/** The socket-based Node host has no installed external-effect journal. */
export function readNodeCommerceSettings(env:CommerceEnvironment):CommerceSettings{
  const settings=readCommerceSettings(env);
  if(settings.providerProfiles.some(profile=>profile.startsWith('ecpay.')))throw new ReadinessError('commerce_profiles_require_journal');
  if(settings.emailEnabled)throw new ReadinessError('commerce_email_requires_worker');
  return settings;
}
export function readCommerceSettings(env:CommerceEnvironment):CommerceSettings {
  readCommerceOrderNotificationsEnabled(env);
  readCommerceSelfShipEnabled(env);
  for(const flag of [env.FREEDOM_COMMERCE_CHECKOUT_ENABLED,env.FREEDOM_COMMERCE_CONSOLE_ENABLED,env.FREEDOM_COMMERCE_QUARANTINE,env.FREEDOM_COMMERCE_EMAIL_ENABLED]) {
    if(flag!==undefined&&flag!=='true'&&flag!=='false')throw new ReadinessError('Commerce flags must be true or false.');
  }
  if(env.FREEDOM_COMMERCE_CONSOLE_ENABLED==='true'&&env.FREEDOM_GUILD_LAUNCHPAD_ENABLED!=='true')throw new ReadinessError('commerce_launchpad_required');
  // Seller and supplier pages share a component, not a product activation flag.
  if(env.FREEDOM_COMMERCE_CHECKOUT_ENABLED==='true'&&env.FREEDOM_COMMERCE_CONSOLE_ENABLED!=='true')throw new ReadinessError('commerce_console_required');
  return {consoleEnabled:env.FREEDOM_COMMERCE_CONSOLE_ENABLED==='true',checkoutEnabled:env.FREEDOM_COMMERCE_CHECKOUT_ENABLED==='true',quarantine:env.FREEDOM_COMMERCE_QUARANTINE==='true',providerProfiles:readProviderProfiles(env.FREEDOM_COMMERCE_PROVIDER_PROFILES),emailEnabled:env.FREEDOM_COMMERCE_EMAIL_ENABLED==='true'};
}
