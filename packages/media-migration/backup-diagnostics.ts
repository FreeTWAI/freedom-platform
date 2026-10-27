/** Public diagnostics are fixed identifiers, never provider messages or arbitrary codes. */
export const BACKUP_DIAGNOSTIC_CODES: readonly string[] = Object.freeze([
  'daily_backup_phase_failed', 'daily_backup_cleanup_failed', 'daily_backup_aborted',
  'daily_backup_target_mismatch', 'daily_backup_gc_not_disabled', 'daily_backup_evidence_required',
  'daily_backup_remote_mismatch', 'daily_backup_restore_mismatch', 'daily_backup_ports_invalid',
  'daily_backup_policy_mismatch', 'daily_backup_protection_lost',
  'release_backup_target_mismatch', 'release_backup_worker_changed', 'release_backup_control_mismatch',
  'release_backup_ledger_invalid', 'release_backup_policy_invalid', 'release_backup_sequence_writer_unfenced',
  'release_backup_gc_not_disabled', 'release_backup_cleanup_failed', 'gc_observation_unavailable',
  'release_floor_database_ledger_changed', 'release_floor_external_state_changed',
  'release_coordinate_postgres_version', 'release_coordinate_inventory_count',
  'release_coordinate_constraint_changed', 'release_coordinate_definition_changed',
  'release_capture_policy_unsettled', 'release_capture_policy_changed', 'release_capture_policy_cleanup_failed',
  'release_lease_lost', 'release_lease_not_held',
  'backup_database_permission_denied', 'backup_database_query_cancelled', 'backup_database_connection_failed',
]);
export function backupDiagnosticCode(error: unknown, fallback: string): string {
  const value = error as { code?: unknown; message?: unknown } | null;
  // PostgreSQL SQLSTATEs are translated; SQL text/detail/connection strings never leave the process.
  const database: Record<string, string> = { '42501': 'backup_database_permission_denied',
    '57014': 'backup_database_query_cancelled', '08001': 'backup_database_connection_failed',
    '08006': 'backup_database_connection_failed', '57P01': 'backup_database_connection_failed' };
  if (typeof value?.code === 'string' && Object.hasOwn(database, value.code)) return database[value.code];
  for (const code of [value?.code, value?.message]) {
    if (typeof code === 'string' && BACKUP_DIAGNOSTIC_CODES.includes(code)) return code;
  }
  return fallback;
}
