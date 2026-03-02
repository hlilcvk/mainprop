import { Router } from "express";
import pool from "../db.js";
import { sha256, rand6, isEmail, getClientIp } from "../helpers.js";
import { sendEmail } from "../mail.js";

const router = Router();

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

router.post("/request-code", async (req, res) => {
  const OTP_SALT = process.env.OTP_SALT || "";
  if (!OTP_SALT) return res.status(503).json({ ok: false, error: "Not configured" });

  const ip = getClientIp(req);
  if (!rateOk(ip)) return res.status(429).json({ ok: false, error: "Too many requests. Try later." });

  const email = String(req.body.email || "").trim().toLowerCase();
  const profile = String(req.body.profile || "").trim().slice(0, 60);
  const note = String(req.body.note || "").trim().slice(0, 300);
  const hcaptchaToken = String(req.body.hcaptchaToken || "").trim();
  const googleTrusted = req.body.googleTrusted === true;
  const googleIdToken = String(req.body.googleIdToken || "").trim();

  if (!isEmail(email)) return res.status(400).json({ ok: false, error: "Invalid email" });

  // Google trusted: Firebase ID token ile dogrulama, hCaptcha gerekmez
  if (googleTrusted && googleIdToken) {
    // Firebase Admin ile token dogrula
    try {
      const admin = (await import("firebase-admin")).default;
      if (!admin.apps.length) {
        const projectId = process.env.FIREBASE_PROJECT_ID || "";
        const clientEmail = process.env.FIREBASE_CLIENT_EMAIL || "";
        let privateKey = process.env.FIREBASE_PRIVATE_KEY || "";
        privateKey = privateKey.replace(/\\n/g, "\n");
        if (projectId && clientEmail && privateKey) {
          admin.initializeApp({
            credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
          });
        }
      }
      const decoded = await admin.auth().verifyIdToken(googleIdToken);
      const tokenEmail = String(decoded.email || "").toLowerCase();
      if (tokenEmail !== email) {
        return res.status(401).json({ ok: false, error: "Email mismatch" });
      }
    } catch (err) {
      console.error("Firebase token verify failed:", err.message);
      return res.status(401).json({ ok: false, error: "Invalid Google token" });
    }

    // Dogrulanmis Google kullanici - direkt kaydet
    try {
      await pool.query(
        `INSERT INTO waitlist (email, profile, note, source, status, verified_at)
         VALUES ($1, $2, $3, 'google', 'verified', now())
         ON CONFLICT (lower(email)) DO UPDATE SET
           profile = COALESCE(EXCLUDED.profile, waitlist.profile),
           note = COALESCE(EXCLUDED.note, waitlist.note),
           source = 'google',
           status = 'verified',
           verified_at = now()`,
        [email, profile || null, note || null]
      );
      return res.json({ ok: true, verified: true });
    } catch (err) {
      console.error("Google waitlist error:", err.message);
      return res.status(500).json({ ok: false, error: "Server error" });
    }
  }

  // Normal akis: hCaptcha zorunlu
  const cap = await verifyHCaptcha(hcaptchaToken, ip);
  if (!cap.ok) return res.status(401).json({ ok: false, error: cap.error });

  const source = googleTrusted ? "google" : "email";

  try {
    if (googleTrusted) {
      await pool.query(
        `INSERT INTO waitlist (email, profile, note, source, status, verified_at)
         VALUES ($1, $2, $3, $4, 'verified', now())
         ON CONFLICT (lower(email)) DO UPDATE SET
           profile = COALESCE(EXCLUDED.profile, waitlist.profile),
           note = COALESCE(EXCLUDED.note, waitlist.note),
           source = EXCLUDED.source,
           status = 'verified',
           verified_at = now()`,
        [email, profile || null, note || null, source]
      );
      return res.json({ ok: true, verified: true });
    }

    await pool.query(
      `INSERT INTO waitlist (email, profile, note, source, status)
       VALUES ($1, $2, $3, $4, 'pending')
       ON CONFLICT (lower(email)) DO UPDATE SET
         profile = COALESCE(EXCLUDED.profile, waitlist.profile),
         note = COALESCE(EXCLUDED.note, waitlist.note),
         source = EXCLUDED.source`,
      [email, profile || null, note || null, source]
    );

    const code = rand6();
    const code_hash = sha256(code + "|" + email + "|" + OTP_SALT);
    const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const ip_hash = sha256(ip + "|otp");

    await pool.query(
      `INSERT INTO email_verifications (email, code_hash, expires_at, ip_hash)
       VALUES ($1, $2, $3, $4)`,
      [email, code_hash, expires_at, ip_hash]
    );

    const subject = "PROPTREX Verification Code";
    const html = `
      <div style="font-family:Inter,Arial,sans-serif;line-height:1.5;color:#0B1220">
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
    console.error("request-code error:", err.message);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

export default router;
