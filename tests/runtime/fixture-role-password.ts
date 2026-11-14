import type { Pool } from 'pg';

/** Allow disposable fixture roles to connect when the test database requires a password. */
export async function setFixtureRolePasswords(admin: Pool, roles: readonly string[], password = process.env.PGPASSWORD) {
  if (!password) return;
  for (const role of roles) {
    const { rows } = await admin.query<{ sql: string }>(
      "SELECT format('ALTER ROLE %I PASSWORD %L', $1::text, $2::text) AS sql",
      [role, password],
    );
    await admin.query(rows[0].sql);
  }
}

/** Keep each synthetic child credential separate from its passwordless URL. */
export function fixtureRoleConnection(url: string, password?: string) {
  if (!password) return { connectionString: url };
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 5432),
    database: decodeURIComponent(parsed.pathname.slice(1)),
    user: decodeURIComponent(parsed.username),
    password,
  };
}
