import {HostedDistribution} from './HostedDistribution';
import {PartnerMaterials} from '../../../../modules/agent-commerce/supplier-console/ui/partner/PartnerMaterials';
import type {PortalClient} from '../api';
import type {StoreAreaData, StoreArea} from './hosted-store-area-shared';

export interface HostedStoreCooperationAreaProps {
  area: StoreArea;
  view: NonNullable<StoreAreaData['view']>;
  supplyOfferPhotosEnabled: boolean;
  client: PortalClient;
  root: string;
  distributionRefresh: StoreAreaData['distributionRefresh'];
  areaLocked: boolean;
  can: (key: string) => boolean;
  markDirty: (id: string, value: boolean) => void;
  command: StoreAreaData['command'];
  leaveOk: () => boolean;
  load: StoreAreaData['load'];
  consoleEnabled: boolean;
  userId: string;
  tenantId: string;
  instanceId: string;
  materialMediaEnabled: boolean;
  distributionPhotosEnabled: boolean;
}

export function HostedStoreCooperationArea({
  area, view, supplyOfferPhotosEnabled, client, root, distributionRefresh, areaLocked,
  can, markDirty, command, leaveOk, load, consoleEnabled, userId,
  tenantId, instanceId, materialMediaEnabled, distributionPhotosEnabled,
}: HostedStoreCooperationAreaProps) {
  return <div id="store-cooperation-panel" className="hosted-supply-panel" hidden={area!=='cooperation'}>{view.capabilities.includes('store:write') ? <HostedDistribution supplyOfferPhotosEnabled={supplyOfferPhotosEnabled} client={client} root={root} refresh={distributionRefresh} busy={areaLocked} writable={can('store:write')} onDirty={(id,value)=>markDirty('distribution/'+id,value)} onCommand={command} onReload={() => leaveOk() ? load() : Promise.resolve()}/>
          : <p>你沒有供貨合作的管理權限，仍可查看商品與店面資料。</p>}
          {consoleEnabled&&<PartnerMaterials client={client} userId={userId} tenantId={tenantId} instanceId={instanceId} active={area==='cooperation'} refresh={distributionRefresh} mediaEnabled={materialMediaEnabled} distributionPhotosEnabled={distributionPhotosEnabled} writable={can('store:write')} busy={areaLocked} onCommand={command}/>}
        </div>;
}
