import { Router } from "express";
import pool from "../db.js";
import { sha256, isEmail, getClientIp } from "../helpers.js";
import { sendEmail } from "../mail.js";

const router = Router();

router.post("/verify-code", async (req, res) => {
  const OTP_SALT = process.env.OTP_SALT || "";
  if (!OTP_SALT) return res.status(503).json({ ok: false, error: "Not configured" });

  const email = String(req.body.email || "").trim().toLowerCase();
  const code = String(req.body.code || "").trim().replace(/\s+/g, "");

  if (!isEmail(email)) return res.status(400).json({ ok: false, error: "Invalid email" });
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ ok: false, error: "Invalid code format" });

  try {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const { rows } = await pool.query(
      `SELECT id, code_hash, expires_at, attempts, consumed_at
       FROM email_verifications
       WHERE lower(email) = lower($1) AND ts >= $2
       ORDER BY ts DESC LIMIT 1`,
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
      await pool.query(`UPDATE email_verifications SET attempts = $1 WHERE id = $2`, [(row.attempts || 0) + 1, row.id]);
      return res.status(401).json({ ok: false, error: "Incorrect code" });
    }

    // Success
    await pool.query(`UPDATE email_verifications SET consumed_at = now(), attempts = $1 WHERE id = $2`, [(row.attempts || 0) + 1, row.id]);
    await pool.query(`UPDATE waitlist SET status = 'verified', verified_at = now() WHERE lower(email) = $1`, [email]);

    // Auto-reply
    try {
      const arRes = await pool.query("SELECT value FROM system_settings WHERE key = 'auto_reply_email'");
      if (arRes.rows.length > 0) {
        const ar = arRes.rows[0].value;
        if (ar && ar.enabled) {
          const wlUser = await pool.query("SELECT first_name FROM waitlist WHERE lower(email) = $1", [email]);
          const name = wlUser.rows[0]?.first_name || "there";
          let body = (ar.body || "Thank you for registering.").replace(/{{first_name}}/g, name);
          await sendEmail(email, ar.subject || "PROPTREX Registration Received", body);
        }
      }
    } catch (mailErr) {
      console.error("[VERIFY] Auto-reply error:", mailErr.message);
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("[VERIFY-CODE]", err.message, err.stack);
    return res.status(500).json({ ok: false, error: "Server error: " + err.message });
  }
});

export default router;
