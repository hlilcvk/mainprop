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
  first_name TEXT,
  last_name TEXT,
  city TEXT,
  profile TEXT,
  note TEXT,
  extra_fields JSONB DEFAULT '{}'::jsonb,
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

CREATE TABLE IF NOT EXISTS public.system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

async function init() {
  console.log("Initializing database schema...");
  try {
    await pool.query(schema);

    // Fallback migrations for existing deployments
    console.log("Running fallback migrations for existing tables...");
    await pool.query(`
      ALTER TABLE public.waitlist ADD COLUMN IF NOT EXISTS first_name TEXT;
      ALTER TABLE public.waitlist ADD COLUMN IF NOT EXISTS last_name TEXT;
      ALTER TABLE public.waitlist ADD COLUMN IF NOT EXISTS city TEXT;
      ALTER TABLE public.waitlist ADD COLUMN IF NOT EXISTS extra_fields JSONB DEFAULT '{}'::jsonb;
    `);

    // Insert default settings if they do not exist
    console.log("Seeding default settings...");
    await pool.query(`
      INSERT INTO public.system_settings (key, value) VALUES 
      ('dynamic_form_fields', '[]'::jsonb),
      ('firebase_config', '{}'::jsonb),
      ('auto_reply_email', '{"enabled": false, "subject": "PROPTREX Registration Received", "body": "Thank you for registering. We will review your application soon."}'::jsonb)
      ON CONFLICT (key) DO NOTHING;
    `);

    console.log("Database schema initialized successfully.");
  } catch (err) {
    console.error("Schema init failed:", err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

init();
