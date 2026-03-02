import pool from "./db.js";

const schema = `
CREATE TABLE IF NOT EXISTS public.pageviews (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_hash TEXT NOT NULL,
  ua_hash TEXT NOT NULL,
  path TEXT NOT NULL,
  ref TEXT,
  country TEXT,
  event TEXT NOT NULL DEFAULT 'pageview'
);

CREATE INDEX IF NOT EXISTS pageviews_ts_idx ON public.pageviews (ts DESC);
CREATE INDEX IF NOT EXISTS pageviews_path_idx ON public.pageviews (path);

CREATE TABLE IF NOT EXISTS public.waitlist (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  email TEXT NOT NULL,
  profile TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  verified_at TIMESTAMPTZ,
  source TEXT NOT NULL DEFAULT 'email'
);

CREATE UNIQUE INDEX IF NOT EXISTS waitlist_email_uniq ON public.waitlist (lower(email));

CREATE TABLE IF NOT EXISTS public.email_verifications (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  consumed_at TIMESTAMPTZ,
  ip_hash TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS email_verifications_email_idx ON public.email_verifications (lower(email));
CREATE INDEX IF NOT EXISTS email_verifications_expires_idx ON public.email_verifications (expires_at);
`;

async function init() {
  console.log("Initializing database schema...");
  try {
    await pool.query(schema);
    console.log("Database schema initialized successfully.");
  } catch (err) {
    console.error("Schema init failed:", err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

init();
