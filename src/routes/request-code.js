import { Router } from "express";
import pool from "../db.js";
import { sha256, rand6, isEmail, getClientIp } from "../helpers.js";
import { sendEmail } from "../mail.js";
import { getAuth } from "firebase-admin/auth";
import admin from "firebase-admin";

const router = Router();

/* In-memory rate limiter */
const rate = new Map();
function rateOk(ip, limit = 8, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  const r = rate.get(ip);
  if (!r || now > r.resetAt) {
    rate.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }
  r.count += 1;
  return r.count <= limit;
}

router.post("/request-code", async (req, res) => {
  const OTP_SALT = process.env.OTP_SALT || "";
  if (!OTP_SALT) return res.status(503).json({ ok: false, error: "Not configured" });

  const ip = getClientIp(req);
  if (!rateOk(ip)) return res.status(429).json({ ok: false, error: "Too many requests. Try later." });

  let email = String(req.body.email || "").trim().toLowerCase();
  const first_name = String(req.body.first_name || "").trim().slice(0, 100);
  const last_name = String(req.body.last_name || "").trim().slice(0, 100);
  const city = String(req.body.city || "").trim().slice(0, 100);
  const profile = String(req.body.profile || "").trim().slice(0, 60);
  const note = String(req.body.note || "").trim().slice(0, 300);
  const extra_fields = req.body.extra_fields || {};
  const googleIdToken = String(req.body.googleIdToken || "").trim();

  const source = googleIdToken ? "google" : "email";

  if (googleIdToken) {
    if (!admin.apps.length) return res.status(503).json({ ok: false, error: "Google Auth not configured" });
    try {
      const decoded = await getAuth().verifyIdToken(googleIdToken);
      email = decoded.email.toLowerCase();
    } catch (err) {
      console.error("[AUTH] Firebase token error:", err.message);
      return res.status(401).json({ ok: false, error: "Invalid Google Token" });
    }
  }

  if (!isEmail(email)) return res.status(400).json({ ok: false, error: "Invalid email" });

  try {
    if (googleIdToken) {
      await pool.query(
        `INSERT INTO waitlist (email, first_name, last_name, city, profile, note, extra_fields, source, status, verified_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'verified', now())
         ON CONFLICT (lower(email)) DO UPDATE SET
           first_name = COALESCE(EXCLUDED.first_name, waitlist.first_name),
           last_name = COALESCE(EXCLUDED.last_name, waitlist.last_name),
           city = COALESCE(EXCLUDED.city, waitlist.city),
           profile = COALESCE(EXCLUDED.profile, waitlist.profile),
           note = COALESCE(EXCLUDED.note, waitlist.note),
           extra_fields = COALESCE(EXCLUDED.extra_fields, waitlist.extra_fields),
           source = EXCLUDED.source,
           status = 'verified',
           verified_at = now()`,
        [email, first_name || null, last_name || null, city || null, profile || null, note || null, extra_fields, source]
      );

      // Auto-reply email for Google sign-in
      try {
        const arRes = await pool.query("SELECT value FROM system_settings WHERE key = 'auto_reply_email'");
        if (arRes.rows.length > 0) {
          const ar = arRes.rows[0].value;
          if (ar && ar.enabled) {
            const name = first_name || "there";
            let body = (ar.body || "Thank you for registering.").replace(/{{first_name}}/g, name);
            await sendEmail(email, ar.subject || "PROPTREX Registration Received", body);
          }
        }
      } catch (mailErr) {
        console.error("[REQUEST-CODE] Google auto-reply error:", mailErr.message);
      }

      return res.json({ ok: true, verified: true });
    }

    // Upsert waitlist (pending)
    await pool.query(
      `INSERT INTO waitlist (email, first_name, last_name, city, profile, note, extra_fields, source, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
       ON CONFLICT (lower(email)) DO UPDATE SET
         first_name = COALESCE(EXCLUDED.first_name, waitlist.first_name),
         last_name = COALESCE(EXCLUDED.last_name, waitlist.last_name),
         city = COALESCE(EXCLUDED.city, waitlist.city),
         profile = COALESCE(EXCLUDED.profile, waitlist.profile),
         note = COALESCE(EXCLUDED.note, waitlist.note),
         extra_fields = COALESCE(EXCLUDED.extra_fields, waitlist.extra_fields),
         source = EXCLUDED.source`,
      [email, first_name || null, last_name || null, city || null, profile || null, note || null, extra_fields, source]
    );

    // Generate OTP
    const code = rand6();
    const code_hash = sha256(code + "|" + email + "|" + OTP_SALT);
    const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const ip_hash = sha256(ip + "|otp");

    await pool.query(
      `INSERT INTO email_verifications (email, code_hash, expires_at, ip_hash) VALUES ($1, $2, $3, $4)`,
      [email, code_hash, expires_at, ip_hash]
    );

    const subject = "PROPTREX Verification Code";
    const html = `
      <div style="font-family:system-ui,sans-serif;line-height:1.5;color:#0B1220">
        <h2 style="margin:0 0 10px">Verify your email</h2>
        <p style="margin:0 0 14px;color:#58647A">
          Enter this code to confirm your early access request. This code expires in 10 minutes.
        </p>
        <div style="font-size:28px;font-weight:700;letter-spacing:8px;padding:14px 16px;border:1px solid rgba(10,20,35,.12);border-radius:14px;display:inline-block">
          ${code}
        </div>
        <p style="margin:14px 0 0;color:#58647A;font-size:12px">
          If you didn't request this, you can ignore this email.
        </p>
      </div>
    `;

    await sendEmail(email, subject, html);
    return res.json({ ok: true, verified: false });
  } catch (err) {
    console.error("[REQUEST-CODE]", err.message, err.stack);
    return res.status(500).json({ ok: false, error: "Server error: " + err.message });
  }
});

export default router;
