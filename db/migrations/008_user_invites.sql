-- One-time invite tokens for self-serve password setup.

CREATE TABLE IF NOT EXISTS user_invites (
  token       TEXT        PRIMARY KEY,
  email       TEXT        NOT NULL,
  role        TEXT        NOT NULL CHECK (role IN ('admin', 'user')),
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_user_invites_email   ON user_invites (lower(email));
CREATE INDEX IF NOT EXISTS idx_user_invites_pending ON user_invites (expires_at) WHERE used_at IS NULL;
