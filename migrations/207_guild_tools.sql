-- Registered code runs only in a frame. No executable platform configuration.
CREATE TABLE guild_tools (
 id uuid PRIMARY KEY, community_id uuid NOT NULL REFERENCES communities,
 guild_key text NOT NULL REFERENCES positioning_guild_catalog(guild_key),
 tool_id text NOT NULL CHECK(tool_id ~ '^[a-z][a-z0-9-]{0,47}$'),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 state text NOT NULL CHECK(state IN ('pending','enabled','disabled')),
 title text NOT NULL, entry_url text NOT NULL, origin text NOT NULL,
 bridge_version text NOT NULL CHECK(bridge_version='freedom.guild-launchpad/v2'),
 profile text NOT NULL CHECK(profile IN ('sandboxed','origin')),
 scopes jsonb NOT NULL, permissions jsonb NOT NULL,
 registered_by uuid NOT NULL REFERENCES users, accepted_by uuid REFERENCES users,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(guild_key,tool_id)
);
CREATE TABLE guild_tool_revisions (
 tool uuid NOT NULL REFERENCES guild_tools, revision integer NOT NULL,
 record jsonb NOT NULL, registered_by uuid NOT NULL REFERENCES users,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(tool,revision)
);
CREATE TABLE guild_tool_reports (
 tool uuid NOT NULL REFERENCES guild_tools, revision integer NOT NULL,
 reporter uuid NOT NULL REFERENCES users, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tool,revision,reporter)
);
CREATE TABLE guild_tool_subjects (
 tool uuid NOT NULL REFERENCES guild_tools, member uuid NOT NULL REFERENCES users,
 subject uuid NOT NULL UNIQUE, PRIMARY KEY(tool,member)
);
CREATE TABLE guild_tool_audit (
 id uuid PRIMARY KEY, tool uuid NOT NULL REFERENCES guild_tools, revision integer NOT NULL,
 actor uuid REFERENCES users, admin uuid REFERENCES platform_admins(admin_id), action text NOT NULL,
 CHECK ((actor IS NULL) <> (admin IS NULL)),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION guild_tool_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'guild tool history is append only'; END $$;
CREATE TRIGGER guild_tool_revisions_immutable BEFORE UPDATE OR DELETE ON guild_tool_revisions FOR EACH ROW EXECUTE FUNCTION guild_tool_immutable();
CREATE TRIGGER guild_tool_audit_immutable BEFORE UPDATE OR DELETE ON guild_tool_audit FOR EACH ROW EXECUTE FUNCTION guild_tool_immutable();

CREATE TABLE guild_tool_share_sources (
 share_id uuid NOT NULL REFERENCES shares, tool uuid NOT NULL REFERENCES guild_tools,
 revision integer NOT NULL, member uuid NOT NULL REFERENCES users,
 PRIMARY KEY(share_id,tool,revision,member)
);

CREATE TABLE guild_tool_origin_challenges (
 id uuid PRIMARY KEY, community_id uuid NOT NULL REFERENCES communities,
 guild_key text NOT NULL REFERENCES positioning_guild_catalog(guild_key), member uuid NOT NULL REFERENCES users,
 origin text NOT NULL, token text NOT NULL, expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE guild_tool_token_grants (
 jti uuid PRIMARY KEY, tool uuid NOT NULL REFERENCES guild_tools, revision integer NOT NULL,
 member uuid NOT NULL REFERENCES users, session_hash text, agent_connection uuid REFERENCES member_client_connections(connection_id),
 expires_at timestamptz NOT NULL, CHECK ((session_hash IS NULL) <> (agent_connection IS NULL))
);
CREATE INDEX guild_tool_token_expiry ON guild_tool_token_grants(expires_at);
