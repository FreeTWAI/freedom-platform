import {GUILD_TOOLS} from './catalog';
import {guildRepository} from '../../../../modules/guild-workspace/repositories/registry';
import {guildRoute} from '../modules/guild-launchpad-route';
export function GuildToolDirectory({onOpen}:{onOpen:(hash:string)=>void}) {
 return <label className="field">公會工具<select aria-label="公會工具" value="" onChange={e=>{if(e.target.value)onOpen(guildRoute(e.target.value,'tools'));}}><option value="">選擇公會</option>{[...new Set(GUILD_TOOLS.map(t=>t.guild_key))].map(key=><option key={key} value={key}>{guildRepository(key)?.name??(key==='guild_games'?'小遊戲公會':'AR 互動公會')}</option>)}</select></label>;
}
