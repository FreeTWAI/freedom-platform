type StoredSelection = { tenant_id?: unknown; workspace_id?: unknown };
type ActingSelection = { tenant_id: string | null; workspace_id: string | null };

// A per-member UI preference, never a source of tenant/workspace authority.
function actingKey(userId: string) { return `freedom-acting-tenant:${userId}`; }

function readSelection<T>(userId: string, project: (stored: StoredSelection) => T, fallback: () => T): T {
  try {
    return project(JSON.parse(sessionStorage.getItem(actingKey(userId)) ?? '') as StoredSelection);
  } catch { return fallback(); }
}

export function readActingTenant(userId: string): string | null {
  return readSelection(userId, stored => typeof stored.tenant_id === 'string' ? stored.tenant_id : null, () => null);
}

export function readActing(userId: string): ActingSelection {
  return readSelection(userId, stored => ({
    tenant_id: typeof stored.tenant_id === 'string' ? stored.tenant_id : null,
    workspace_id: typeof stored.workspace_id === 'string' ? stored.workspace_id : null,
  }), () => ({ tenant_id: null, workspace_id: null }));
}

export function rememberActing(userId: string, tenantId: string, workspaceId: string) {
  try { sessionStorage.setItem(actingKey(userId), JSON.stringify({ tenant_id: tenantId, workspace_id: workspaceId })); } catch { /* The screen still shows the current choice. */ }
}
