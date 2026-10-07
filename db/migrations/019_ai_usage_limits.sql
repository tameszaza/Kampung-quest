CREATE SCHEMA IF NOT EXISTS security;

CREATE TABLE IF NOT EXISTS security.ai_usage_buckets (
  scope text NOT NULL,
  bucket_start timestamptz NOT NULL,
  period text NOT NULL CHECK (period IN ('minute', 'day')),
  requests integer NOT NULL DEFAULT 0 CHECK (requests >= 0),
  reserved_micros bigint NOT NULL DEFAULT 0 CHECK (reserved_micros >= 0),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (scope, bucket_start, period)
);
CREATE INDEX IF NOT EXISTS ai_usage_buckets_expiry ON security.ai_usage_buckets (expires_at);

CREATE TABLE IF NOT EXISTS security.ai_usage_leases (
  lease_id uuid PRIMARY KEY,
  user_scope text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_usage_leases_expiry ON security.ai_usage_leases (expires_at);
