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

export async function initDatabase() {
  console.log("[DB] Initializing schema...");
  await pool.query(schema);

  // Fallback migrations
  await pool.query(`
    ALTER TABLE public.waitlist ADD COLUMN IF NOT EXISTS first_name TEXT;
    ALTER TABLE public.waitlist ADD COLUMN IF NOT EXISTS last_name TEXT;
    ALTER TABLE public.waitlist ADD COLUMN IF NOT EXISTS city TEXT;
    ALTER TABLE public.waitlist ADD COLUMN IF NOT EXISTS extra_fields JSONB DEFAULT '{}'::jsonb;
  `);

  // Seed defaults
  await pool.query(`
    INSERT INTO public.system_settings (key, value) VALUES
    ('dynamic_form_fields', '[]'::jsonb),
    ('firebase_config', '{}'::jsonb),
    ('auto_reply_email', '{"enabled": false, "subject": "PROPTREX Registration Received", "body": "Thank you for registering. We will review your application soon."}'::jsonb)
    ON CONFLICT (key) DO NOTHING;
  `);

  console.log("[DB] Schema ready.");
}

// Allow standalone execution: node src/db-init.js
const isMain = process.argv[1]?.endsWith("db-init.js");
if (isMain) {
  initDatabase()
    .then(() => pool.end())
    .catch((err) => {
      console.error("[DB] Init failed:", err.message);
      process.exit(1);
    });
}
