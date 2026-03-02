import { Router } from "express";
import pool from "../db.js";
import { sha256, isEmail, getClientIp } from "../helpers.js";

const router = Router();

/* ---------- hCaptcha ---------- */
async function verifyHCaptcha(token, ip) {
  const secret = process.env.HCAPTCHA_SECRET || "";
  if (!secret) return { ok: false, error: "hCaptcha not configured" };
  if (!token) return { ok: false, error: "Missing captcha token" };

  const res = await fetch("https://hcaptcha.com/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ secret, response: token, remoteip: ip || "" }),
  });
  const j = await res.json().catch(() => ({}));
  if (!j?.success) return { ok: false, error: "Captcha verification failed" };
  return { ok: true };
}

router.post("/verify-code", async (req, res) => {
  const OTP_SALT = process.env.OTP_SALT || "";
  if (!OTP_SALT) return res.status(503).json({ ok: false, error: "Not configured" });

  const ip = getClientIp(req);

  const email = String(req.body.email || "").trim().toLowerCase();
  const code = String(req.body.code || "").trim().replace(/\s+/g, "");
  const hcaptchaToken = String(req.body.hcaptchaToken || "").trim();

  if (!isEmail(email)) return res.status(400).json({ ok: false, error: "Invalid email" });
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ ok: false, error: "Invalid code format" });

  const cap = await verifyHCaptcha(hcaptchaToken, ip);
  if (!cap.ok) return res.status(401).json({ ok: false, error: cap.error });

  try {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const { rows } = await pool.query(
      `SELECT id, code_hash, expires_at, attempts, consumed_at, ts
       FROM email_verifications
       WHERE lower(email) = lower($1) AND ts >= $2
       ORDER BY ts DESC
       LIMIT 1`,
      [email, since]
    );

    const row = rows[0] || null;
    if (!row) return res.status(404).json({ ok: false, error: "No active verification found" });
    if (row.consumed_at) return res.status(400).json({ ok: false, error: "Code already used" });

    const now = Date.now();
    const exp = new Date(row.expires_at).getTime();
    if (!Number.isFinite(exp) || now > exp) return res.status(400).json({ ok: false, error: "Code expired" });
    if ((row.attempts || 0) >= 5) return res.status(429).json({ ok: false, error: "Too many attempts" });

    const expected = row.code_hash;
    const actual = sha256(code + "|" + email + "|" + OTP_SALT);

    if (expected !== actual) {
      await pool.query(
        `UPDATE email_verifications SET attempts = $1 WHERE id = $2`,
        [(row.attempts || 0) + 1, row.id]
      );
      return res.status(401).json({ ok: false, error: "Incorrect code" });
    }

    // Başarılı doğrulama
    await pool.query(
      `UPDATE email_verifications SET consumed_at = now(), attempts = $1 WHERE id = $2`,
      [(row.attempts || 0) + 1, row.id]
    );

    await pool.query(
      `UPDATE waitlist SET status = 'verified', verified_at = now() WHERE lower(email) = lower($1)`,
      [email]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error("verify-code error:", err.message);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

export default router;
