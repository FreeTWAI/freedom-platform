-- One optional wake-up address per agent key. A ping carries no member data (see the module comment).
CREATE TABLE agent_change_pings (
 connection_id uuid PRIMARY KEY REFERENCES agent_token_connections(connection_id) ON DELETE CASCADE,
 community_id uuid NOT NULL REFERENCES communities, user_id uuid NOT NULL REFERENCES users,
 notify_url text NOT NULL CHECK(char_length(notify_url) BETWEEN 12 AND 2048 AND notify_url LIKE 'https://%'),
 pinged_cursor bigint NOT NULL DEFAULT 0 CHECK(pinged_cursor>=0),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 100000),
 next_attempt_at timestamptz, paused_at timestamptz,
 lease_until timestamptz, lease_token uuid,
 last_attempt_at timestamptz, last_success_at timestamptz,
 last_status integer CHECK(last_status BETWEEN 0 AND 599),
 last_error text CHECK(last_error IN ('timeout','network','redirect','http_status','rejected_url')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX agent_change_pings_user ON agent_change_pings(user_id);
